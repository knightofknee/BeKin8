import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

async function deleteByQuery(
  colPath: string,
  whereField: string,
  whereValue: string
) {
  // Paginates and deletes in chunks
  const pageSize = 300;
  while (true) {
    const snap = await db
      .collection(colPath)
      .where(whereField, "==", whereValue)
      .limit(pageSize)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

async function deleteSubcollectionDocs(parentPath: string, subcol: string) {
  const pageSize = 300;
  while (true) {
    const snap = await db.collection(`${parentPath}/${subcol}`).limit(pageSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}

export const deleteAccountData = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const uid = context.auth.uid;

  // 1) Per-user subtree
  await deleteSubcollectionDocs(`users/${uid}`, "blocks");
  await db.doc(`users/${uid}`).delete().catch(() => {});

  // 2) Top-level collections that store user-owned docs
  // Posts: your feed queries Posts where author == uid
  await deleteByQuery("Posts", "author", uid);

  // Comments: if your schema is Comments.author == uid (adjust if different)
  await deleteByQuery("Comments", "author", uid).catch(() => {});

  // Beacons: ownerUid
  await deleteByQuery("Beacons", "ownerUid", uid).catch(() => {});

  // FriendRequests: sender/receiver
  await deleteByQuery("FriendRequests", "senderUid", uid).catch(() => {});
  await deleteByQuery("FriendRequests", "receiverUid", uid).catch(() => {});

  // Push tokens (you’re using a single doc id=uid; delete both ways for safety)
  await db.doc(`PushTokens/${uid}`).delete().catch(() => {});
  await deleteByQuery("PushTokens", "uid", uid).catch(() => {});

  // Profiles (top-level Profiles/{uid})
  await db.doc(`Profiles/${uid}`).delete().catch(() => {});

  // 3) Finally, delete Auth user
  await admin.auth().deleteUser(uid).catch(() => {});

  return { ok: true };
});
