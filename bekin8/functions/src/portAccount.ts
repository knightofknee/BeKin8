// functions/src/portAccount.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

// ===== Helpers =====

/** Verify email/password via Firebase Auth REST API. Returns the old UID. */
async function verifyPassword(email: string, password: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error?.message || 'INVALID_CREDENTIALS');
  }
  const data = await res.json();
  return data.localId as string;
}

/** Copy subcollection docs from one parent to another, skipping docs that already exist at destination. */
async function copySubcollectionDeduped(fromParent: string, toParent: string, subcol: string) {
  const [fromSnap, toSnap] = await Promise.all([
    db.collection(`${fromParent}/${subcol}`).get(),
    db.collection(`${toParent}/${subcol}`).get(),
  ]);
  if (fromSnap.empty) return;

  const existingIds = new Set(toSnap.docs.map((d) => d.id));
  const toCopy = fromSnap.docs.filter((d) => !existingIds.has(d.id));
  if (toCopy.length === 0) return;

  for (let i = 0; i < toCopy.length; i += 400) {
    const batch = db.batch();
    toCopy.slice(i, i + 400).forEach((d) => {
      batch.set(db.doc(`${toParent}/${subcol}/${d.id}`), d.data());
    });
    await batch.commit();
  }
}

/** Update docs matching a query, paginated. */
async function updateByQuery(
  colPath: string,
  field: string,
  op: FirebaseFirestore.WhereFilterOp,
  value: any,
  updates: Record<string, any>,
  pageSize = 300,
) {
  while (true) {
    const snap = await db.collection(colPath).where(field, op, value).limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, updates));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

/** Update docs in a collection group query, paginated. */
async function updateCollectionGroup(
  collectionId: string,
  field: string,
  op: FirebaseFirestore.WhereFilterOp,
  value: any,
  updates: Record<string, any>,
  pageSize = 300,
) {
  while (true) {
    const snap = await db.collectionGroup(collectionId).where(field, op, value).limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, updates));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

/** Replace oldUid with newUid inside an array field, with dedup. */
function replaceInArray(arr: string[], oldUid: string, newUid: string): string[] {
  return [...new Set(arr.map((u) => (u === oldUid ? newUid : u)))];
}

/** Delete subcollection docs, paginated. */
async function deleteSubcollectionDocs(parentPath: string, subcol: string, pageSize = 300) {
  while (true) {
    const snap = await db.collection(`${parentPath}/${subcol}`).limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

/** Delete a single doc if it exists. */
async function deleteDocIfExists(path: string) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}

/** Delete by query, paginated. */
async function deleteByQuery(
  colPath: string,
  field: string,
  op: FirebaseFirestore.WhereFilterOp,
  value: any,
  pageSize = 300,
) {
  while (true) {
    const snap = await db.collection(colPath).where(field, op, value).limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

// ===== Main callable =====

/**
 * Port data from an old email/password account to the caller's current account.
 * Moves friends, posts, beacons, comments, and cleans up the old account.
 */
export const portAccountData = onCall(
  { enforceAppCheck: false, timeoutSeconds: 300 },
  async (req) => {
    const newUid = req.auth?.uid;
    if (!newUid) {
      return { ok: false, error: 'UNAUTHENTICATED', message: 'Sign in required.' };
    }

    const { oldEmail, oldPassword, apiKey } = req.data as {
      oldEmail?: string;
      oldPassword?: string;
      apiKey?: string;
    };

    if (!oldEmail?.trim() || !oldPassword || !apiKey) {
      return { ok: false, error: 'MISSING_FIELDS', message: 'Email, password, and API key are required.' };
    }

    // 1) Verify old credentials
    let oldUid: string;
    try {
      oldUid = await verifyPassword(oldEmail.trim(), oldPassword, apiKey);
    } catch (e: any) {
      logger.warn('Port: credential verification failed', { newUid, oldEmail: oldEmail.trim() });
      return { ok: false, error: 'INVALID_CREDENTIALS', message: 'Could not verify the old account. Check email and password.' };
    }

    if (oldUid === newUid) {
      return { ok: false, error: 'SAME_ACCOUNT', message: 'That is the same account you are signed into.' };
    }

    logger.info('Starting account port', { oldUid, newUid, oldEmail: oldEmail.trim() });

    try {
      // ── 2) Port friends subcollection ──
      // users/{oldUid}/friends → users/{newUid}/friends (skip dupes)
      await copySubcollectionDeduped(`users/${oldUid}`, `users/${newUid}`, 'friends');

      // ── 3) Port FriendEdges ──
      // Pre-fetch new user's current friend set for dedup
      const newEdgesSnap = await db.collection('FriendEdges')
        .where('uids', 'array-contains', newUid).get();
      const newFriendUids = new Set<string>();
      newEdgesSnap.forEach((d) => {
        const u: string[] = d.data()?.uids || [];
        u.forEach((uid) => { if (uid !== newUid) newFriendUids.add(uid); });
      });

      const oldEdgesSnap = await db.collection('FriendEdges')
        .where('uids', 'array-contains', oldUid).get();

      for (let i = 0; i < oldEdgesSnap.docs.length; i += 400) {
        const batch = db.batch();
        oldEdgesSnap.docs.slice(i, i + 400).forEach((edgeDoc) => {
          const uids: string[] = edgeDoc.data()?.uids || [];
          const otherUid = uids.find((u) => u !== oldUid);
          if (!otherUid) { batch.delete(edgeDoc.ref); return; }

          if (newFriendUids.has(otherUid)) {
            // Already friends via new account — delete duplicate edge
            batch.delete(edgeDoc.ref);
          } else {
            // Reassign edge to new account
            batch.update(edgeDoc.ref, { uids: replaceInArray(uids, oldUid, newUid) });
            newFriendUids.add(otherUid);
          }
        });
        await batch.commit();
      }

      // ── 4) Update reverse friend docs ──
      // For each friend of the old account, rename users/{friendUid}/friends/{oldUid} → {newUid}
      const oldFriendDocs = await db.collection(`users/${oldUid}/friends`).get();
      for (const fDoc of oldFriendDocs.docs) {
        const friendUid = fDoc.id;
        try {
          const reverseRef = db.doc(`users/${friendUid}/friends/${oldUid}`);
          const reverseSnap = await reverseRef.get();
          if (!reverseSnap.exists) continue;

          const newReverseRef = db.doc(`users/${friendUid}/friends/${newUid}`);
          const newReverseSnap = await newReverseRef.get();
          if (!newReverseSnap.exists) {
            // Copy to new key with updated uid
            await newReverseRef.set({ ...reverseSnap.data(), uid: newUid });
          }
          await reverseRef.delete();
        } catch (e) {
          logger.warn('Failed updating reverse friend doc', { friendUid, oldUid, newUid, error: e });
        }
      }

      // ── 5) Port FriendRequests ──
      await updateByQuery('FriendRequests', 'senderUid', '==', oldUid, { senderUid: newUid });
      await updateByQuery('FriendRequests', 'receiverUid', '==', oldUid, { receiverUid: newUid });

      // ── 6) Port Posts ──
      await updateByQuery('Posts', 'author', '==', oldUid, { author: newUid });

      // ── 7) Port post comments (collection group) ──
      try {
        await updateCollectionGroup('comments', 'authorUid', '==', oldUid, { authorUid: newUid });
      } catch (e: any) {
        logger.warn('Comments collection group update failed (index may be needed)', { error: e?.message });
      }

      // ── 8) Port Beacons (owned) ──
      await updateByQuery('Beacons', 'ownerUid', '==', oldUid, { ownerUid: newUid });

      // ── 9) Port beacon chat messages (collection group) ──
      try {
        await updateCollectionGroup('ChatMessages', 'authorUid', '==', oldUid, { authorUid: newUid });
      } catch (e: any) {
        logger.warn('ChatMessages collection group update failed (index may be needed)', { error: e?.message });
      }

      // ── 10) Port FriendGroups (owned) ──
      await updateByQuery('FriendGroups', 'ownerUid', '==', oldUid, { ownerUid: newUid });

      // ── 11) Update array references in Beacons (allowedUids, inUids) ──
      const beaconsAllowed = await db.collection('Beacons')
        .where('allowedUids', 'array-contains', oldUid).get();
      for (const bDoc of beaconsAllowed.docs) {
        const arr: string[] = bDoc.data()?.allowedUids || [];
        await bDoc.ref.update({ allowedUids: replaceInArray(arr, oldUid, newUid) });
      }

      const beaconsIn = await db.collection('Beacons')
        .where('inUids', 'array-contains', oldUid).get();
      for (const bDoc of beaconsIn.docs) {
        const arr: string[] = bDoc.data()?.inUids || [];
        await bDoc.ref.update({ inUids: replaceInArray(arr, oldUid, newUid) });
      }

      // ── 12) Update array references in FriendGroups (memberUids) ──
      const groupsWithOld = await db.collection('FriendGroups')
        .where('memberUids', 'array-contains', oldUid).get();
      for (const gDoc of groupsWithOld.docs) {
        const arr: string[] = gDoc.data()?.memberUids || [];
        await gDoc.ref.update({ memberUids: replaceInArray(arr, oldUid, newUid) });
      }

      // ── 13) Merge legacy Friends doc ──
      const oldFriendsDoc = await db.doc(`Friends/${oldUid}`).get();
      if (oldFriendsDoc.exists) {
        const oldArr: string[] = oldFriendsDoc.data()?.friends || [];
        if (oldArr.length > 0) {
          await db.doc(`Friends/${newUid}`).set(
            { friends: FieldValue.arrayUnion(...oldArr) },
            { merge: true },
          );
        }
        await db.doc(`Friends/${oldUid}`).delete();
      }

      // ── 14) Port other subcollections ──
      await copySubcollectionDeduped(`users/${oldUid}`, `users/${newUid}`, 'friendSubscriptions');
      await copySubcollectionDeduped(`users/${oldUid}`, `users/${newUid}`, 'blocks');
      await copySubcollectionDeduped(`users/${oldUid}`, `users/${newUid}`, 'silencedPosts');

      // ── 15) Clean up old account data ──
      const oldSubcols = ['friends', 'friendSubscriptions', 'pushTokens', 'blocks', 'silencedPosts'];
      await Promise.all(oldSubcols.map((sc) => deleteSubcollectionDocs(`users/${oldUid}`, sc)));
      await deleteDocIfExists(`users/${oldUid}`);
      await deleteDocIfExists(`Profiles/${oldUid}`);
      await deleteDocIfExists(`PushTokens/${oldUid}`);
      await deleteByQuery('PushTokens', 'uid', '==', oldUid);
      await deleteByQuery('expoPushTickets', 'subscriberUid', '==', oldUid);

      // ── 16) Delete old Auth user ──
      try {
        await auth.deleteUser(oldUid);
      } catch (e) {
        logger.error('Failed to delete old Auth user (non-fatal)', { oldUid, error: e });
      }

      logger.info('Account port complete', { oldUid, newUid });
      return { ok: true, ported: { oldUid, oldEmail: oldEmail.trim() } };

    } catch (e: any) {
      logger.error('Account port failed', { oldUid, newUid, error: e?.message, stack: e?.stack });
      return {
        ok: false,
        error: 'PORT_FAILED',
        message: 'Something went wrong during the port. Some data may have been partially moved. Contact support if needed.',
      };
    }
  },
);
