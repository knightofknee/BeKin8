"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAccountData = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
async function deleteByQuery(colPath, whereField, whereValue) {
    // Paginates and deletes in chunks
    const pageSize = 300;
    while (true) {
        const snap = await db
            .collection(colPath)
            .where(whereField, "==", whereValue)
            .limit(pageSize)
            .get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < pageSize)
            break;
    }
}
async function deleteSubcollectionDocs(parentPath, subcol) {
    const pageSize = 300;
    while (true) {
        const snap = await db.collection(`${parentPath}/${subcol}`).limit(pageSize).get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < pageSize)
            break;
    }
}
exports.deleteAccountData = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = context.auth.uid;
    // 1) Per-user subtree
    await deleteSubcollectionDocs(`users/${uid}`, "blocks");
    await db.doc(`users/${uid}`).delete().catch(() => { });
    // 2) Top-level collections that store user-owned docs
    // Posts: your feed queries Posts where author == uid
    await deleteByQuery("Posts", "author", uid);
    // Comments: if your schema is Comments.author == uid (adjust if different)
    await deleteByQuery("Comments", "author", uid).catch(() => { });
    // Beacons: ownerUid
    await deleteByQuery("Beacons", "ownerUid", uid).catch(() => { });
    // FriendRequests: sender/receiver
    await deleteByQuery("FriendRequests", "senderUid", uid).catch(() => { });
    await deleteByQuery("FriendRequests", "receiverUid", uid).catch(() => { });
    // Push tokens (you’re using a single doc id=uid; delete both ways for safety)
    await db.doc(`PushTokens/${uid}`).delete().catch(() => { });
    await deleteByQuery("PushTokens", "uid", uid).catch(() => { });
    // Profiles (top-level Profiles/{uid})
    await db.doc(`Profiles/${uid}`).delete().catch(() => { });
    // 3) Finally, delete Auth user
    await admin.auth().deleteUser(uid).catch(() => { });
    return { ok: true };
});
//# sourceMappingURL=deleteAccount.js.map