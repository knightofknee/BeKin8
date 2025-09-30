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
  Timestamp,
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
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}
const asStringArray = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';

async function fetchProfileNames(uids: string[]) {
  const results: Record<string, string> = {};
  for (const uid of uids) {
    try {
      const snap = await getDoc(doc(db, 'Profiles', uid));
      if (snap.exists()) {
        const data: any = snap.data();
        const uname = (data?.username || data?.displayName || '').toString().trim();
        if (uname) results[uid] = uname;
      }
    } catch { /* ignore */ }
  }
  return results;
}

export default function FriendsBeaconsList({ onSelect }: Props) {
  const meUid = auth.currentUser?.uid || null;

  // local caches/state for list
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const [beacons, setBeacons] = useState<FriendBeacon[]>([]);
  const nameCacheRef = useRef<Record<string, string>>({});
  const beaconUnsubsRef = useRef<(() => void)[]>([]);
  const docStoreRef = useRef<Map<string, any>>(new Map());

  // visibility group cache: groupId -> Set(memberUids)
  const groupMembersCacheRef = useRef<Record<string, Set<string> | null | undefined>>({});
  const groupFetchInFlightRef = useRef<Set<string>>(new Set());

  // window
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => endOfNextSixDays(todayStart), [todayStart]);

  // --- “peek 4th card” measurement & overlay state ---
  const [firstCardH, setFirstCardH] = useState<number | null>(null);
  const [showMoreHint, setShowMoreHint] = useState(false);

  const listMaxHeight = useMemo(() => {
    if (!firstCardH) return undefined;
    // 3 cards + gaps between them (2 gaps at 10px) + a ~35% peek of the 4th card
    const gaps = 2 * 10;
    return Math.round(firstCardH * 3 + gaps + firstCardH * 0.35);
  }, [firstCardH]);

  useEffect(() => {
    setShowMoreHint(beacons.length > 3); // enable hint when there’s more than 3
  }, [beacons.length]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!showMoreHint) return;
    const y = e.nativeEvent.contentOffset.y;
    if (y > 6) setShowMoreHint(false); // hide once the user scrolls a tad
  };

  // subscribe: friend lists (subcollection + FriendEdges)
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      setFriendUids([]); return;
    }

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(collection(db, 'users', me.uid, 'friends'), (snap) => {
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
      })
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me.uid), where('state', '==', 'accepted')),
        (snap) => {
          const uids = new Set<string>();
          snap.forEach((d) => {
            const ed = d.data() as any;
            const arr: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
            const other = arr.find((u) => u !== me.uid);
            if (other) uids.add(other);
          });
          setFriendUids((prev) => Array.from(new Set([...prev, ...Array.from(uids)])));
        }
      )
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // --- compute and set visible beacons from docStore + caches ---
  const computeAndSet = () => {
    const store = docStoreRef.current;
    const startMs = todayStart.getTime();
    const endMs = windowEnd.getTime();

    type Candidate = FriendBeacon & { _createdMs: number };
    const candidates: Candidate[] = [];
    const unknownUids = new Set<string>();
    const groupsToFetch = new Set<string>();

    store.forEach((data: any, id: string) => {
      const stMillis = getMillis(data?.startAt);
      if (!stMillis || stMillis < startMs || stMillis > endMs) return;

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

      if (!nameCacheRef.current[ownerUid]) unknownUids.add(ownerUid);

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

    // resolve unknown names
    if (unknownUids.size) {
      out.forEach((b) => {
        if (b.displayName !== 'Friend') unknownUids.delete(b.ownerUid);
      });
      if (unknownUids.size) {
        fetchProfileNames(Array.from(unknownUids)).then((map) => {
          if (!map || Object.keys(map).length === 0) return;
          Object.assign(nameCacheRef.current, map);
          setBeacons((prev) => (prev ? [...prev] : prev));
        });
      }
    }

    // fetch any unknown groups (lazy, cached)
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
                const members = Array.isArray(data?.memberUids) ? data.memberUids.filter((x: any) => typeof x === 'string') : [];
                groupMembersCacheRef.current[gid] = new Set(members);
              } else {
                // not found / not allowed — mark as empty (no one sees)
                groupMembersCacheRef.current[gid] = new Set<string>();
              }
            } catch {
              // on error, mark as empty so we don't refetch immediately
              groupMembersCacheRef.current[gid] = new Set<string>();
            } finally {
              groupFetchInFlightRef.current.delete(gid);
            }
          })
        ).then(() => {
          // recompute once memberships are known
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
      return;
    }

    // cleanup
    beaconUnsubsRef.current.forEach((fn) => fn());
    beaconUnsubsRef.current = [];
    docStoreRef.current.clear();

    const unsubs: (() => void)[] = [];
    const uids = Array.from(new Set(friendUids)).filter(Boolean);
    const applySnapshot = (snap: any) => {
      const store = docStoreRef.current;
      snap.docChanges().forEach((chg: any) => {
        const id = chg.doc.id;
        if (chg.type === 'removed') store.delete(id);
        else store.set(id, chg.doc.data());
      });
      computeAndSet();
    };

    for (let i = 0; i < uids.length; i += 10) {
      const batch = uids.slice(i, i + 10);
      const qOwners = query(collection(db, 'Beacons'), where('ownerUid', 'in', batch));
      unsubs.push(onSnapshot(qOwners, applySnapshot, (e) => console.warn('owners onSnapshot error:', e)));
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
          <Text style={styles.avatarTxt}>{beacon.displayName?.[0]?.toUpperCase() || 'F'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.beaconOwner} numberOfLines={1}>
            {beacon.displayName}
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

  const listHasOverflow = beacons.length > 3;

  return (
    <View style={styles.friendsSection}>
      {beacons.length > 0 ? (
        <>
          <Text style={styles.friendActiveHeader}>
            {beacons.length} beacon{beacons.length !== 1 ? 's' : ''} from friends
          </Text>

          {/* Wrapper that enforces a max height to “peek” the 4th card */}
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
              {/* bottom padding so the last item isn't flush */}
              <View style={{ height: 8 }} />
            </ScrollView>

            {/* “Scroll for more” overlay */}
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
        <Text style={styles.friendInactive}>No friend beacons today or upcoming</Text>
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

  // wrapper that allows peeking the 4th card
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

  // Bottom overlay to hint overflow
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