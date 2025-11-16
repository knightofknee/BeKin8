// components/FriendsBeaconsList.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { auth, db } from '../firebase.config';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';

export type FriendBeacon = {
  id: string;
  ownerUid: string;
  displayName: string;
  startAt: Date;
  active: boolean;
  scheduled: boolean;
  message: string;
};

type Props = {
  onSelect: (beacon: FriendBeacon) => void;
};

// --- helpers ---
function startOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function endOfDay(d: Date) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}
function endOfNextSixDays(from: Date) {
  const end = endOfDay(new Date(from)); end.setDate(end.getDate() + 6); return end;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayLabel(d: Date) {
  const today = new Date(); if (sameDay(d, today)) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
function shortDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v?.seconds === 'number')
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}
const asStringArray = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';

// Prefer Profiles.displayName → Profiles.username → users.username
async function fetchProfileNames(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!uids || uids.length === 0) return out;

  // read Profiles in small chunks
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

  for (const ids of chunks) {
    const reads = ids.map((uid) => getDoc(doc(db, "Profiles", uid)));
    const snaps = await Promise.all(reads);
    snaps.forEach((snap, idx) => {
      const uid = ids[idx];
      if (!snap.exists()) return;
      const d: any = snap.data() || {};
      const display = typeof d.displayName === "string" ? d.displayName.trim() : "";
      const uname   = typeof d.username === "string" ? d.username.trim() : "";
      out[uid] = display || uname || "";
    });
  }

  // backfill blanks from users/{uid}.username
  const missing = uids.filter((uid) => !out[uid]);
  for (const uid of missing) {
    try {
      const us = await getDoc(doc(db, "users", uid));
      const ud = us.exists() ? (us.data() as any) : {};
      const uname = typeof ud.username === "string" ? ud.username.trim() : "";
      if (uname) out[uid] = uname;
    } catch {}
  }

  return out;
}

export default function FriendsBeaconsList({ onSelect }: Props) {
  const meUid = auth.currentUser?.uid || null;

  // local caches/state for list
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const [beacons, setBeacons] = useState<FriendBeacon[]>([]);
  const nameCacheRef = useRef<Record<string, string>>({});
  const beaconUnsubsRef = useRef<(() => void)[]>([]);
  const docStoreRef = useRef<Map<string, any>>(new Map());
  const profilesFetchedRef = useRef<Set<string>>(new Set());

  // visibility group cache: groupId -> Set(memberUids)
  const groupMembersCacheRef = useRef<Record<string, Set<string> | null | undefined>>({});
  const groupFetchInFlightRef = useRef<Set<string>>(new Set());

  // readiness flags (prevents early "No beacons" flash)
  const [friendsListReady, setFriendsListReady] = useState(false);
  const [edgesReady, setEdgesReady] = useState(false);
  const [beaconsReady, setBeaconsReady] = useState(false);
  // delay empty-state text to avoid flash
  const [emptyReady, setEmptyReady] = useState(false);

  // window (kept for future filter logic if needed)
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => endOfNextSixDays(todayStart), [todayStart]);

  // --- “peek 4th card” measurement & overlay state ---
  const [firstCardH, setFirstCardH] = useState<number | null>(null);
  // dynamic container measurements (to scale list height by device)
  const [containerH, setContainerH] = useState<number | null>(null);
  const [headerH, setHeaderH] = useState<number>(0);
  const [showMoreHint, setShowMoreHint] = useState(false);

  const listMaxHeight = useMemo(() => {
    if (!firstCardH) return undefined;
    const gap = 10;

    if (containerH && containerH > 0) {
      const available = Math.max(containerH - headerH - 12, 0);
      const perRow = firstCardH + gap;
      const rowsThatFit = Math.max(3, Math.min(6, Math.floor((available + gap) / perRow)));
      const visibleRows = Math.min(beacons.length, rowsThatFit);
      const gapsPx = Math.max(visibleRows - 1, 0) * gap;
      const peek = beacons.length > visibleRows ? Math.round(firstCardH * 0.5) : 0;
      return Math.round(firstCardH * visibleRows + gapsPx + peek);
    }

    const visibleRows = Math.min(beacons.length, 4);
    const gapsPx = Math.max(visibleRows - 1, 0) * gap;
    const peek = beacons.length > visibleRows ? Math.round(firstCardH * 0.5) : 0;
    return Math.round(firstCardH * visibleRows + gapsPx + peek);
  }, [firstCardH, beacons.length, containerH, headerH]);

  useEffect(() => {
    if (!firstCardH) { setShowMoreHint(false); return; }
    const gap = 10;
    let visibleRows = 4;
    if (containerH && containerH > 0) {
      const available = Math.max(containerH - headerH - 12, 0);
      const perRow = firstCardH + gap;
      visibleRows = Math.max(3, Math.min(6, Math.floor((available + gap) / perRow)));
    }
    setShowMoreHint(beacons.length > visibleRows);
  }, [beacons.length, firstCardH, containerH, headerH]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!showMoreHint) return;
    const y = e.nativeEvent.contentOffset.y;
    if (y > 6) setShowMoreHint(false);
  };

  // subscribe: friend lists (subcollection + FriendEdges)
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      setFriendUids([]);
      setFriendsListReady(true);
      setEdgesReady(true);
      return;
    }

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        collection(db, 'users', me.uid, 'friends'),
        (snap) => {
          const uids = new Set<string>();
          snap.forEach((d) => {
            const f: any = d.data();
            if (typeof f?.uid === 'string') {
              uids.add(f.uid);
              if (typeof f?.username === 'string' && f.username.trim()) {
                nameCacheRef.current[f.uid] = f.username.trim();
              }
            }
          });
          setFriendUids((prev) => Array.from(new Set([...prev, ...Array.from(uids)])));
          setFriendsListReady(true);
        },
        () => setFriendsListReady(true) // on error, mark ready to avoid perpetual loading
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me.uid)),
        (snap) => {
          const uids = new Set<string>();
          snap.forEach((d) => {
            const ed = d.data() as any;
            const arr: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
            const other = arr.find((u) => u !== me.uid);
            if (other) uids.add(other);
          });
          setFriendUids((prev) => Array.from(new Set([...prev, ...Array.from(uids)])));
          setEdgesReady(true);
        },
        () => setEdgesReady(true)
      )
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // --- compute and set visible beacons from docStore + caches ---
  const computeAndSet = () => {
    const store = docStoreRef.current;

    type Candidate = FriendBeacon & { _createdMs: number };
    const candidates: Candidate[] = [];
    const toFetchProfiles = new Set<string>();
    const groupsToFetch = new Set<string>();

    store.forEach((data: any, id: string) => {
      const stMillis = getMillis(data?.startAt);
      // Hide past beacons and clamp to our 7‑day window
      if (stMillis < todayStart.getTime()) return;
      // if (stMillis > windowEnd.getTime()) return;
      if (!stMillis) return;

      const ownerUid = String(data.ownerUid ?? '');
      if (!ownerUid || (meUid && ownerUid === meUid)) return; // never show my own

      const active = !!data?.active;
      const scheduled = data?.scheduled === true || data?.scheduled === 'true';
      if (!active && !scheduled) return; // extinguished

      // --- visibility (default: visible to all friends if no groups set) ---
      const groupIds = asStringArray(data?.visibilityGroups);
      let canSee = true; // default allow when not set/empty
      if (groupIds.length > 0) {
        canSee = false; // tighten: must be in at least one group
        for (const gid of groupIds) {
          const cache = groupMembersCacheRef.current[gid];
          if (cache instanceof Set) {
            if (meUid && cache.has(meUid)) {
              canSee = true;
              break;
            }
          } else if (cache === undefined) {
            // unknown membership, request fetch; we'll recompute after fetch
            groupsToFetch.add(gid);
          }
        }
      }
      if (!canSee) return;

      if (!profilesFetchedRef.current.has(ownerUid)) toFetchProfiles.add(ownerUid);

      const ownerName: string =
        (typeof data.ownerName === 'string' && data.ownerName.trim()) ||
        nameCacheRef.current[ownerUid] ||
        'Friend';

      const msg: string =
        (typeof data.message === 'string' && data.message.trim()) ||
        (typeof data.details === 'string' && data.details.trim()) ||
        DEFAULT_BEACON_MESSAGE;

      const createdMs = getMillis(data?.createdAt) || getMillis(data?.updatedAt) || 0;

      candidates.push({
        id,
        ownerUid,
        displayName: ownerName,
        startAt: new Date(stMillis),
        active,
        scheduled,
        message: msg,
        _createdMs: createdMs,
      });
    });

    // newest per owner
    const byOwner = new Map<string, Candidate>();
    candidates.forEach((b) => {
      const prev = byOwner.get(b.ownerUid);
      if (prev == null || (b._createdMs || 0) > (prev._createdMs || 0)) byOwner.set(b.ownerUid, b);
    });

    const out = Array.from(byOwner.values());
    out.sort((a, b) => {
      const diff = a.startAt.getTime() - b.startAt.getTime();
      if (diff !== 0) return diff;
      return a.displayName.localeCompare(b.displayName);
    });

    setBeacons(out);

    // Resolve names from Profiles for any owners we haven't fetched yet (override username cache)
    if (toFetchProfiles.size) {
      const list = Array.from(toFetchProfiles);
      fetchProfileNames(list).then((map) => {
        if (!map || Object.keys(map).length === 0) return;
        // Overwrite cache entries with authoritative Profiles values
        Object.assign(nameCacheRef.current, map);
        list.forEach((uid) => profilesFetchedRef.current.add(uid));
        // trigger re-render so FriendBeaconItem reads latest names from cache
        setBeacons((prev) => (prev ? [...prev] : prev));
      });
    }

    // fetch any unknown groups (lazy, cached), then recompute
    if (groupsToFetch.size) {
      const toFetch = Array.from(groupsToFetch).filter((gid) => !groupFetchInFlightRef.current.has(gid));
      if (toFetch.length) {
        toFetch.forEach((gid) => groupFetchInFlightRef.current.add(gid));
        Promise.all(
          toFetch.map(async (gid) => {
            try {
              const snap = await getDoc(doc(db, 'FriendGroups', gid));
              if (snap.exists()) {
                const data: any = snap.data();
                const members = Array.isArray(data?.memberUids)
                  ? data.memberUids.filter((x: any) => typeof x === 'string')
                  : [];
                groupMembersCacheRef.current[gid] = new Set(members);
              } else {
                groupMembersCacheRef.current[gid] = new Set<string>();
              }
            } catch {
              groupMembersCacheRef.current[gid] = new Set<string>();
            } finally {
              groupFetchInFlightRef.current.delete(gid);
            }
          })
        ).then(() => {
          computeAndSet();
        });
      }
    }
  };

  // subscribe: friends' beacons (ownerUid IN chunks)
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      beaconUnsubsRef.current.forEach((fn) => fn());
      beaconUnsubsRef.current = [];
      docStoreRef.current.clear();
      setBeacons([]);
      setBeaconsReady(true);
      return;
    }

    // cleanup
    beaconUnsubsRef.current.forEach((fn) => fn());
    beaconUnsubsRef.current = [];
    docStoreRef.current.clear();

    const unsubs: (() => void)[] = [];
    const uids = Array.from(new Set(friendUids)).filter(Boolean);

    // If there are no friends yet, we’re "ready" with an empty list.
    if (uids.length === 0) {
      setBeacons([]);
      setBeaconsReady(true);
      return () => {};
    }

    // we expect at least one snapshot; hold off on empty-state copy until one arrives
    setBeaconsReady(false);

    let firstApplied = false;
    const applySnapshot = (snap: any) => {
      const store = docStoreRef.current;
      snap.docChanges().forEach((chg: any) => {
        const id = chg.doc.id;
        if (chg.type === 'removed') store.delete(id);
        else store.set(id, chg.doc.data());
      });
      computeAndSet();
      if (!firstApplied) {
        firstApplied = true;
        setBeaconsReady(true);
      }
    };

    for (let i = 0; i < uids.length; i += 10) {
      const batch = uids.slice(i, i + 10);
      const qOwners = query(collection(db, 'Beacons'), where('ownerUid', 'in', batch));
      unsubs.push(
        onSnapshot(
          qOwners,
          applySnapshot,
          () => { /* even on error, avoid deadlock */ setBeaconsReady(true); }
        )
      );
    }
    beaconUnsubsRef.current = unsubs;

    return () => {
      unsubs.forEach((fn) => fn());
      beaconUnsubsRef.current = [];
    };
  }, [friendUids, todayStart, windowEnd]);

  // UI bits
  const FriendBeaconItem = ({ beacon, index }: { beacon: FriendBeacon; index: number }) => {
    const isToday = sameDay(beacon.startAt, new Date());
    // Prefer live cache (Profiles.displayName) over stamped/beacon ownerName
    const ownerLabel = (nameCacheRef.current[beacon.ownerUid] || beacon.displayName || 'Friend').toString();

    return (
      <Pressable
        onLayout={(e) => {
          if (index === 0 && !firstCardH) {
            setFirstCardH(Math.max(1, e.nativeEvent.layout.height));
          }
        }}
        onPress={() => onSelect(beacon)}
        style={({ pressed }) => [
          styles.beaconItem,
          isToday && beacon.active
            ? styles.cardActiveToday
            : !isToday
            ? styles.cardFuture
            : styles.cardTodayScheduled,
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarTxt}>{ownerLabel?.[0]?.toUpperCase() || 'F'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.beaconOwner} numberOfLines={1}>
            {ownerLabel}
          </Text>
          <Text style={styles.beaconWhen} numberOfLines={1}>
            {dayLabel(beacon.startAt)} - {shortDate(beacon.startAt)}
          </Text>
          <Text style={styles.beaconMsg} numberOfLines={2}>
            {beacon.message}
          </Text>
        </View>
      </Pressable>
    );
  };

  const listHasOverflow = useMemo(() => {
    if (!firstCardH) return false;
    const gap = 10;
    let visibleRows = 4;
    if (containerH && containerH > 0) {
      const available = Math.max(containerH - headerH - 12, 0);
      const perRow = firstCardH + gap;
      visibleRows = Math.max(3, Math.min(6, Math.floor((available + gap) / perRow)));
    }
    return beacons.length > visibleRows;
  }, [beacons.length, firstCardH, containerH, headerH]);
  const uiReady = friendsListReady && edgesReady && beaconsReady;

  // Debounce the empty-state so "No friend beacons..." doesn't flash
  useEffect(() => {
    if (!uiReady) {
      setEmptyReady(false);
      return;
    }
    if (beacons.length > 0) {
      setEmptyReady(false);
      return;
    }
    const t = setTimeout(() => setEmptyReady(true), 250);
    return () => clearTimeout(t);
  }, [uiReady, beacons.length]);

  return (
    <View style={styles.friendsSection} onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}>
      {/* Hide ALL copy until ready */}
      {!uiReady ? null : beacons.length > 0 ? (
        <>
          <Text style={styles.friendActiveHeader} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
            {beacons.length} beacon{beacons.length !== 1 ? 's' : ''} from friends
          </Text>

          <View
            style={[
              styles.peekWrapper,
              listMaxHeight ? { maxHeight: listMaxHeight } : undefined,
              listHasOverflow ? { overflow: 'hidden' } : null,
            ]}
          >
            <ScrollView
              onScroll={handleScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator
              contentContainerStyle={styles.cardsWrap}
            >
              {beacons.map((b, i) => (
                <FriendBeaconItem key={b.id} beacon={b} index={i} />
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>

            {listHasOverflow && showMoreHint && (
              <Pressable style={styles.moreOverlay}>
                <View style={styles.morePill}>
                  <Text style={styles.morePillTxt}>▼  Scroll for more</Text>
                </View>
              </Pressable>
            )}
          </View>
        </>
      ) : (
        emptyReady ? (
          <Text style={styles.friendInactive}>No friend beacons today or upcoming</Text>
        ) : null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  friendsSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  friendActiveHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B1426',
    marginBottom: 10,
    textAlign: 'center'
  },

  peekWrapper: {
    position: 'relative',
    borderRadius: 12,
  },

  cardsWrap: {
    gap: 10,
    paddingBottom: 6,
  },
  beaconItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  cardActiveToday: { backgroundColor: '#FFF4E5', borderColor: '#FFE0B2' },
  cardTodayScheduled: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  cardFuture: { backgroundColor: '#E7F0FF', borderColor: '#C7DAFF' },
  beaconOwner: { fontSize: 15, fontWeight: '800', color: '#0B1426' },
  beaconWhen: { fontSize: 13, color: '#334155', marginTop: 2 },
  beaconMsg: { fontSize: 14, color: '#111827', marginTop: 4 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2F6FED',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarTxt: { color: '#fff', fontWeight: '900' },

  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f00',
    marginTop: 16,
  },

  moreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingBottom: 6,
  },
  morePill: {
    backgroundColor: '#0B1426',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  morePillTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
});