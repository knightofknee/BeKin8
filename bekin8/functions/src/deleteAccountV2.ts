// functions/src/deleteAccountV2.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

// Safe init (modular Admin v12)
const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

/** Delete a single doc if it exists. Returns true on success (or if absent). */
async function deleteDocIfExists(path: string): Promise<boolean> {
  try {
    const ref = db.doc(path);
    const snap = await ref.get();
    if (snap.exists) await ref.delete();
    return true;
  } catch (e) {
    logger.error(`Failed deleting ${path}`, e);
    return false;
  }
}

/** Delete docs in a subcollection under a parent, paginated. Returns true on success. */
async function deleteSubcollectionDocs(parentPath: string, subcol: string, pageSize = 300): Promise<boolean> {
  try {
    const colRef = db.collection(`${parentPath}/${subcol}`);
    while (true) {
      const snap = await colRef.limit(pageSize).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < pageSize) break;
    }
    return true;
  } catch (e) {
    logger.error(`Failed deleting subcollection ${parentPath}/${subcol}`, e);
    return false;
  }
}

/** Delete by query with operator support. Returns true on success. */
type Op = FirebaseFirestore.WhereFilterOp;
async function deleteByQuery(colPath: string, field: string, op: Op, value: any, pageSize = 300): Promise<boolean> {
  try {
    while (true) {
      const q = db.collection(colPath).where(field, op, value).limit(pageSize);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < pageSize) break;
    }
    return true;
  } catch (e) {
    logger.error(`Failed deleting by query ${colPath} where ${field} ${op} ${String(value)}`, e);
    return false;
  }
}

/**
 * Delete all docs in a collection GROUP matching field op value, paginated.
 * Used to erase this user's authored comments / chat messages wherever they live
 * (Posts/{postId}/comments/*, Beacons/{beaconId}/ChatMessages/*). Returns true on success.
 */
async function deleteByCollectionGroup(
  collectionId: string,
  field: string,
  op: Op,
  value: any,
  pageSize = 300,
): Promise<boolean> {
  try {
    while (true) {
      const snap = await db.collectionGroup(collectionId).where(field, op, value).limit(pageSize).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < pageSize) break;
    }
    return true;
  } catch (e) {
    logger.error(`Failed deleting collectionGroup ${collectionId} where ${field} ${op} ${String(value)}`, e);
    return false;
  }
}

/** Remove uid's entry from Friends/{ownerUid}.friends (array of {uid, username}). Returns true on success. */
async function removeUidFromFriendsArray(ownerUid: string, uidToRemove: string): Promise<boolean> {
  try {
    const ref = db.collection('Friends').doc(ownerUid);
    const snap = await ref.get();
    if (!snap.exists) return true;
    const arr = (snap.data() as any)?.friends;
    if (!Array.isArray(arr)) return true;
    const filtered = arr.filter((f: any) => {
      const fUid = typeof f === 'string' ? f : f?.uid;
      return fUid !== uidToRemove;
    });
    if (filtered.length !== arr.length) {
      await ref.set({ friends: filtered }, { merge: true });
    }
    return true;
  } catch (e) {
    logger.error(`Failed removing ${uidToRemove} from Friends/${ownerUid}`, e);
    return false;
  }
}

/**
 * Callable: deletes the caller's data + Auth user.
 * Auth required. PII (posts, comments, chat messages, profile, friend graph) is erased
 * before the Auth user is deleted. Aggregates failures and returns ok:false if any
 * critical step failed so the client can surface a retry.
 */
export const deleteAccountDataV2 = onCall({ enforceAppCheck: false, timeoutSeconds: 300 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) {
    return { ok: false, error: 'UNAUTHENTICATED', message: 'Sign in required.' };
  }

  logger.info('Starting account deletion', { uid });

  // Track failures. `critical` failures flip ok:false so the client can retry.
  const failures: string[] = [];
  const record = (label: string, ok: boolean, critical = true) => {
    if (!ok) {
      failures.push(label);
      if (!critical) logger.warn(`Non-critical deletion step failed: ${label}`, { uid });
    }
  };

  // Read the user's friend list + invite code up front, we need them for the
  // reverse-denorm cleanup and Invites deletion below.
  let friendUids: string[] = [];
  try {
    const friendDocs = await db.collection('users').doc(uid).collection('friends').get();
    friendUids = friendDocs.docs.map((d) => (typeof (d.data() as any)?.uid === 'string' ? (d.data() as any).uid : d.id));
  } catch (e) {
    logger.error('Failed reading friend list for cleanup', e);
    failures.push('read-friends');
  }

  let inviteCode: string | null = null;
  try {
    const prof = await db.collection('Profiles').doc(uid).get();
    const c = prof.exists ? (prof.data() as any)?.inviteCode : null;
    if (typeof c === 'string' && c) inviteCode = c;
  } catch (e) {
    logger.error('Failed reading invite code for cleanup', e);
  }

  // 1) Erase authored content (PII). collectionGroup sweeps hit comments/chat wherever
  //    they are nested. Comments: Posts/{postId}/comments/* with field authorUid.
  //    Chat: Beacons/{beaconId}/ChatMessages/* with field authorUid.
  record('posts', await deleteByQuery('Posts', 'author', '==', uid));
  record('posts-authorUid', await deleteByQuery('Posts', 'authorUid', '==', uid));
  record('comments', await deleteByCollectionGroup('comments', 'authorUid', '==', uid));
  record('chatMessages', await deleteByCollectionGroup('ChatMessages', 'authorUid', '==', uid));
  // RSVP "im-in" system chat messages carry actorUid/actorName (no authorUid), so sweep those too,
  // else the deleted user's uid + display name linger in other users' beacon chats.
  record('chatMessages-actor', await deleteByCollectionGroup('ChatMessages', 'actorUid', '==', uid));
  record('beacons', await deleteByQuery('Beacons', 'ownerUid', '==', uid));

  // 2) Reverse friend denorms: for each friend, drop users/{friendUid}/friends/{uid}
  //    and the uid's entry in Friends/{friendUid}.friends.
  for (const friendUid of friendUids) {
    if (!friendUid || friendUid === uid) continue;
    record(`reverse-friend-doc:${friendUid}`, await deleteDocIfExists(`users/${friendUid}/friends/${uid}`));
    record(`reverse-friends-array:${friendUid}`, await removeUidFromFriendsArray(friendUid, uid));
  }

  // 3) Friend graph docs owned by / referencing the user.
  record('friendRequests-sender', await deleteByQuery('FriendRequests', 'senderUid', '==', uid));
  record('friendRequests-receiver', await deleteByQuery('FriendRequests', 'receiverUid', '==', uid));
  record('friendEdges', await deleteByQuery('FriendEdges', 'uids', 'array-contains', uid));
  record('friendGroups', await deleteByQuery('FriendGroups', 'ownerUid', '==', uid));

  // 4) Per-user subtree (new + legacy). ChatMessages under the user's own (now deleted)
  //    Beacons are already gone via the collectionGroup sweep; deleting the Beacons docs
  //    above leaves no dangling parent for those. Sweep the user's own subcollections.
  const userRoot = `users/${uid}`;
  const userSubcols = ['friends', 'friendSubscriptions', 'pushTokens', 'blocks', 'silencedPosts'];
  for (const sc of userSubcols) {
    record(`user-subcol:${sc}`, await deleteSubcollectionDocs(userRoot, sc));
  }
  record('user-root', await deleteDocIfExists(userRoot));

  // 5) Top-level docs owned by user + invite code cleanup.
  record('profile', await deleteDocIfExists(`Profiles/${uid}`));
  record('friends-doc', await deleteDocIfExists(`Friends/${uid}`));
  if (inviteCode) {
    record('invite-code-doc', await deleteDocIfExists(`Invites/${inviteCode}`));
    // The Profiles doc (which held inviteCode) is deleted at step 5 above, so there is nothing left
    // to clear. Do NOT set(..., {merge:true}) here: on a non-existent doc that RESURRECTS an empty
    // Profiles/{uid}, leaving a ghost profile for a deleted account.
  }

  // 6) Legacy + ticket cleanup (non-critical: no PII, safe to retry later).
  record('legacy-pushtokens-doc', await deleteDocIfExists(`PushTokens/${uid}`), false);
  record('legacy-pushtokens-query', await deleteByQuery('PushTokens', 'uid', '==', uid), false);
  record('expoTickets', await deleteByQuery('expoPushTickets', 'subscriberUid', '==', uid), false);

  // 7) Auth user deletion LAST, so a failure earlier doesn't orphan the login.
  let authDeleted = false;
  try {
    await auth.deleteUser(uid);
    authDeleted = true;
  } catch (e) {
    logger.error('Failed to delete Auth user', e);
    failures.push('auth-user');
  }

  if (failures.length > 0) {
    logger.error('Account deletion completed with failures', { uid, failures, authDeleted });
    return {
      ok: false,
      error: 'PARTIAL',
      message: 'Some of your data could not be deleted. Please try again.',
      failed: failures,
    };
  }

  logger.info('Account deletion complete', { uid });
  return { ok: true };
});
