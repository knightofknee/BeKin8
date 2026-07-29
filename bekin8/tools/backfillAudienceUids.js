#!/usr/bin/env node
// tools/backfillAudienceUids.js
//
// One-off backfill for the read-audience denormalization described in functions/src/audience.ts.
// The triggers there stamp `audienceUids` on Posts/Beacons created from now on; this stamps every
// document that already existed. Both must be done before the read rules can be tightened, or the
// tightened rule would hide every pre-existing post from everyone (including its own author).
//
// Idempotent: documents that already carry a non-empty audienceUids are skipped, so it is safe to
// re-run. Defaults to a DRY RUN; pass --commit to actually write.
//
//   node tools/backfillAudienceUids.js            # report only, writes nothing
//   node tools/backfillAudienceUids.js --commit    # perform the backfill
//
// Auth: uses Application Default Credentials (gcloud auth application-default login).

// firebase-admin lives in functions/node_modules (the app itself uses the client SDK, not admin),
// so resolve it from there explicitly rather than relying on the cwd this is run from.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'waldgrave-profiles';
const COMMIT = process.argv.includes('--commit');
const BATCH_LIMIT = 450; // Firestore caps a WriteBatch at 500 ops.

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Accepted friend uids for an owner. Mirrors audience.ts / index.ts: a MISSING `state` counts as
 *  accepted (legacy edges predate the field); an explicit non-accepted state is dropped. ALSO
 *  unions the LEGACY users/{owner}/friends subcollection (doc id = friend uid): long-standing
 *  accounts have friendships that exist only there, and leaving them out of the audience broke
 *  their writes (RSVP/chat) on content they could read. */
async function acceptedFriendUids(ownerUid) {
  const [qs, legacySnap] = await Promise.all([
    db.collection('FriendEdges').where('uids', 'array-contains', ownerUid).get(),
    db.collection('users').doc(ownerUid).collection('friends').get(),
  ]);
  const out = new Set();
  qs.forEach((d) => {
    const data = d.data() || {};
    if (data.state !== undefined && data.state !== 'accepted') return;
    const uids = Array.isArray(data.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const other = uids[0] === ownerUid ? uids[1] : uids[0];
    if (other && other !== ownerUid) out.add(other);
  });
  legacySnap.forEach((d) => {
    if (d.id && d.id !== ownerUid) out.add(d.id);
  });
  return Array.from(out);
}

async function fofEnabled(uid) {
  const s = await db.collection('Profiles').doc(uid).get();
  return s.exists && s.data()?.friendsOfFriendsPosts === true;
}

/** Friends-of-friends: distance exactly 2, mutually opted in, not blocked either way.
 *  Mirrors functions/src/audience.ts and getFriendsOfFriends. */
async function fofUids(ownerUid, friends) {
  if (friends.length === 0 || !(await fofEnabled(ownerUid))) return [];

  const candidates = new Set();
  for (const group of chunk(friends, 25)) {
    const res = await Promise.all(group.map((f) => acceptedFriendUids(f)));
    for (const uids of res) for (const c of uids) candidates.add(c);
  }
  candidates.delete(ownerUid);
  for (const f of friends) candidates.delete(f);
  if (candidates.size === 0) return [];

  const optedIn = [];
  for (const group of chunk(Array.from(candidates), 300)) {
    const snaps = await db.getAll(...group.map((c) => db.collection('Profiles').doc(c)));
    snaps.forEach((s) => {
      if (s.exists && s.data()?.friendsOfFriendsPosts === true) optedIn.push(s.id);
    });
  }
  if (optedIn.length === 0) return [];

  const blocked = new Set();
  for (const group of chunk(optedIn, 300)) {
    const [mine, theirs] = await Promise.all([
      db.getAll(...group.map((c) => db.collection('users').doc(ownerUid).collection('blocks').doc(c))),
      db.getAll(...group.map((c) => db.collection('users').doc(c).collection('blocks').doc(ownerUid))),
    ]);
    mine.forEach((s, i) => { if (s.exists) blocked.add(group[i]); });
    theirs.forEach((s, i) => { if (s.exists) blocked.add(group[i]); });
  }
  return optedIn.filter((c) => !blocked.has(c));
}

// One resolve per owner, not per document. Owners typically have many posts.
const audienceCache = new Map();
async function audienceFor(ownerUid) {
  if (!audienceCache.has(ownerUid)) {
    const friends = await acceptedFriendUids(ownerUid);
    const fof = await fofUids(ownerUid, friends);
    audienceCache.set(ownerUid, Array.from(new Set([ownerUid, ...friends, ...fof])));
  }
  return audienceCache.get(ownerUid);
}

/**
 * `ownerField` of null means the document ID *is* the owner uid (Profiles).
 *
 * Every document is rewritten rather than skipped when already stamped: the audience definition
 * grew to include friends-of-friends, so previously-stamped docs hold a stale, too-narrow array.
 * Writing an identical array is harmless, which keeps this safe to re-run.
 */
async function backfill(collectionName, ownerField) {
  const snap = await db.collection(collectionName).get();
  let missingOwner = 0;
  const pending = [];

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const owner = ownerField === null ? doc.id : String(data[ownerField] || '');
    if (!owner) {
      missingOwner++;
      continue;
    }
    pending.push({ ref: doc.ref, owner });
  }

  console.log(
    `${collectionName}: ${snap.size} total, ` +
      `${missingOwner} with no ${ownerField} (skipped), ${pending.length} to write`
  );

  if (!COMMIT || pending.length === 0) return pending.length;

  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const chunk = pending.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const item of chunk) {
      // set/merge, not update: a Profile doc referenced by a Post may not exist yet.
      batch.set(item.ref, { audienceUids: await audienceFor(item.owner) }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  ${collectionName}: committed ${written}/${pending.length}`);
  }
  return written;
}

/**
 * ChatMessages live under Beacons and carry their OWN copy of the parent beacon's audience (the
 * create rule forces the copy to match, so reads need no get()). Existing messages predate the
 * field entirely, and the read rule requires it, so without this every chat history in the app
 * would go dark the moment the rules land.
 */
async function backfillChatMessages() {
  const snap = await db.collectionGroup('ChatMessages').get();
  const pending = [];
  let orphaned = 0;

  for (const doc of snap.docs) {
    const beaconId = doc.ref.parent.parent?.id;
    if (!beaconId) {
      orphaned++;
      continue;
    }
    pending.push({ ref: doc.ref, beaconId });
  }
  console.log(`ChatMessages: ${snap.size} total, ${orphaned} orphaned (skipped), ${pending.length} to write`);
  if (!COMMIT || pending.length === 0) return pending.length;

  // Resolve each parent beacon's audience once, not once per message.
  const beaconAudience = new Map();
  for (const beaconId of new Set(pending.map((p) => p.beaconId))) {
    const b = await db.collection('Beacons').doc(beaconId).get();
    beaconAudience.set(beaconId, b.exists ? b.data()?.audienceUids || [] : []);
  }

  let written = 0;
  for (const group of chunk(pending, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const item of group) {
      batch.set(item.ref, { audienceUids: beaconAudience.get(item.beaconId) || [] }, { merge: true });
    }
    await batch.commit();
    written += group.length;
    console.log(`  ChatMessages: committed ${written}/${pending.length}`);
  }
  return written;
}

(async () => {
  console.log(COMMIT ? '=== BACKFILL (writing) ===' : '=== DRY RUN (no writes) ===');
  const posts = await backfill('Posts', 'author');
  const beacons = await backfill('Beacons', 'ownerUid');
  // Profiles are keyed BY the owner uid, so there is no owner field to read.
  const profiles = await backfill('Profiles', null);
  // AFTER Beacons: chat messages copy their parent beacon's (freshly written) audience.
  const chats = await backfillChatMessages();
  console.log(
    COMMIT
      ? `\nDone. Stamped ${posts} posts, ${beacons} beacons, ${profiles} profiles, ${chats} chat messages.`
      : `\nWould stamp ${posts} posts, ${beacons} beacons, ${profiles} profiles, ${chats} chat messages. Re-run with --commit.`
  );
  console.log(`Distinct owners resolved: ${audienceCache.size}`);
  process.exit(0);
})().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
