// helpers/ReconcileFriendEdges.ts
import { auth, db } from '@/firebase.config';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  setDoc,
} from 'firebase/firestore';

const chunk = <T,>(arr: T[], n = 10) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function reconcileFriendEdges() {
  const me = auth.currentUser;
  if (!me) return;

  const batch = writeBatch(db);

  // 1) Read subcollection + legacy doc
  const subSnap = await getDocs(collection(db, 'users', me.uid, 'friends'));
  const topSnap = await getDoc(doc(db, 'Friends', me.uid));

  // Collect missing-uid entries from subcollection
  const missingFromSub: { key: string; username: string }[] = [];
  subSnap.forEach((d) => {
    const data = d.data() as any;
    const uid = typeof data?.uid === 'string' ? data.uid : '';
    const username = (data?.username || '').toString().trim();
    if (!uid && username) missingFromSub.push({ key: d.id, username });
  });

  // 2) Copy legacy Friends → subcollection (keep username if uid missing)
  const legacyFriends = (topSnap.exists() ? ((topSnap.data() as any)?.friends || []) : []) as Array<any>;
  for (const f of legacyFriends) {
    const uid = typeof f?.uid === 'string' ? f.uid : '';
    const username = (f?.username || '').toString().trim();
    if (!username) continue;
    const key = uid || username.toLowerCase();
    batch.set(
      doc(db, 'users', me.uid, 'friends', key),
      { uid: uid || null, username },
      { merge: true }
    );
    if (!uid) missingFromSub.push({ key, username });
  }

  // 3) Resolve usernames → uids via Profiles.usernameLower
  const toResolve = [...new Set(missingFromSub.map((m) => m.username.toLowerCase()))];
  for (const names of chunk(toResolve, 10)) {
    const snap = await getDocs(
      query(collection(db, 'Profiles'), where('usernameLower', 'in', names))
    );
    const map = new Map<string, string>(); // lower -> uid
    snap.forEach((p) => {
      const pd = p.data() as any;
      if (pd?.usernameLower) map.set(String(pd.usernameLower), p.id);
    });

    for (const lower of names) {
      const uid = map.get(lower);
      if (!uid) continue;
      // Write fixed row keyed by uid; keep readable username too
      const profile = await getDoc(doc(db, 'Profiles', uid));
      const username = ((profile.data() as any)?.username || lower).toString();
      batch.set(
        doc(db, 'users', me.uid, 'friends', uid),
        { uid, username },
        { merge: true }
      );
    }
  }

  await batch.commit();
}
