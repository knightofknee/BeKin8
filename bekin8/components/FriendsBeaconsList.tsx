// components/FriendsBeaconsList.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMillis } from '../lib/millis';
import { View, Text, Pressable, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import { auth, db } from '../firebase.config';
import { SCREEN_PAD } from './ui/layout';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { usePrefetchBeaconMessages } from '../lib/prefetchBeaconMessages';
import RsvpRallyActions from './RsvpRallyActions';
import { useUnreadCount } from '../lib/chatRead';
import { tap } from '../utils/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { beaconStillLive, formatTimeHHmmDisplay } from '../lib/beaconTime';
import ExampleBeaconCard from './tutorial/ExampleBeaconCard';
import type { ThemeColors } from './ui/colors';

export type FriendBeacon = {
  id: string;
  ownerUid: string;
  displayName: string;
  startAt: Date;
  active: boolean;
  scheduled: boolean;
  message: string;
  // Optional clock time in 24-hour "HH:MM" form (e.g. "18:30"). Null/undefined
  // when the owner didn't specify a time.
  timeHHmm?: string | null;
  // RALLY: this is the owner rallying for another beacon (its id/owner). The tile opens that
  // beacon's chat and its RSVP/Rally actions act on it (see lib/rsvp).
  rallyOf?: string | null;
  rallyOwnerUid?: string | null;
  rallyOwnerName?: string | null;
};

type Props = {
  onSelect: (beacon: FriendBeacon) => void;
  // Show an illustrative "Example" beacon card when the user has no friends yet, so a brand-new
  // user sees what a populated list will look like. Local-only; never written to Firestore.
  showExampleWhenEmpty?: boolean;
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
  // Last night's beacon, still live in its after-midnight grace hours.
  if (d.getTime() < startOfDay(today).getTime()) return 'Tonight';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
function shortDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const asStringArray = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';
const COLLAPSED_KEY = '@bekin_beacon_list_collapsed';

// Prefer Profiles.displayName → Profiles.username
async function fetchProfileNames(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!uids || uids.length === 0) return out;

  // read Profiles in parallel chunks of 10
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

  await Promise.all(
    chunks.map(async (ids) => {
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
    })
  );

  return out;
}

// Hoisted to module scope (was previously defined inside the component body, which
// created a brand-new component TYPE on every parent render and force-remounted every
// card). React.memo skips re-rendering when its props are shallow-equal.
type FriendBeaconItemProps = {
  beacon: FriendBeacon;
  ownerLabel: string;
  /** Resolved name of the friend whose beacon this one rallies for (rally tiles only). */
  rallyOwnerLabel?: string;
  isFirst: boolean;
  onFirstLayout: (height: number) => void;
  onSelect: (beacon: FriendBeacon) => void;
  tc: ThemeColors;
};

const FriendBeaconItem = React.memo(function FriendBeaconItem({
  beacon,
  ownerLabel,
  rallyOwnerLabel,
  isFirst,
  onFirstLayout,
  onSelect,
  tc,
}: FriendBeaconItemProps) {
  // "Today" styling also covers last night's beacon during its after-midnight grace hours.
  const isToday = sameDay(beacon.startAt, new Date()) || beacon.startAt.getTime() < startOfDay(new Date()).getTime();
  const timeLabel = formatTimeHHmmDisplay(beacon.timeHHmm);
  // RSVP / Rally right from the tile, always aimed at the ORIGINAL beacon (a rally tile's rallyOf).
  const ogId = beacon.rallyOf || beacon.id;
  const ogOwnerUid = beacon.rallyOf ? beacon.rallyOwnerUid || '' : beacon.ownerUid;
  const ogOwnerName = beacon.rallyOf ? rallyOwnerLabel || beacon.rallyOwnerName || '' : ownerLabel;
  // Unread messages in the chat this tile opens (a rally tile opens the original's), so you can see
  // where the conversation is without tapping around.
  const unread = useUnreadCount(ogId);

  return (
    <Pressable
      onLayout={(e) => {
        if (isFirst) onFirstLayout(Math.max(1, e.nativeEvent.layout.height));
      }}
      onPress={() => onSelect(beacon.rallyOf ? { ...beacon, id: beacon.rallyOf } : beacon)}
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
      <View style={[styles.avatar, { backgroundColor: tc.primary }]}>
        <Text style={styles.avatarTxt}>{ownerLabel?.[0]?.toUpperCase() || 'F'}</Text>
        {unread > 0 && (
          <View style={styles.unreadBadge} accessibilityLabel={`${unread} unread messages`}>
            <Text style={styles.unreadBadgeTxt}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.beaconOwner} numberOfLines={beacon.rallyOf ? 2 : 1}>
          {ownerLabel}
          {beacon.rallyOf ? (
            <>
              <Text style={styles.rallyJoin}> rallying to </Text>
              {ogOwnerName || 'a friend'}
              <Text style={styles.rallyJoin}>&apos;s cause</Text>
            </>
          ) : null}
        </Text>
        <Text style={styles.beaconWhen} numberOfLines={1}>
          {dayLabel(beacon.startAt)} - {shortDate(beacon.startAt)}
          {timeLabel ? ` - ${timeLabel}` : ''}
        </Text>
        <Text style={styles.beaconMsg} numberOfLines={2}>
          {beacon.message}
        </Text>
      </View>
      <View style={styles.rsvpCol}>
        <RsvpRallyActions ogId={ogId} ogOwnerUid={ogOwnerUid} ogOwnerName={ogOwnerName} />
      </View>
    </Pressable>
  );
});

export default function FriendsBeaconsList({ onSelect, showExampleWhenEmpty = false }: Props) {
  const { colors: tc } = useTheme();
  const online = useOnline();
  const meUid = auth.currentUser?.uid || null;

  // local caches/state for list
  // Two independent friend sources kept separate so a shrinking snapshot actually
  // removes uids: friendUids is DERIVED as the union of the CURRENT friends
  // subcollection snapshot and the CURRENT FriendEdges snapshot. The old approach
  // unioned each snapshot with previous state, so unfriending/blocking someone
  // mid-session never dropped them (their lit beacons lingered until app restart).
  const [subFriendUids, setSubFriendUids] = useState<string[]>([]);
  const [edgeFriendUids, setEdgeFriendUids] = useState<string[]>([]);
  const friendUids = useMemo(
    () => Array.from(new Set([...subFriendUids, ...edgeFriendUids])),
    [subFriendUids, edgeFriendUids]
  );
  // Read by computeAndSet, whose snapshot closure is created once per user (see the subscription
  // effect), so it needs the CURRENT friend set via a ref rather than the render-time array.
  const friendSetRef = useRef<Set<string>>(new Set());
  friendSetRef.current = useMemo(() => new Set(friendUids), [friendUids]);
  const [beacons, setBeacons] = useState<FriendBeacon[]>([]);
  const nameCacheRef = useRef<Record<string, string>>({});
  const beaconUnsubsRef = useRef<(() => void)[]>([]);
  const docStoreRef = useRef<Map<string, any>>(new Map());
  const profilesFetchedRef = useRef<Set<string>>(new Set());
  // Tracks whether the component is still mounted, so async .then() callbacks
  // can short-circuit instead of writing to refs / calling setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Tracks the friendUids signature (sorted, deduped, joined) of the currently-active
  // beacon subscriptions. When the parent re-renders and friendUids' array reference
  // changes but its CONTENTS are identical, we skip tearing down and re-creating all
  // the per-batch onSnapshot listeners, they're still valid.
  const subscriptionsKeyRef = useRef<string>('');

  // Final unmount cleanup for beacon listeners. The main subscription effect manages
  // them imperatively (so a content-equal bailout doesn't lose them); this guarantees
  // they're released when the component goes away.
  useEffect(() => {
    return () => {
      beaconUnsubsRef.current.forEach((fn) => fn());
      beaconUnsubsRef.current = [];
    };
  }, []);

  // visibility group cache: groupId -> Set(memberUids)
  const groupMembersCacheRef = useRef<Record<string, Set<string> | null | undefined>>({});
  const groupFetchInFlightRef = useRef<Set<string>>(new Set());

  // readiness flags (prevents early "No beacons" flash)
  const [friendsListReady, setFriendsListReady] = useState(false);
  const [edgesReady, setEdgesReady] = useState(false);
  const [beaconsReady, setBeaconsReady] = useState(false);

  // Warm the Firestore cache for every visible beacon's ChatMessages so that
  // opening details renders instantly from cache. Dedupes internally.
  usePrefetchBeaconMessages(beacons.map((b) => b.id));
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
  // Hidden list (header chevron -> a small tab at the top). Device-local convenience pref.
  const [listCollapsed, setListCollapsedState] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(COLLAPSED_KEY)
      .then((v) => { if (mountedRef.current && v === '1') setListCollapsedState(true); })
      .catch(() => {});
  }, []);
  const setListCollapsed = useCallback((v: boolean) => {
    tap();
    setListCollapsedState(v);
    AsyncStorage.setItem(COLLAPSED_KEY, v ? '1' : '0').catch(() => {});
  }, []);
  const listRef = useRef<ScrollView>(null);

  const listMaxHeight = useMemo(() => {
    if (!firstCardH) return undefined;
    const gap = 10;

    if (containerH && containerH > 0) {
      const available = Math.max(containerH - headerH - 12, 0);
      const perRow = firstCardH + gap;
      const rowsThatFit = Math.max(3, Math.min(6, Math.floor((available + gap) / perRow)));
      // Everything fits: no cap. The cap is estimated from the FIRST card's height, so capping a
      // list that doesn't overflow cut the last card off whenever later cards were taller (a
      // two-line message), with no "Scroll for more" to explain it.
      if (beacons.length <= rowsThatFit) return undefined;
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
      setSubFriendUids([]);
      setEdgeFriendUids([]);
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
          setSubFriendUids(Array.from(uids));
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
          setEdgeFriendUids(Array.from(uids));
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

    // Prune past/expired entries from the store so it can't grow unboundedly across
    // long-running sessions. The query has no time filter, so old beacons accumulate
    // unless we explicitly drop them, Firestore only reports them as 'removed'
    // when the document itself is deleted.
    const cutoff = startOfDay(new Date()).getTime();
    const nowMs = Date.now();
    const stale: string[] = [];
    store.forEach((data: any, id: string) => {
      const stMillis = getMillis(data?.startAt);
      const expMillis = getMillis(data?.expiresAt);
      if (!stMillis) return;
      if (!beaconStillLive(stMillis, expMillis, nowMs)) stale.push(id);
      // Scheduled-but-unlit docs from earlier days are dead too (only lit ones get the grace).
      else if (stMillis < cutoff && !data?.active) stale.push(id);
    });
    stale.forEach((id) => store.delete(id));

    type Candidate = FriendBeacon & { _createdMs: number };
    const candidates: Candidate[] = [];
    const toFetchProfiles = new Set<string>();
    const groupsToFetch = new Set<string>();

    store.forEach((data: any, id: string) => {
      const stMillis = getMillis(data?.startAt);
      if (!stMillis) return;
      // Hide expired beacons. A beacon lit last night stays until its expiry (4am the next
      // morning), so a past start day alone no longer hides it.
      if (!beaconStillLive(stMillis, getMillis(data?.expiresAt))) return;
      if (stMillis < todayStart.getTime() && !data?.active) return;

      const ownerUid = String(data.ownerUid ?? '');
      if (!ownerUid || (meUid && ownerUid === meUid)) return; // never show my own
      // Direct friends only. A beacon's audienceUids also includes friends-of-friends when both
      // sides opted into FoF POSTS, so the audience query alone would surface strangers' beacons.
      if (!friendSetRef.current.has(ownerUid)) return;
      // A friend rallying for MY beacon: I already have my own beacon; their rally is for their friends.
      if (meUid && data?.rallyOwnerUid === meUid) return;

      const active = !!data?.active;
      const scheduled = data?.scheduled === true || data?.scheduled === 'true';
      if (!active) return; // only show lit beacons to friends

      // --- visibility (default: visible to all friends if no groups set) ---
      const groupIds = asStringArray(data?.groupIds);
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
      // A rally tile names the original's owner too, who may not be my friend: resolve them as well.
      const rallyOwner = typeof data?.rallyOwnerUid === 'string' ? data.rallyOwnerUid : '';
      if (rallyOwner && !profilesFetchedRef.current.has(rallyOwner)) toFetchProfiles.add(rallyOwner);

      const ownerName: string =
        (typeof data.ownerName === 'string' && data.ownerName.trim()) ||
        nameCacheRef.current[ownerUid] ||
        'Friend';

      const msg: string =
        (typeof data.message === 'string' && data.message.trim()) ||
        (typeof data.details === 'string' && data.details.trim()) ||
        DEFAULT_BEACON_MESSAGE;

      const createdMs = getMillis(data?.createdAt) || getMillis(data?.updatedAt) || 0;

      const timeHHmm =
        typeof data?.timeHHmm === 'string' && data.timeHHmm.trim() ? data.timeHHmm : null;

      candidates.push({
        id,
        ownerUid,
        displayName: ownerName,
        startAt: new Date(stMillis),
        active,
        scheduled,
        message: msg,
        timeHHmm,
        rallyOf: typeof data?.rallyOf === 'string' && data.rallyOf ? data.rallyOf : null,
        rallyOwnerUid: typeof data?.rallyOwnerUid === 'string' ? data.rallyOwnerUid : null,
        rallyOwnerName: typeof data?.rallyOwnerName === 'string' ? data.rallyOwnerName : null,
        _createdMs: createdMs,
      });
    });

    // One OWN plan per friend (their newest), plus EVERY rally of theirs as its own beacon: people
    // join each other's plans, so a friend can have their own beacon and rally several others.
    const byKey = new Map<string, Candidate>();
    candidates.forEach((b) => {
      const key = b.rallyOf ? `rally:${b.id}` : b.ownerUid;
      const prev = byKey.get(key);
      if (prev == null || (b._createdMs || 0) > (prev._createdMs || 0)) byKey.set(key, b);
    });
    const out = Array.from(byKey.values());
    out.sort((a, b) => {
      const diff = a.startAt.getTime() - b.startAt.getTime();
      if (diff !== 0) return diff;
      return a.displayName.localeCompare(b.displayName);
    });

    setBeacons(out);

    // Resolve names from Profiles for any owners we haven't fetched yet (override username cache)
    if (toFetchProfiles.size) {
      const list = Array.from(toFetchProfiles);
      // Pre-mark these uids as fetched BEFORE starting the request. Without this,
      // concurrent computeAndSet calls (e.g. from rapid snapshot updates) would
      // see them as unfetched and kick off duplicate in-flight reads for the
      // same profiles. This also covers the empty-result case, if a Profile
      // genuinely doesn't exist we won't repeatedly retry it.
      list.forEach((uid) => profilesFetchedRef.current.add(uid));
      fetchProfileNames(list).then((map) => {
        if (!mountedRef.current) return; // component unmounted before fetch resolved
        if (!map || Object.keys(map).length === 0) return;
        // Overwrite cache entries with authoritative Profiles values
        Object.assign(nameCacheRef.current, map);
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
        )
          .then(() => {
            if (mountedRef.current) computeAndSet();
          })
          .catch((err) => {
            // Defensive: each inner map already try/catches, so this should be unreachable.
            // If something does throw (e.g. computeAndSet itself), don't leave the inflight
            // refs / list in a broken state, clear them and try a recompute.
            if (__DEV__) console.warn('Groups fetch chain failed', err);
            toFetch.forEach((gid) => groupFetchInFlightRef.current.delete(gid));
            if (mountedRef.current) computeAndSet();
          });
      }
    }
  };

  // subscribe: friends' beacons (ownerUid IN chunks)
  // Note: this effect manages listeners imperatively via beaconUnsubsRef rather
  // than returning a cleanup function. That lets us bail out when friendUids
  // content is unchanged (avoiding a needless tear-down/re-create cycle that
  // would happen if we relied on useEffect's auto-cleanup). The unmount-only
  // cleanup is in a separate useEffect above.
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      if (beaconUnsubsRef.current.length > 0) {
        beaconUnsubsRef.current.forEach((fn) => fn());
        beaconUnsubsRef.current = [];
        docStoreRef.current.clear();
      }
      setBeacons([]);
      setBeaconsReady(true);
      subscriptionsKeyRef.current = '__no_user__';
      return;
    }

    // Subscription no longer depends on the friend uid list: the audience lives on the Beacon docs
    // themselves (functions/src/audience.ts), so one listener covers everyone allowed to see me.
    // Keying on the uid alone also means a friendship change no longer tears down and rebuilds
    // listeners; the server restamps audienceUids and this listener just sees docs enter or leave.
    const key = `aud:${me.uid}`;
    if (subscriptionsKeyRef.current === key) return;
    subscriptionsKeyRef.current = key;

    // Tear down old listeners (we own the lifetime now, not useEffect cleanup).
    beaconUnsubsRef.current.forEach((fn) => fn());
    beaconUnsubsRef.current = [];
    docStoreRef.current.clear();

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

    // One listener instead of ceil(friends/30). My own beacons come back too (I am in my own
    // audience), but applySnapshot already drops them ("never show my own"), so the visible result
    // is unchanged.
    const qAudience = query(
      collection(db, 'Beacons'),
      where('audienceUids', 'array-contains', me.uid)
    );
    beaconUnsubsRef.current = [
      onSnapshot(
        qAudience,
        applySnapshot,
        () => { /* even on error, avoid deadlock */ setBeaconsReady(true); }
      ),
    ];
  }, [friendUids, todayStart, windowEnd]);

  // Stable first-card measurement callback. Only records the first non-zero
  // height (matches the prior `!firstCardH` guard): once set, the functional
  // update returns the same value so React bails out of re-rendering.
  const handleFirstLayout = useCallback((h: number) => {
    setFirstCardH((prev) => prev || h);
  }, []);

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
  // Friend set changed (first load, new friend, unfriend): re-filter the beacons already in the store.
  useEffect(() => {
    if (mountedRef.current) computeAndSet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendUids]);

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
      {!uiReady ? null : beacons.length > 0 && listCollapsed ? (
        <Pressable
          onPress={() => setListCollapsed(false)}
          hitSlop={8}
          style={styles.collapsedTab}
          accessibilityRole="button"
          accessibilityLabel={`Show ${beacons.length} beacons from friends`}
        >
          <Text style={styles.collapsedTabTxt}>
            {beacons.length} beacon{beacons.length !== 1 ? 's' : ''} from friends
          </Text>
          <Ionicons name="chevron-down" size={16} color="#E2E8F0" />
        </Pressable>
      ) : beacons.length > 0 ? (
        <>
          {/* The header doubles as the HIDE button (chevron). Hidden, the list shrinks to a small tab
              at the top that brings it back, leaving the scene clear. Remembered per device. */}
          <Pressable
            onPress={() => setListCollapsed(true)}
            hitSlop={8}
            style={styles.headerRow}
            onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
            accessibilityRole="button"
            accessibilityLabel="Hide friends' beacons"
          >
            <Text style={[styles.friendActiveHeader, { color: tc.text }]}>
              {beacons.length} beacon{beacons.length !== 1 ? 's' : ''} from friends
            </Text>
            <Ionicons name="chevron-up" size={18} color={tc.subtle} style={styles.headerChevron} />
          </Pressable>

          <View
            style={[
              styles.peekWrapper,
              listMaxHeight ? { maxHeight: listMaxHeight } : undefined,
              listHasOverflow ? { overflow: 'hidden' } : null,
            ]}
          >
            <ScrollView
              ref={listRef}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator
              contentContainerStyle={styles.cardsWrap}
            >
              {beacons.map((b, i) => (
                <FriendBeaconItem
                  key={b.id}
                  beacon={b}
                  ownerLabel={(nameCacheRef.current[b.ownerUid] || b.displayName || 'Friend').toString()}
                  rallyOwnerLabel={b.rallyOwnerUid ? nameCacheRef.current[b.rallyOwnerUid] : undefined}
                  isFirst={i === 0}
                  onFirstLayout={handleFirstLayout}
                  onSelect={onSelect}
                  tc={tc}
                />
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>

            {/* The fade band lets touches through (box-none) so a swipe starting on it still scrolls
                the list; only the pill itself is a button, and it scrolls down about one card. */}
            {listHasOverflow && showMoreHint && (
              <View style={styles.moreOverlay} pointerEvents="box-none">
                <Pressable
                  onPress={() => { tap(); listRef.current?.scrollTo({ y: (firstCardH || 90) + 10, animated: true }); }}
                  hitSlop={8}
                  style={styles.morePill}
                  accessibilityRole="button"
                  accessibilityLabel="Scroll for more beacons"
                >
                  <Text style={styles.morePillTxt}>▼  Scroll for more</Text>
                </Pressable>
              </View>
            )}
          </View>
        </>
      ) : (
        emptyReady ? (
          !online ? (
            <Text style={[styles.friendInactive, { color: tc.subtle }]}>
              Can’t load beacons. No internet connection.
            </Text>
          ) : showExampleWhenEmpty && friendUids.length === 0 ? (
            <View style={{ marginTop: 12 }}>
              <ExampleBeaconCard />
            </View>
          ) : (
            <Text style={[styles.friendInactive, { color: tc.subtle }]}>No friend beacons lit</Text>
          )
        ) : null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  friendsSection: {
    paddingHorizontal: SCREEN_PAD,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  friendActiveHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B1426',
    textAlign: 'center'
  },
  headerChevron: { marginLeft: 6 },
  collapsedTab: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
  },
  collapsedTabTxt: { color: '#E2E8F0', fontSize: 13, fontWeight: '700' },

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
  // Unread badge on the avatar's corner: the same ember as the home Chat pill's badge.
  unreadBadge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#FB923C',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeTxt: { color: '#1C0A00', fontSize: 10, fontWeight: '800' },
  rsvpCol: { alignItems: 'center', alignSelf: 'center' },
  // The connecting words in "Sam rallying to Devin's cause": names stay bold, these don't.
  rallyJoin: { fontWeight: '500' },

  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B1426',
    marginTop: 16,
    textAlign: 'center',
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