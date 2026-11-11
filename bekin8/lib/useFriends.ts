// lib/useFriends.ts
//
// Live list of MY accepted friends with canonical names, for pickers (the "+" friends chip in Beacon
// options). Mirrors the three friendship sources the Friends screen and FriendGroupEditor merge:
// users/{me}/friends (stamped denorm), legacy Friends/{me}.friends, and accepted FriendEdges. Names
// come from Profiles (the denorm can be stale or wrong-cased); the stamped username is only the
// fallback for the moment before that fetch lands.
import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.config';

export type FriendLite = {
  uid: string;
  username: string;
  displayName?: string;
  profileColor?: string;
};

export function friendLabel(f: { username: string; displayName?: string }): string {
  return (f.displayName || '').trim() || f.username;
}

type Info = { username: string; displayName?: string; profileColor?: string; canonical?: boolean };

async function fetchProfiles(uids: string[]): Promise<Record<string, Info>> {
  const out: Record<string, Info> = {};
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const p = await getDoc(doc(db, 'Profiles', uid));
        if (!p.exists()) return;
        const data: any = p.data();
        const username = (data?.username || '').toString().trim();
        const displayName = (data?.displayName || '').toString().trim() || undefined;
        const profileColor = (data?.profileColor || data?.avatarColor || '').toString().trim() || undefined;
        if (username) out[uid] = { username, displayName, profileColor, canonical: true };
      } catch {
        // audience-scoped read can fail for a stale edge; keep the stamped fallback
      }
    })
  );
  return out;
}

export function useFriends(meUid: string | null | undefined, enabled: boolean = true) {
  const [friends, setFriends] = useState<FriendLite[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<Record<string, Info>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    cacheRef.current = {};
    fetchingRef.current = new Set();
    setFriends([]);
    if (!enabled || !meUid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;

    const publish = () => {
      if (!alive) return;
      const all = Object.entries(cacheRef.current).map(([uid, i]) => ({
        uid,
        username: i.username,
        displayName: i.displayName,
        profileColor: i.profileColor,
      }));
      all.sort((a, b) => friendLabel(a).localeCompare(friendLabel(b)));
      setFriends(all);
      setLoading(false);
    };

    // Any uid we only know from a stamped copy (or not at all) gets its canonical Profile once.
    const resolve = (uids: string[]) => {
      const need = uids.filter((u) => !cacheRef.current[u]?.canonical && !fetchingRef.current.has(u));
      if (!need.length) return;
      need.forEach((u) => fetchingRef.current.add(u));
      fetchProfiles(need).then((map) => {
        for (const [uid, info] of Object.entries(map)) cacheRef.current[uid] = info;
        publish();
      });
    };

    const takeStamped = (arr: any[]) => {
      const uids: string[] = [];
      for (const f of arr || []) {
        const uid = typeof f?.uid === 'string' ? f.uid : '';
        const username = (f?.username ?? '').toString().trim();
        if (!uid || uid === meUid) continue;
        if (!cacheRef.current[uid] && username) {
          cacheRef.current[uid] = {
            username,
            displayName: (f?.displayName ?? '').toString().trim() || undefined,
          };
        }
        uids.push(uid);
      }
      return uids;
    };

    const unsubs = [
      onSnapshot(collection(db, 'users', meUid, 'friends'), (snap) => {
        const uids = takeStamped(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) })));
        publish();
        resolve(uids);
      }, () => {}),
      onSnapshot(doc(db, 'Friends', meUid), (snap) => {
        const arr: any[] = (snap.exists() && (snap.data() as any)?.friends) || [];
        const uids = takeStamped(arr);
        publish();
        resolve(uids);
      }, () => {}),
      onSnapshot(
        query(collection(db, 'FriendEdges'), where('uids', 'array-contains', meUid), where('state', '==', 'accepted')),
        (snap) => {
          const uids: string[] = [];
          snap.forEach((d) => {
            const arr: string[] = Array.isArray((d.data() as any)?.uids) ? (d.data() as any).uids : [];
            const other = arr.find((u) => u !== meUid);
            if (other) uids.push(other);
          });
          resolve(uids);
          // Edge-only friends have no stamped name yet: they appear once their Profile resolves.
          if (!uids.length) publish();
        },
        () => publish()
      ),
    ];

    return () => {
      alive = false;
      unsubs.forEach((fn) => fn());
    };
  }, [meUid, enabled]);

  return { friends, loading };
}
