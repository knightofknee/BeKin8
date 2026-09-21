#!/usr/bin/env node
// tools/seedDemoData.js
//
// Seeds screenshot-ready demo data around ONE demo viewer account (default test4@test.com):
// five fake friends (auth users + Profiles + FriendEdges + denorms), lit beacons for today and
// later this week, a busy hangout chatroom, a handful of feed posts with comments. Everything the
// fakes write is visible ONLY to the demo viewer and to each other, so no real account's feed or
// notifications are touched. Dates are relative to "now", so re-run it right before any screenshot
// session and the beacons land on today again.
//
//   node tools/seedDemoData.js           # (re)seed: wipes prior seed content, writes fresh
//   node tools/seedDemoData.js --wipe    # remove all seed content AND the fake accounts
//
// Auth: Application Default Credentials (gcloud auth application-default login).

const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'waldgrave-profiles';
const VIEWER_EMAIL = process.env.SEED_VIEWER_EMAIL || 'test4@test.com';
const VIEWER_DISPLAY_NAME = 'Alex';
const WIPE = process.argv.includes('--wipe');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

// Deterministic uids so a wipe can find everything and a re-run never duplicates accounts.
const FAKES = [
  { uid: 'seed_maya',   username: 'maya',     displayName: 'Maya',   color: '#EC4899' },
  { uid: 'seed_jordan', username: 'jordan_k', displayName: 'Jordan', color: '#3B82F6' },
  { uid: 'seed_dev',    username: 'devp',     displayName: 'Dev',    color: '#10B981' },
  { uid: 'seed_sam',    username: 'sammy',    displayName: 'Sam',    color: '#F59E0B' },
  { uid: 'seed_priya',  username: 'priya',    displayName: 'Priya',  color: '#8B5CF6' },
];
const byUid = Object.fromEntries(FAKES.map((f) => [f.uid, f]));
const isSeedUid = (uid) => typeof uid === 'string' && uid.startsWith('seed_');

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function daysFromNow(n) { const x = new Date(); x.setDate(x.getDate() + n); return x; }
function yyyymmdd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function edgeId(a, b) { return [a, b].sort().join('_'); }
function minutesAgo(n) { return new Date(Date.now() - n * 60_000); }
function hoursAgo(n) { return new Date(Date.now() - n * 3_600_000); }

async function commitAll(ops) {
  // ops: array of (batch) => void ; chunked under the 500-op cap
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

async function deleteQuery(q, label) {
  const snap = await q.get();
  if (snap.empty) return 0;
  const ops = [];
  for (const d of snap.docs) {
    // subcollections first (ChatMessages / comments)
    const subs = await d.ref.listCollections();
    for (const sub of subs) {
      const subSnap = await sub.get();
      subSnap.forEach((s) => ops.push((b) => b.delete(s.ref)));
    }
    ops.push((b) => b.delete(d.ref));
  }
  await commitAll(ops);
  console.log(`  deleted ${snap.size} ${label}`);
  return snap.size;
}

async function wipeContent(viewerUid) {
  console.log('Wiping prior seed content...');
  for (const f of FAKES) {
    await deleteQuery(db.collection('Beacons').where('ownerUid', '==', f.uid), `beacons by ${f.username}`);
    await deleteQuery(db.collection('Posts').where('author', '==', f.uid), `posts by ${f.username}`);
  }
  // The viewer's own seeded beacon (deterministic id pattern, only the ones we tagged)
  await deleteQuery(db.collection('Beacons').where('ownerUid', '==', viewerUid).where('seed', '==', true), 'viewer seed beacons');
  await deleteQuery(db.collection('FriendGroups').where('ownerUid', '==', viewerUid).where('seed', '==', true), 'viewer seed groups');
}

async function wipeAccounts(viewerUid) {
  console.log('Removing fake accounts + friendships...');
  const ops = [];
  const all = [...FAKES.map((f) => f.uid), viewerUid];
  for (const a of all) for (const b of all) {
    if (a < b && (isSeedUid(a) || isSeedUid(b))) ops.push((batch) => batch.delete(db.doc(`FriendEdges/${edgeId(a, b)}`)));
  }
  for (const f of FAKES) {
    ops.push((b) => b.delete(db.doc(`users/${viewerUid}/friends/${f.uid}`)));
    ops.push((b) => b.delete(db.doc(`Profiles/${f.uid}`)));
    ops.push((b) => b.delete(db.doc(`users/${f.uid}`)));
    ops.push((b) => b.delete(db.doc(`Usernames/${f.username}`)));
    const friendsSnap = await db.collection(`users/${f.uid}/friends`).get();
    friendsSnap.forEach((d) => ops.push((b) => b.delete(d.ref)));
  }
  await commitAll(ops);
  // Friends/{viewer} legacy array + audience lists
  const legacy = await db.doc(`Friends/${viewerUid}`).get();
  if (legacy.exists) {
    const arr = (legacy.data().friends || []).filter((x) => !isSeedUid(x?.uid));
    await legacy.ref.set({ friends: arr }, { merge: true });
  }
  await db.doc(`Profiles/${viewerUid}`).set(
    { audienceUids: FieldValue.arrayRemove(...FAKES.map((f) => f.uid)) },
    { merge: true }
  );
  for (const f of FAKES) {
    try { await admin.auth().deleteUser(f.uid); console.log(`  auth user ${f.uid} deleted`); } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }
  }
}

async function ensureFakeAccounts(viewerUid, viewerName) {
  console.log('Ensuring fake accounts + friendships...');
  for (const f of FAKES) {
    try {
      await admin.auth().getUser(f.uid);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      await admin.auth().createUser({
        uid: f.uid,
        email: `${f.uid}@bekin-seed.invalid`,
        emailVerified: true,
        displayName: f.displayName,
        disabled: true, // never sign in as these
      });
      console.log(`  created auth user ${f.uid}`);
    }
  }

  // Never steal a real person's username: abort if any handle already belongs to a non-seed uid.
  const taken = await db.collection('Profiles').where('usernameLower', 'in', FAKES.map((f) => f.username.toLowerCase())).get();
  taken.forEach((d) => {
    if (!isSeedUid(d.id)) throw new Error(`username ${d.data().username} already belongs to ${d.id}; pick another handle in FAKES`);
  });

  const everyone = [viewerUid, ...FAKES.map((f) => f.uid)];
  const now = Timestamp.now();
  const ops = [];

  for (const f of FAKES) {
    const friends = everyone.filter((u) => u !== f.uid);
    ops.push((b) => b.set(db.doc(`users/${f.uid}`), {
      uid: f.uid,
      email: `${f.uid}@bekin-seed.invalid`,
      username: f.username,
      hasUsername: true,
      bonusPosts: 3,
      createdAt: Timestamp.fromDate(daysFromNow(-45)),
      seed: true,
    }, { merge: true }));
    ops.push((b) => b.set(db.doc(`Profiles/${f.uid}`), {
      username: f.username,
      usernameLower: f.username.toLowerCase(),
      displayName: f.displayName,
      avatarColor: f.color,
      profileColor: f.color,
      commentsEnabled: true,
      newPostNotify: false,
      postCommentNotify: false,
      updatedAt: now,
      audienceUids: [f.uid, ...friends],
      seed: true,
    }, { merge: true }));
    ops.push((b) => b.set(db.doc(`Usernames/${f.username}`), { uid: f.uid, seed: true }, { merge: true }));
  }

  // Full mesh: every fake is friends with the viewer and with every other fake, so chat rosters
  // and comment threads between them look natural.
  for (const a of everyone) for (const b_ of everyone) {
    if (a >= b_) continue;
    if (!isSeedUid(a) && !isSeedUid(b_)) continue;
    ops.push((b) => b.set(db.doc(`FriendEdges/${edgeId(a, b_)}`), {
      uids: [a, b_], state: 'accepted', createdAt: now, updatedAt: now,
    }, { merge: true }));
    const nameOf = (u) => (u === viewerUid ? viewerName : byUid[u].displayName);
    ops.push((b) => b.set(db.doc(`users/${a}/friends/${b_}`), { uid: b_, status: 'accepted', username: nameOf(b_), acceptedAt: now, notify: true }, { merge: true }));
    ops.push((b) => b.set(db.doc(`users/${b_}/friends/${a}`), { uid: a, status: 'accepted', username: nameOf(a), acceptedAt: now, notify: true }, { merge: true }));
  }

  // Viewer: audience, legacy Friends array, a friendlier display name for the screenshots.
  ops.push((b) => b.set(db.doc(`Profiles/${viewerUid}`), {
    displayName: viewerName,
    audienceUids: FieldValue.arrayUnion(...FAKES.map((f) => f.uid)),
  }, { merge: true }));
  ops.push((b) => b.set(db.doc(`Friends/${viewerUid}`), {
    friends: FieldValue.arrayUnion(...FAKES.map((f) => ({ uid: f.uid, username: f.displayName }))),
  }, { merge: true }));

  await commitAll(ops);
}

async function seedContent(viewerUid, viewerName) {
  console.log('Seeding beacons, chat, posts...');
  const everyone = [viewerUid, ...FAKES.map((f) => f.uid)];
  const ops = [];
  const audienceOf = (owner) => everyone; // full mesh, so every seed doc is visible to all of them

  // ---- Beacons -------------------------------------------------------------------------
  const beaconPlan = [
    { uid: 'seed_maya',   day: 0, time: '19:00', msg: 'Pizza and a movie at mine, come by after 7', createdMinsAgo: 95 },
    { uid: 'seed_jordan', day: 0, time: '18:30', msg: 'Drinks after work? Lantern at 6:30',        createdMinsAgo: 40 },
    { uid: 'seed_sam',    day: 2, time: '19:30', msg: 'Board game night, bring snacks',           createdMinsAgo: 60 * 20 },
    { uid: 'seed_dev',    day: 3, time: '08:00', msg: 'Morning hike, coffee after',               createdMinsAgo: 60 * 26 },
    { uid: 'seed_priya',  day: 4, time: '11:00', msg: "Brunch? I'll book a table",                createdMinsAgo: 60 * 5 },
  ];
  const beaconIds = {};
  for (const p of beaconPlan) {
    const f = byUid[p.uid];
    const day = daysFromNow(p.day);
    const sd = startOfDay(day), ed = endOfDay(day);
    const id = `${p.uid}_${yyyymmdd(day)}`;
    beaconIds[p.uid] = id;
    const created = Timestamp.fromDate(minutesAgo(p.createdMinsAgo));
    ops.push((b) => b.set(db.doc(`Beacons/${id}`), {
      ownerUid: p.uid,
      ownerName: f.displayName,
      message: p.msg,
      details: p.msg,
      active: true,
      scheduled: true,
      createdAt: created,
      updatedAt: created,
      startAt: Timestamp.fromDate(sd),
      expiresAt: Timestamp.fromDate(ed),
      groupIds: [],
      timeHHmm: p.time,
      audienceUids: audienceOf(p.uid),
      seed: true,
    }));
  }

  // The viewer's own lit beacon for today so the centerpiece renders lit.
  {
    const day = new Date();
    const id = `${viewerUid}_${yyyymmdd(day)}`;
    const created = Timestamp.fromDate(minutesAgo(30));
    ops.push((b) => b.set(db.doc(`Beacons/${id}`), {
      ownerUid: viewerUid,
      ownerName: viewerName,
      message: "Free tonight, who's around?",
      details: "Free tonight, who's around?",
      active: true,
      scheduled: true,
      createdAt: created,
      updatedAt: created,
      startAt: Timestamp.fromDate(startOfDay(day)),
      expiresAt: Timestamp.fromDate(endOfDay(day)),
      groupIds: [],
      timeHHmm: '18:00',
      audienceUids: audienceOf(viewerUid),
      seed: true,
    }, { merge: true }));
  }

  // ---- Chat on Maya's beacon --------------------------------------------------------------
  const chatBeacon = beaconIds.seed_maya;
  const chatExpires = Timestamp.fromDate(endOfDay(new Date()));
  const chatAudience = audienceOf('seed_maya');
  let t = 88; // minutes ago, counting down
  const say = (uid, text, gapMin = 3, reactions) => {
    t -= gapMin;
    const name = uid === viewerUid ? viewerName : byUid[uid].displayName;
    const ref = db.collection(`Beacons/${chatBeacon}/ChatMessages`).doc();
    const createdAt = Timestamp.fromDate(minutesAgo(t)); // eager: closures below run after t moved on
    ops.push((b) => b.set(ref, {
      text, authorUid: uid, authorName: name, type: 'user',
      audienceUids: chatAudience, createdAt, expiresAt: chatExpires,
      ...(reactions ? { reactions } : {}),
    }));
  };
  const imIn = (uid, gapMin = 2) => {
    t -= gapMin;
    const name = uid === viewerUid ? viewerName : byUid[uid].displayName;
    const ref = db.collection(`Beacons/${chatBeacon}/ChatMessages`).doc();
    const createdAt = Timestamp.fromDate(minutesAgo(t));
    ops.push((b) => b.set(ref, {
      type: 'system', subtype: 'im-in', actorUid: uid, actorName: name, authorUid: uid,
      audienceUids: chatAudience, text: `${name} is in`,
      createdAt, expiresAt: chatExpires,
    }));
  };
  imIn('seed_jordan', 0);
  say('seed_maya', "door's unlocked, just come in", 4);
  imIn(viewerUid, 6);
  say('seed_jordan', 'bringing the good chips', 5);
  say(viewerUid, "I'll grab wine on the way, red or white?", 7);
  say('seed_maya', 'red 🍷', 2, { '🔥': ['seed_jordan'] });
  say('seed_jordan', 'can we finally watch the new Dune', 9);
  say('seed_maya', 'already queued up 🎬', 3, { '🙌': [viewerUid, 'seed_jordan'] });
  imIn('seed_priya', 12);
  say('seed_priya', 'running late, save me a slice', 1);
  say('seed_maya', 'always', 4);

  // ---- Posts --------------------------------------------------------------------------------
  const postPlan = [
    { uid: 'seed_maya',   at: hoursAgo(2),  title: 'Ramen place on 5th is legit',
      content: "Finally went. The spicy miso is the move, and they'll do a half portion if you want to save room for the gyoza. Who's in for round two next week?",
      comments: [['seed_jordan', 'round two is a yes'], ['seed_sam', 'I still think about that gyoza']] },
    { uid: 'seed_dev',    at: hoursAgo(19), title: 'Week 6 of marathon training',
      content: 'Long run was 14 miles this morning and my legs have opinions. Sunday runs are an open invite if anyone wants to do the slow miles with me.',
      comments: [['seed_priya', 'the slow miles are the best miles']] },
    { uid: 'seed_jordan', at: hoursAgo(27), title: 'Anyone have a ladder?',
      content: 'Need to clean the gutters before it rains again. Will trade for beer and my undying gratitude.',
      comments: [['seed_dev', 'yes, come grab it whenever'], ['seed_jordan', 'legend']] },
    { uid: 'seed_priya',  at: hoursAgo(44), title: 'Book rec: Tomorrow, and Tomorrow, and Tomorrow',
      content: "Stayed up way too late finishing it. If you ever made a game in your parents' basement, or just like a good story about friendship, this one's for you." },
    { uid: 'seed_sam',    at: hoursAgo(52), title: 'Fantasy draft recap',
      content: 'Autodraft got me three kickers. Three. Anyone want to trade before Thursday?',
      comments: [['seed_maya', 'lol no']] },
    { uid: 'seed_maya',   at: hoursAgo(70), title: 'Farmers market haul',
      content: 'Tomatoes, peaches, and a loaf of sourdough the size of my head. Come over Saturday and help me eat it.' },
    { uid: 'seed_dev',    at: hoursAgo(96), title: 'New coffee spot by the park',
      content: 'The cortado is great and they have a big table in the back. Good place to camp on a Sunday if anyone wants to bring a laptop or a book.' },
  ];
  for (const p of postPlan) {
    const f = byUid[p.uid];
    const ref = db.collection('Posts').doc();
    ops.push((b) => b.set(ref, {
      title: p.title,
      link: null,
      content: p.content,
      author: p.uid,
      authorName: f.username,
      timestamp: p.at.getTime(),
      timestampServer: Timestamp.fromDate(p.at),
      tags: [],
      audienceUids: audienceOf(p.uid),
      seed: true,
    }));
    (p.comments || []).forEach(([cu, text], i) => {
      const cf = byUid[cu];
      const cref = ref.collection('comments').doc();
      ops.push((b) => b.set(cref, {
        text, authorUid: cu, authorName: cf.displayName,
        createdAt: Timestamp.fromDate(new Date(p.at.getTime() + (i + 1) * 23 * 60_000)),
        deleted: false,
      }));
    });
  }

  // ---- Friend groups for the viewer (shown in the beacon options sheet) ----------------------
  // The tutorial's throwaway "test" group is removed so it never shows up in a screenshot; the
  // app recreates it on demand if a tour runs again.
  ops.push((b) => b.delete(db.doc(`FriendGroups/${viewerUid}__tutorial_test`)));
  const groupPlan = [
    { id: 'seed_group_close',    name: 'Close friends', members: ['seed_maya', 'seed_jordan', 'seed_priya'] },
    { id: 'seed_group_climbing', name: 'Climbing crew', members: ['seed_dev', 'seed_sam'] },
    { id: 'seed_group_neighbors', name: 'Neighbors',    members: ['seed_maya', 'seed_sam'] },
  ];
  for (const g of groupPlan) {
    ops.push((b) => b.set(db.doc(`FriendGroups/${viewerUid}__${g.id}`), {
      ownerUid: viewerUid, name: g.name, memberUids: g.members,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), seed: true,
    }));
  }

  await commitAll(ops);
  console.log(`  ${beaconPlan.length + 1} beacons, ${postPlan.length} posts, chat on Beacons/${chatBeacon}`);
}

(async () => {
  const viewer = await admin.auth().getUserByEmail(VIEWER_EMAIL);
  const viewerUid = viewer.uid;
  console.log(`Demo viewer: ${VIEWER_EMAIL} (${viewerUid})`);

  await wipeContent(viewerUid);
  if (WIPE) {
    await wipeAccounts(viewerUid);
    console.log('Done (wiped).');
    return;
  }
  await ensureFakeAccounts(viewerUid, VIEWER_DISPLAY_NAME);
  // Let the friend-edge audience triggers settle before content lands, so their recompute and our
  // explicit stamps agree (both produce the same full-mesh audience either way).
  await new Promise((r) => setTimeout(r, 4000));
  await seedContent(viewerUid, VIEWER_DISPLAY_NAME);
  console.log('Done. Sign in as the demo viewer and pull to refresh.');
})().catch((e) => { console.error(e); process.exit(1); });
