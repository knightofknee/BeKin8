// functions/src/friendsOfFriends.ts
// Friends-of-friends discovery for the symmetric opt-in "friends of friends posts" feature.
//
// Semantics: caller A and candidate C are NOT friends but share at least one mutual
// accepted friend (distance exactly 2, never further). If BOTH A and C have
// Profiles/{uid}.friendsOfFriendsPosts === true, each sees the other's posts exactly
// like a regular friend. If either side has the flag off, they are invisible to each
// other through this feature.
//
// Privacy rationale: friend lists are not client-readable, so this callable is the
// ONLY surface that reveals FoF uids, and it reveals them only to mutually opted-in
// users. Blocks in either direction (users/{me}/blocks/{C} or users/{C}/blocks/{me})
// remove a candidate even when a mutual friend exists.
//
// NOTE: acceptedFriendUidsOf combines array-contains with an equality filter, which
// requires a FriendEdges composite index on (uids array-contains, state ascending).
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

type GetFriendsOfFriendsResponse = { uids: string[] };

/** Split an array into chunks of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Accepted friend uids for a user. Unlike the notification-path friendUidsOf helper in
 * index.ts, this REQUIRES state === 'accepted': blocked or pending edges must not seed
 * the friends-of-friends graph.
 */
async function acceptedFriendUidsOf(uid: string): Promise<string[]> {
  const qs = await db
    .collection('FriendEdges')
    .where('uids', 'array-contains', uid)
    .where('state', '==', 'accepted')
    .get();

  const out = new Set<string>();
  qs.forEach((doc) => {
    const data = doc.data() as any;
    const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const other = uids[0] === uid ? uids[1] : uids[0];
    if (other && other !== uid) out.add(other);
  });

  return Array.from(out);
}

export const getFriendsOfFriends = onCall<unknown, Promise<GetFriendsOfFriendsResponse>>(
  { enforceAppCheck: false },
  async (req) => {
    const me = req.auth?.uid;
    if (!me) throw new HttpsError('unauthenticated', 'Sign in required.');

    // Cheap early-out: the feature is symmetric, so a caller who has not opted in can
    // never see (or be seen by) anyone.
    const myProfile = await db.collection('Profiles').doc(me).get();
    if (!myProfile.exists || (myProfile.data() as any)?.friendsOfFriendsPosts !== true) {
      return { uids: [] };
    }

    // 1) My direct accepted friends.
    const myFriends = await acceptedFriendUidsOf(me);
    if (myFriends.length === 0) return { uids: [] };
    const myFriendSet = new Set(myFriends);

    // 2) Their accepted friends (distance exactly 2). Small friend counts are the norm
    // for this app, so one query per friend under a single Promise.all is fine; chunk
    // larger friend lists to be kind to Firestore.
    const candidateSet = new Set<string>();
    const friendChunks = myFriends.length > 50 ? chunk(myFriends, 25) : [myFriends];
    for (const group of friendChunks) {
      const results = await Promise.all(group.map((f) => acceptedFriendUidsOf(f)));
      for (const uids of results) for (const c of uids) candidateSet.add(c);
    }

    // 3) Union minus my direct friends and me.
    candidateSet.delete(me);
    for (const f of myFriendSet) candidateSet.delete(f);
    const candidates = Array.from(candidateSet);
    if (candidates.length === 0) return { uids: [] };

    // 4) Keep only candidates who have themselves opted in (symmetric requirement),
    // one batched getAll per 300 refs.
    const optedIn: string[] = [];
    for (const group of chunk(candidates, 300)) {
      const snaps = await db.getAll(...group.map((c) => db.collection('Profiles').doc(c)));
      snaps.forEach((snap) => {
        if (snap.exists && (snap.data() as any)?.friendsOfFriendsPosts === true) {
          optedIn.push(snap.id);
        }
      });
    }
    if (optedIn.length === 0) return { uids: [] };

    // 5) Blocks in BOTH directions make a pair invisible to each other even through a
    // mutual friend: drop C when users/{me}/blocks/{C} OR users/{C}/blocks/{me} exists.
    const blocked = new Set<string>();
    for (const group of chunk(optedIn, 300)) {
      const [myBlocks, theirBlocks] = await Promise.all([
        db.getAll(...group.map((c) => db.collection('users').doc(me).collection('blocks').doc(c))),
        db.getAll(...group.map((c) => db.collection('users').doc(c).collection('blocks').doc(me))),
      ]);
      myBlocks.forEach((snap, i) => {
        if (snap.exists) blocked.add(group[i]);
      });
      theirBlocks.forEach((snap, i) => {
        if (snap.exists) blocked.add(group[i]);
      });
    }

    const uids = optedIn.filter((c) => !blocked.has(c)).sort();
    logger.info('getFriendsOfFriends: resolved', {
      me,
      friends: myFriends.length,
      candidates: candidates.length,
      optedIn: optedIn.length,
      blocked: blocked.size,
      returned: uids.length,
    });
    return { uids };
  }
);
