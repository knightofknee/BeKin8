// tools/migratePushTokens.ts
// import { initializeApp, cert } from 'firebase-admin/app';
// import { getFirestore } from 'firebase-admin/firestore';

// initializeApp({ /* creds via env/service account */ });
// const db = getFirestore();

// async function run() {
//   const snap = await db.collection('users').get();
//   for (const docSnap of snap.docs) {
//     const u = docSnap.data() || {};
//     const uid = docSnap.id;

//     const candidates: string[] = [];
//     if (typeof u.expoPushToken === 'string' && u.expoPushToken.startsWith('ExponentPushToken')) {
//       candidates.push(u.expoPushToken);
//     }
//     if (typeof u.pushToken === 'string' && u.pushToken.startsWith('ExponentPushToken')) {
//       candidates.push(u.pushToken);
//     }

//     // optional: Profiles mirror
//     const prof = await db.collection('Profiles').doc(uid).get();
//     const p = prof.exists ? prof.data()! : {};
//     if (typeof p.expoPushToken === 'string' && p.expoPushToken.startsWith('ExponentPushToken')) {
//       candidates.push(p.expoPushToken);
//     }

//     const unique = Array.from(new Set(candidates));
//     for (const token of unique) {
//       const id = Buffer.from(token).toString('base64').replace(/=+$/,'').slice(0, 40);
//       await db.doc(`users/${uid}/pushTokens/${id}`).set({
//         token,
//         platform: 'unknown',
//         updatedAt: Date.now(),
//         migrated: true,
//       }, { merge: true });
//     }
//   }
//   console.log('Migration complete');
// }
export default {};
// run().catch(e => { console.error(e); process.exit(1); });