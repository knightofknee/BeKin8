// functions/src/audience.ts
//
// Read-audience denormalization for Posts, Beacons and Profiles.
//
// WHY: Firestore only permits a query when the query's own filters prove the read rule. "The author
// is my friend" is not provable from `where('author','in',[...])`, because proving it needs a
// cross-collection join the rules engine will not do at query time. So the rules could only ever say
// `allow read: if request.auth != null`, which meant ANY signed-in account (and signup is open) could
// read every post, beacon, chat message and profile in the app. That is the scraping hole.
//
// FIX: denormalize the audience onto each document as `audienceUids`, so the rule becomes
// `request.auth.uid in resource.data.audienceUids`, which IS provable from a matching
// `where('audienceUids','array-contains', myUid)` query.
//
// The array is written ONLY here, by the Admin SDK, never by clients. If a client could set its own
// audience the whole thing would be decorative: an author could publish a post listing the entire
// user base, or add themselves to someone else's.
//
// AUDIENCE = [owner] + owner's accepted friends
//            + owner's friends-of-friends, when the owner has friendsOfFriendsPosts on.
//
// The friends-of-friends part mirrors getFriendsOfFriends exactly: distance EXACTLY 2, both sides
// must have opted in (the feature is symmetric), and a block in either direction removes the pair.
// Because it is symmetric, stamping it from the owner's side is sufficient: if A and C are mutually
// opted in and share a friend, A lands in C's audience and C lands in A's.
//
// STALENESS is handled by recomputation, not by incremental add/remove. A single friendship changes
// the friends-of-friends set of everyone within two hops, so the triggers below recompute the whole
// affected neighbourhood rather than trying to patch individual entries.
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

/** Firestore caps a WriteBatch at 500 operations. */
const BATCH_LIMIT = 450;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Accepted friend uids for an owner, from FriendEdges.
 *
 * Membership-only query (no `state` equality filter) so this needs no composite index, and a MISSING
 * `state` counts as accepted for legacy edges that predate the field. This is deliberately the same
 * lenient rule the feed itself used when it queried `where('author','in', friends)`, so switching to
 * audience-scoped reads does not quietly narrow anyone's existing visibility.
 */
async function acceptedFriendUids(ownerUid: string): Promise<string[]> {
  // BOTH friendship representations count. Long-standing accounts still have LEGACY friendships
  // that exist only as docs under users/{owner}/friends (doc id = friend uid) with no FriendEdges
  // row at all; the notification path honors them (legacyNotifyEnabled), the old feed honored
  // them, and the audience must too. Missing them here was a real production failure: a
  // legacy-only friend could READ a beacon (transitional rules) but every write, including
  // "I'm in", bounced off inParentAudience with a permission error.
  const [edgeSnap, legacySnap] = await Promise.all([
    db.collection('FriendEdges').where('uids', 'array-contains', ownerUid).get(),
    db.collection('users').doc(ownerUid).collection('friends').get(),
  ]);
  const out = new Set<string>();
  edgeSnap.forEach((d) => {
    const data = d.data() as any;
    const state = data?.state;
    if (state !== undefined && state !== 'accepted') return;
    const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const other = uids[0] === ownerUid ? uids[1] : uids[0];
    if (other && other !== ownerUid) out.add(other);
  });
  legacySnap.forEach((d) => {
    if (d.id && d.id !== ownerUid) out.add(d.id);
  });
  return Array.from(out);
}

async function hasFofEnabled(uid: string): Promise<boolean> {
  const snap = await db.collection('Profiles').doc(uid).get();
  return snap.exists && (snap.data() as any)?.friendsOfFriendsPosts === true;
}

/**
 * Friends-of-friends for an owner: distance exactly 2, mutually opted in, not blocked either way.
 * Returns [] when the owner has not opted in, since the feature is symmetric.
 */
async function fofUids(ownerUid: string, friends: string[]): Promise<string[]> {
  if (friends.length === 0) return [];
  if (!(await hasFofEnabled(ownerUid))) return [];

  const friendSet = new Set(friends);
  const candidates = new Set<string>();
  for (const group of chunk(friends, 25)) {
    const results = await Promise.all(group.map((f) => acceptedFriendUids(f)));
    for (const uids of results) for (const c of uids) candidates.add(c);
  }
  candidates.delete(ownerUid);
  for (const f of friendSet) candidates.delete(f);
  if (candidates.size === 0) return [];

  // Symmetric opt-in: the candidate must have the flag on too.
  const optedIn: string[] = [];
  for (const group of chunk(Array.from(candidates), 300)) {
    const snaps = await db.getAll(...group.map((c) => db.collection('Profiles').doc(c)));
    snaps.forEach((snap) => {
      if (snap.exists && (snap.data() as any)?.friendsOfFriendsPosts === true) optedIn.push(snap.id);
    });
  }
  if (optedIn.length === 0) return [];

  // A block in EITHER direction removes the pair, even through a mutual friend.
  const blocked = new Set<string>();
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

/** Everyone allowed to read content owned by `ownerUid`. */
export async function audienceFor(ownerUid: string): Promise<string[]> {
  const friends = await acceptedFriendUids(ownerUid);
  const fof = await fofUids(ownerUid, friends);
  return Array.from(new Set([ownerUid, ...friends, ...fof]));
}

/** Recompute and rewrite audienceUids across everything `ownerUid` owns. */
async function restampOwner(ownerUid: string): Promise<number> {
  const audience = await audienceFor(ownerUid);
  const [posts, beacons] = await Promise.all([
    db.collection('Posts').where('author', '==', ownerUid).get(),
    db.collection('Beacons').where('ownerUid', '==', ownerUid).get(),
  ]);

  const refs: FirebaseFirestore.DocumentReference[] = [
    ...posts.docs.map((d) => d.ref),
    ...beacons.docs.map((d) => d.ref),
    db.collection('Profiles').doc(ownerUid),
  ];

  let written = 0;
  for (const group of chunk(refs, BATCH_LIMIT)) {
    const batch = db.batch();
    // set/merge rather than update: a Profile doc may not exist yet for a brand-new account.
    for (const ref of group) batch.set(ref, { audienceUids: audience }, { merge: true });
    await batch.commit();
    written += group.length;
  }
  return written;
}

/** Recompute for a set of owners, de-duplicated. */
async function restampMany(uids: Iterable<string>): Promise<number> {
  const unique = Array.from(new Set(Array.from(uids).filter(Boolean)));
  let total = 0;
  // Sequential on purpose: each owner fans out its own reads/writes, and these run on graph edits,
  // not in a user-facing path.
  for (const uid of unique) total += await restampOwner(uid);
  return total;
}

/** Everyone whose audience can change when `uid`'s edges change: uid, its friends, and their friends. */
async function twoHopNeighbourhood(uid: string): Promise<string[]> {
  const friends = await acceptedFriendUids(uid);
  const out = new Set<string>([uid, ...friends]);
  for (const group of chunk(friends, 25)) {
    const results = await Promise.all(group.map((f) => acceptedFriendUids(f)));
    for (const uids of results) for (const c of uids) out.add(c);
  }
  return Array.from(out);
}

// ── Stamp on create ───────────────────────────────────────────────────────────
// Stamped server-side AFTER the document lands rather than written by the client: the client cannot
// be trusted to state its own audience, and this needs no create-post/beacon client change. The
// owner is always in their own audience, so an author never loses sight of their own post during the
// sub-second window before this runs.

export const onPostCreatedStampAudience = onDocumentCreated('Posts/{postId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const author = String((snap.data() as any)?.author || '');
  if (!author) return;
  try {
    await snap.ref.update({ audienceUids: await audienceFor(author) });
  } catch (err) {
    logger.error('onPostCreatedStampAudience failed', { postId: event.params.postId, err });
  }
});

export const onBeaconCreatedStampAudience = onDocumentCreated('Beacons/{beaconId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const owner = String((snap.data() as any)?.ownerUid || '');
  if (!owner) return;
  try {
    await snap.ref.update({ audienceUids: await audienceFor(owner) });
  } catch (err) {
    logger.error('onBeaconCreatedStampAudience failed', { beaconId: event.params.beaconId, err });
  }
});

/**
 * Chat messages carry their own copy of the parent beacon's audience so reads need no get().
 *
 * New builds send that copy themselves (the create rule forces it to match the parent). Builds
 * already in the wild send nothing, so this backstops them: without it, every message sent from an
 * old build during the transition window would be missing an audience and would become invisible
 * the moment the strict read rule lands.
 */
export const onChatMessageCreatedStampAudience = onDocumentCreated(
  'Beacons/{beaconId}/ChatMessages/{msgId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const existing = (snap.data() as any)?.audienceUids;
    if (Array.isArray(existing) && existing.length > 0) return; // new build already supplied it

    try {
      const beacon = await db.collection('Beacons').doc(event.params.beaconId).get();
      const audience: string[] = Array.isArray(beacon.data()?.audienceUids)
        ? (beacon.data() as any).audienceUids
        : [];
      if (audience.length === 0) return;
      await snap.ref.update({ audienceUids: audience });
    } catch (err) {
      logger.error('onChatMessageCreatedStampAudience failed', {
        beaconId: event.params.beaconId,
        msgId: event.params.msgId,
        err,
      });
    }
  }
);

// ── Keep audiences current as the graph changes ───────────────────────────────
// FriendEdges is the single chokepoint every friendship passes through (the client accept handler,
// addFriendMutual and redeemInvite all end at a FriendEdges doc), so watching it covers every path.
// A new edge changes friends-of-friends for everyone within two hops, hence the neighbourhood
// recompute rather than a targeted arrayUnion.

function edgeUids(data: any): [string, string] | null {
  const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
  if (uids.length !== 2) return null;
  const [a, b] = uids;
  if (!a || !b || a === b) return null;
  return [a, b];
}

async function handleEdgeChange(pair: [string, string], label: string) {
  const [a, b] = pair;
  try {
    const [na, nb] = await Promise.all([twoHopNeighbourhood(a), twoHopNeighbourhood(b)]);
    const affected = new Set<string>([...na, ...nb]);
    const docs = await restampMany(affected);
    logger.info(`audience: ${label}`, { a, b, owners: affected.size, docsRestamped: docs });
  } catch (err) {
    logger.error(`audience: ${label} failed`, { a, b, err });
  }
}

export const onFriendEdgeCreatedSyncAudience = onDocumentCreated(
  'FriendEdges/{edgeId}',
  async (event) => {
    const pair = edgeUids(event.data?.data());
    if (pair) await handleEdgeChange(pair, 'friendship added');
  }
);

export const onFriendEdgeDeletedSyncAudience = onDocumentDeleted(
  'FriendEdges/{edgeId}',
  async (event) => {
    const pair = edgeUids(event.data?.data());
    if (pair) await handleEdgeChange(pair, 'friendship removed');
  }
);

/**
 * Toggling friendsOfFriendsPosts changes who can see this user's content AND who this user can see,
 * so both sides of every distance-2 pair need recomputing.
 *
 * The guard is load-bearing: this trigger writes audienceUids back onto Profiles, which re-fires it.
 * Returning unless the FLAG itself changed is what stops that from looping.
 */
export const onProfileFofToggled = onDocumentUpdated('Profiles/{uid}', async (event) => {
  const before = (event.data?.before.data() as any)?.friendsOfFriendsPosts === true;
  const after = (event.data?.after.data() as any)?.friendsOfFriendsPosts === true;
  if (before === after) return;

  const uid = event.params.uid;
  try {
    const affected = await twoHopNeighbourhood(uid);
    const docs = await restampMany(affected);
    logger.info('audience: fof flag toggled', { uid, after, owners: affected.length, docsRestamped: docs });
  } catch (err) {
    logger.error('onProfileFofToggled failed', { uid, err });
  }
});
