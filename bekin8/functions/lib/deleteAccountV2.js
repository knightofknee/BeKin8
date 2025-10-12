// functions/src/deleteAccount.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
// Safe init (modular Admin v12)
const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);
/** Delete a single doc if it exists. */
async function deleteDocIfExists(path) {
    try {
        const ref = db.doc(path);
        const snap = await ref.get();
        if (snap.exists)
            await ref.delete();
    }
    catch (e) {
        logger.error(`Failed deleting ${path}`, e);
    }
}
/** Delete docs in a subcollection under a parent, paginated. */
async function deleteSubcollectionDocs(parentPath, subcol, pageSize = 300) {
    try {
        const colRef = db.collection(`${parentPath}/${subcol}`);
        while (true) {
            const snap = await colRef.limit(pageSize).get();
            if (snap.empty)
                break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            if (snap.size < pageSize)
                break;
        }
    }
    catch (e) {
        logger.error(`Failed deleting subcollection ${parentPath}/${subcol}`, e);
    }
}
async function deleteByQuery(colPath, field, op, value, pageSize = 300) {
    try {
        while (true) {
            const q = db.collection(colPath).where(field, op, value).limit(pageSize);
            const snap = await q.get();
            if (snap.empty)
                break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            if (snap.size < pageSize)
                break;
        }
    }
    catch (e) {
        logger.error(`Failed deleting by query ${colPath} where ${field} ${op} ${String(value)}`, e);
    }
}
/**
 * Callable: deletes (most) user data + Auth user.
 * Auth required; deletes the caller's data.
 */
export const deleteAccountDataV2 = onCall({ enforceAppCheck: false }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        return { ok: false, error: 'UNAUTHENTICATED', message: 'Sign in required.' };
    }
    logger.info('Starting account deletion', { uid });
    // 1) Per-user subtree (new + legacy)
    const userRoot = `users/${uid}`;
    const userSubcols = ['friends', 'friendSubscriptions', 'pushTokens', 'blocks'];
    await Promise.all(userSubcols.map((sc) => deleteSubcollectionDocs(userRoot, sc)));
    await deleteDocIfExists(userRoot);
    // 2) Top-level docs owned by user
    await deleteDocIfExists(`Profiles/${uid}`);
    await deleteDocIfExists(`Friends/${uid}`);
    // 3) Collections referencing the user
    await deleteByQuery('Posts', 'author', '==', uid);
    await deleteByQuery('Comments', 'author', '==', uid);
    await deleteByQuery('Beacons', 'ownerUid', '==', uid);
    await deleteByQuery('FriendRequests', 'senderUid', '==', uid);
    await deleteByQuery('FriendRequests', 'receiverUid', '==', uid);
    await deleteByQuery('FriendEdges', 'uids', 'array-contains', uid);
    // Legacy push tokens
    await deleteDocIfExists(`PushTokens/${uid}`);
    await deleteByQuery('PushTokens', 'uid', '==', uid);
    // If you store Expo tickets per user
    await deleteByQuery('expoPushTickets', 'subscriberUid', '==', uid);
    // 4) Auth user
    try {
        await auth.deleteUser(uid);
    }
    catch (e) {
        logger.error('Failed to delete Auth user', e);
    }
    logger.info('Account deletion complete', { uid });
    return { ok: true };
});
