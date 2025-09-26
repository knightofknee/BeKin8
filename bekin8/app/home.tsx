// app/home.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Button,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  collection,
  query,
  where,
  Timestamp,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  setDoc,
  onSnapshot,
  getDoc,
} from 'firebase/firestore';
import { reconcileFriendEdges } from '@/helpers/ReconcileFriendEdges';
import ChatRoom from '../components/ChatRoom';

type FriendBeacon = {
  id: string;
  ownerUid: string;
  displayName: string;
  startAt: Date;
  active: boolean;
  scheduled: boolean;
  message: string;
};

// --- date helpers ---
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function endOfNextSixDays(from: Date) {
  const end = endOfDay(new Date(from));
  end.setDate(end.getDate() + 6);
  return end;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isTomorrow(d: Date) {
  const n = startOfDay(new Date());
  n.setDate(n.getDate() + 1);
  return sameDay(d, n);
}
function dayLabel(d: Date) {
  const today = new Date();
  if (sameDay(d, today)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}
function shortDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Robustly get millis from Firestore Timestamp | Date | number-like
function getMillisFromMaybeTimestamp(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';

// Fetch profile usernames for unknown UIDs, returns uid->name map
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
    } catch {
      // ignore
    }
  }
  return results;
}

// Prefer Profiles.username -> auth.displayName -> null
async function resolveMyOwnerName(user: { uid: string; displayName?: string | null }) {
  let ownerName = (user.displayName || '').toString().trim();
  try {
    const p = await getDoc(doc(db, 'Profiles', user.uid));
    const u = (p.data() as any)?.username;
    if (typeof u === 'string' && u.trim()) ownerName = u.trim();
  } catch {
    // ignore
  }
  return ownerName || null;
}

export default function HomeScreen() {
  const router = useRouter();

  // Your beacon state (active + next active date)
  const [isLit, setIsLit] = useState<boolean | null>(null);
  const [nextBeaconDate, setNextBeaconDate] = useState<Date | null>(null);
  // Next planned (scheduled/draft) FUTURE date (never today)
  const [nextPlannedDate, setNextPlannedDate] = useState<Date | null>(null);

  // Friend beacons list (we will append your own newest at the bottom)
  const [friendBeacons, setFriendBeacons] = useState<FriendBeacon[] | null>(null);
  // NEW: track my newest beacon to open details/chat
  const [myNewestBeacon, setMyNewestBeacon] = useState<FriendBeacon | null>(null);

  // Modal state (options + friend/own details)
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dayOffset, setDayOffset] = useState<number>(0); // 0..6
  const [message, setMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const [selectedBeacon, setSelectedBeacon] = useState<FriendBeacon | null>(null);

  // Precompute "next 7 days" chips
  const next7Days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const label = i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return { date: d, label, offset: i };
    });
  }, []);

  // --- live friend sets + name cache ---
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const nameCacheRef = useRef<Record<string, string>>({}); // uid -> username
  const beaconUnsubsRef = useRef<(() => void)[]>([]);       // active beacon listeners
  const docStoreRef = useRef<Map<string, any>>(new Map());  // merged docs across listeners

  // Window bounds
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => endOfNextSixDays(todayStart), [todayStart]);

  // ---------- SUBSCRIBE: your beacon(s) in the next 7 days ----------
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setIsLit(false);
      setNextBeaconDate(null);
      setNextPlannedDate(null);
      setMyNewestBeacon(null);
      return;
    }
    const qMine = query(
      collection(db, 'Beacons'),
      where('ownerUid', '==', user.uid),
      where('startAt', '>=', Timestamp.fromDate(todayStart)),
      where('startAt', '<=', Timestamp.fromDate(windowEnd))
    );

    const unsub = onSnapshot(
      qMine,
      (snap) => {
        let activeSoonest: Date | null = null;
        let plannedSoonest: Date | null = null;
        let newestDoc: any = null;
        let newestCreatedMs = -1;

        const today = new Date();

        snap.forEach((d) => {
          const data: any = d.data();
          const stMs = getMillisFromMaybeTimestamp(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);

          const active = !!data?.active;
          const scheduledFlag = data?.scheduled === true || data?.scheduled === 'true';

          // track active soonest
          if (active) {
            if (!activeSoonest || st.getTime() < activeSoonest.getTime()) activeSoonest = st;
          }

          // track planned soonest (future only)
          if (!active && scheduledFlag && !sameDay(st, today)) {
            if (!plannedSoonest || st.getTime() < plannedSoonest.getTime()) plannedSoonest = st;
          }

          // track newest by created/updated for "open my beacon details"
          const createdMs =
            getMillisFromMaybeTimestamp(data?.createdAt) ||
            getMillisFromMaybeTimestamp(data?.updatedAt) ||
            0;
          if (createdMs > newestCreatedMs) {
            newestCreatedMs = createdMs;
            newestDoc = { id: d.id, data };
          }
        });

        setIsLit(!!activeSoonest);
        setNextBeaconDate(activeSoonest);
        setNextPlannedDate(plannedSoonest);

        // Build myNewestBeacon from the newest doc (if any)
        if (newestDoc) {
          const data = newestDoc.data as any;
          const stMs = getMillisFromMaybeTimestamp(data?.startAt);
          if (stMs) {
            const mine: FriendBeacon = {
              id: newestDoc.id,
              ownerUid: user.uid,
              displayName: 'You',
              startAt: new Date(stMs),
              active: !!data?.active,
              scheduled: data?.scheduled === true || data?.scheduled === 'true',
              message:
                (typeof data.message === 'string' && data.message.trim()) ||
                (typeof data.details === 'string' && data.details.trim()) ||
                DEFAULT_BEACON_MESSAGE,
            };
            setMyNewestBeacon(mine);
          } else {
            setMyNewestBeacon(null);
          }
        } else {
          setMyNewestBeacon(null);
        }
      },
      (e) => {
        console.warn('mine onSnapshot error:', e);
        setIsLit(false);
        setNextBeaconDate(null);
        setNextPlannedDate(null);
        setMyNewestBeacon(null);
      }
    );

    return () => unsub();
  }, [todayStart, windowEnd]);

  // ---------- SUBSCRIBE: friends (edges + subcollection) ----------
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      setFriendUids([]);
      return;
    }

    const unsubs: (() => void)[] = [];

    // Preferred subcollection (names too)
    unsubs.push(
      onSnapshot(collection(db, 'users', me.uid, 'friends'), (snap) => {
        const uids: Set<string> = new Set();
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

    // Canonical FriendEdges (accepted)
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

  // ---------- SUBSCRIBE: beacons (friends + audience), list + append my newest ----------
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      beaconUnsubsRef.current.forEach((fn) => fn());
      beaconUnsubsRef.current = [];
      docStoreRef.current.clear();
      setFriendBeacons([]);
      return;
    }

    // helper: apply a QuerySnapshot into our docStore
    const applySnapshot = (snap: any) => {
      const store = docStoreRef.current;
      snap.docChanges().forEach((chg: any) => {
        const id = chg.doc.id;
        if (chg.type === 'removed') {
          store.delete(id);
        } else {
          store.set(id, chg.doc.data());
        }
      });

      const startMs = todayStart.getTime();
      const endMs = windowEnd.getTime();

      type Candidate = FriendBeacon & { _createdMs: number };
      const candidates: Candidate[] = [];
      const unknownUids = new Set<string>();

      // gather friend/audience beacons (not my own)
      store.forEach((data: any, id: string) => {
        const stMillis = getMillisFromMaybeTimestamp(data?.startAt);
        if (!stMillis || stMillis < startMs || stMillis > endMs) return;

        const ownerUid = String(data.ownerUid ?? '');
        if (!ownerUid) return;
        if (ownerUid === me.uid) return; // my own handled via myNewestBeacon

        const active = !!data?.active;
        const scheduled = data?.scheduled === true || data?.scheduled === 'true';
        const scheduledLike = scheduled || (!active && stMillis >= startMs);
        if (!active && !scheduledLike) return;

        if (!nameCacheRef.current[ownerUid]) unknownUids.add(ownerUid);

        const ownerName: string =
          (typeof data.ownerName === 'string' && data.ownerName.trim()) ||
          nameCacheRef.current[ownerUid] ||
          'Friend';

        const msg: string =
          (typeof data.message === 'string' && data.message.trim()) ||
          (typeof data.details === 'string' && data.details.trim()) ||
          DEFAULT_BEACON_MESSAGE;

        const createdMs =
          getMillisFromMaybeTimestamp(data?.createdAt) ||
          getMillisFromMaybeTimestamp(data?.updatedAt) ||
          0;

        candidates.push({
          id,
          ownerUid,
          displayName: ownerName,
          startAt: new Date(stMillis),
          active,
          scheduled: !!scheduledLike,
          message: msg,
          _createdMs: createdMs,
        });
      });

      // keep newest created per friend owner
      const byOwner = new Map<string, Candidate>();
      candidates.forEach((b) => {
        const prev = byOwner.get(b.ownerUid);
        if (!prev || (b._createdMs || 0) > (prev._createdMs || 0)) {
          byOwner.set(b.ownerUid, b);
        }
      });
      const out = Array.from(byOwner.values());

      // sort friends by start date asc, then name
      out.sort((a, b) => {
        const diff = a.startAt.getTime() - b.startAt.getTime();
        if (diff !== 0) return diff;
        return a.displayName.localeCompare(b.displayName);
      });

      // append my newest beacon (if any)
      if (myNewestBeacon) out.push(myNewestBeacon);

      setFriendBeacons(out);

      // resolve unknown names lazily
      if (unknownUids.size) {
        out.forEach((b) => {
          if (b.displayName !== 'Friend') unknownUids.delete(b.ownerUid);
        });
        if (unknownUids.size) {
          fetchProfileNames(Array.from(unknownUids)).then((map) => {
            if (!map || Object.keys(map).length === 0) return;
            Object.assign(nameCacheRef.current, map);
            setFriendBeacons((prev) => (prev ? [...prev] : prev));
          });
        }
      }
    };

    // cleanup old listeners
    beaconUnsubsRef.current.forEach((fn) => fn());
    beaconUnsubsRef.current = [];
    docStoreRef.current.clear();

    const unsubs: (() => void)[] = [];

    // (A) Beacons where audience includes me
    const qAudience = query(collection(db, 'Beacons'), where('audienceUids', 'array-contains', me.uid));
    unsubs.push(onSnapshot(qAudience, applySnapshot, (e) => console.warn('audience onSnapshot error:', e)));

    // (B) Beacons owned by my friends (chunk ownerUid IN by ≤10)
    const uids = Array.from(new Set(friendUids)).filter(Boolean);
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
    // include myNewestBeacon so list re-renders when it changes
  }, [friendUids, todayStart, windowEnd, myNewestBeacon]);

  // ---------- initial reconcile on mount ----------
  useEffect(() => {
    if (!auth.currentUser) return;
    reconcileFriendEdges().catch((e) => console.warn('reconcileFriendEdges failed (home):', e));
  }, []);

  // ---------- toggle (quick action) ----------
  const toggleBeacon = () => {
    const action = isLit ? 'Extinguish' : 'Light';
    Alert.alert(
      `${action} Beacon`,
      `Are you sure you want to ${action.toLowerCase()} your beacon${isLit ? ' for today' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: isLit ? 'destructive' : 'default',
          onPress: async () => {
            const user = auth.currentUser;
            if (!user) {
              Alert.alert('Error', 'User not authenticated');
              return;
            }

            try {
              const beaconsRef = collection(db, 'Beacons');
              const sd = startOfDay(new Date());
              const ed = endOfDay(new Date());

              // Query only TODAY’s beacons
              const qToday = query(
                beaconsRef,
                where('ownerUid', '==', user.uid),
                where('startAt', '>=', Timestamp.fromDate(sd)),
                where('startAt', '<=', Timestamp.fromDate(ed))
              );
              const snap = await getDocs(qToday);

              if (isLit) {
                // Extinguish: today’s; clear scheduled so it disappears
                if (!snap.empty) {
                  const updates = snap.docs.map((b) =>
                    updateDoc(b.ref, {
                      active: false,
                      scheduled: false,
                      updatedAt: serverTimestamp(),
                    })
                  );
                  await Promise.all(updates);
                }
                setIsLit(false);
                setNextBeaconDate(null);
              } else {
                // Light: update or create for today
                if (!snap.empty) {
                  await Promise.all(
                    snap.docs.map((b) =>
                      updateDoc(b.ref, {
                        active: true,
                        scheduled: true,
                        updatedAt: serverTimestamp(),
                      })
                    )
                  );
                } else {
                  const ownerName = await resolveMyOwnerName(user);
                  await addDoc(beaconsRef, {
                    ownerUid: user.uid,
                    ownerName,
                    message: DEFAULT_BEACON_MESSAGE,
                    details: DEFAULT_BEACON_MESSAGE,
                    active: true,
                    scheduled: true,
                    createdAt: Timestamp.now(),
                    updatedAt: serverTimestamp(),
                    startAt: Timestamp.fromDate(sd),
                    expiresAt: Timestamp.fromDate(ed),
                    audienceUids: [],
                    audienceUsernames: [],
                    friends: [],
                  });
                }
                setIsLit(true);
                setNextBeaconDate(sd);
              }
            } catch (err) {
              console.error('Error toggling beacon:', err);
              Alert.alert('Error', 'Failed to update beacon.');
            }
          },
        },
      ]
    );
  };

  // Helper: clear other scheduled drafts in window (except chosen day)
  const clearOtherScheduledDrafts = async (uid: string, keepStart: Date) => {
    const beaconsRef = collection(db, 'Beacons');
    const qWin = query(
      beaconsRef,
      where('ownerUid', '==', uid),
      where('startAt', '>=', Timestamp.fromDate(todayStart)),
      where('startAt', '<=', Timestamp.fromDate(windowEnd))
    );
    const snap = await getDocs(qWin);
    const ops: Promise<any>[] = [];
    snap.forEach((d) => {
      const data: any = d.data();
      const stMs = getMillisFromMaybeTimestamp(data?.startAt);
      if (!stMs) return;
      const st = new Date(stMs);
      const isKeep = sameDay(st, keepStart);
      const isScheduled = data?.scheduled === true || data?.scheduled === 'true';
      const isActive = !!data?.active;
      if (!isKeep && isScheduled && !isActive) {
        ops.push(updateDoc(d.ref, { scheduled: false, updatedAt: serverTimestamp() }));
      }
    });
    if (ops.length) await Promise.all(ops);
  };

  // ---------- Save from modal (NEVER activates) ----------
  const saveBeaconOptions = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const base = startOfDay(new Date());
      base.setDate(base.getDate() + dayOffset);
      const sd = startOfDay(base);
      const ed = endOfDay(base);

      const beaconsRef = collection(db, 'Beacons');
      const ownerName = await resolveMyOwnerName(user);

      // Upsert a doc for the chosen date. DO NOT flip active here.
      const qDay = query(
        beaconsRef,
        where('ownerUid', '==', user.uid),
        where('startAt', '>=', Timestamp.fromDate(sd)),
        where('startAt', '<=', Timestamp.fromDate(ed))
      );
      const snap = await getDocs(qDay);

      if (!snap.empty) {
        const docRef = snap.docs[0].ref;
        await updateDoc(docRef, {
          ownerName,
          message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          startAt: Timestamp.fromDate(sd),
          expiresAt: Timestamp.fromDate(ed),
          scheduled: true, // draft only
          updatedAt: serverTimestamp(),
        });
      } else {
        const yyyy = sd.getFullYear();
        const mm = String(sd.getMonth() + 1).padStart(2, '0');
        const dd = String(sd.getDate()).padStart(2, '0');
        const deterministicId = `${user.uid}_${yyyy}${mm}${dd}`;

        await setDoc(
          doc(db, 'Beacons', deterministicId),
          {
            ownerUid: user.uid,
            ownerName,
            message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            active: false,   // not lit
            scheduled: true, // draft
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Keep only the chosen draft in the 7-day window (so labels match)
      await clearOtherScheduledDrafts(user.uid, sd);

      // Update local labels so the status reflects scheduler immediately
      if (dayOffset === 0) {
        setNextPlannedDate(null);           // never show "scheduled for today"
        if (isLit) setNextBeaconDate(sd);   // if lit, keep ACTIVE label correct
      } else {
        setNextPlannedDate(sd);             // show SCHEDULED label for future day
      }

      setOptionsOpen(false);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to save options.');
    }
  };

  // Friendly labels
  const activeLabel = useMemo(() => {
    if (!nextBeaconDate) return null;
    return sameDay(nextBeaconDate, new Date())
      ? 'today'
      : nextBeaconDate.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
  }, [nextBeaconDate]);

  const plannedLabel = useMemo(() => {
    if (!nextPlannedDate) return null;
    if (sameDay(nextPlannedDate, new Date())) return null; // never show "scheduled for today"
    return nextPlannedDate.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
  }, [nextPlannedDate]);

  const activeTodayCount = useMemo(() => {
    if (!friendBeacons) return 0;
    const today = new Date();
    return friendBeacons.filter((b) => sameDay(b.startAt, today) && b.active).length;
  }, [friendBeacons]);

  // NEW: counts that exclude my own appended beacon (for header display only)
  const meUid = auth.currentUser?.uid || null;

  const friendOnlyCount = useMemo(() => {
    if (!friendBeacons) return 0;
    return friendBeacons.filter((b) => b.ownerUid !== meUid).length;
  }, [friendBeacons, meUid]);

  const friendOnlyActiveTodayCount = useMemo(() => {
    if (!friendBeacons) return 0;
    const today = new Date();
    return friendBeacons.filter(
      (b) => b.ownerUid !== meUid && sameDay(b.startAt, today) && b.active
    ).length;
  }, [friendBeacons, meUid]);

  // Loading
  if (isLit === null || friendBeacons === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.status}>Checking beacon status…</Text>
      </View>
    );
  }

  // ----- Card styles for state
  const beaconCardStyle = (b: FriendBeacon) => {
    const isToday = sameDay(b.startAt, new Date());
    if (isToday && b.active) return [styles.beaconItem, styles.cardActiveToday];
    if (!isToday) return [styles.beaconItem, styles.cardFuture];
    return [styles.beaconItem, styles.cardTodayScheduled];
  };

  // Small card item for friend beacon (CLICKABLE)
  const FriendBeaconItem = ({ beacon }: { beacon: FriendBeacon }) => {
    const isToday = sameDay(beacon.startAt, new Date());
    const status = isToday && beacon.active ? 'Active today' : beacon.active ? 'Active' : 'Scheduled';

    return (
      <Pressable
        onPress={() => setSelectedBeacon(beacon)}
        style={({ pressed }) => [beaconCardStyle(beacon), pressed && { opacity: 0.8 }]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarTxt}>{beacon.displayName?.[0]?.toUpperCase() || 'F'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.beaconOwner} numberOfLines={1}>
            {beacon.displayName}
          </Text>
          <Text style={styles.beaconWhen} numberOfLines={1}>
            {dayLabel(beacon.startAt)} • {shortDate(beacon.startAt)} • {status}
          </Text>
          <Text style={styles.beaconMsg} numberOfLines={2}>
            {beacon.message}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <>
      {/* Friend beacons section (appends your newest at the bottom) */}
      <View style={styles.friendsSection}>
        {friendBeacons.length > 0 ? (
          <>
            <Text style={styles.friendActiveHeader}>
              {friendOnlyCount} beacon{friendOnlyCount !== 1 ? 's' : ''} from friends
              {friendOnlyActiveTodayCount ? ` • ${friendOnlyActiveTodayCount} active today` : ''}
            </Text>

            <ScrollView
              style={{ maxHeight: 280 }}
              contentContainerStyle={styles.cardsWrap}
              showsVerticalScrollIndicator={false}
            >
              {friendBeacons.map((fb) => (
                <FriendBeaconItem key={fb.id} beacon={fb} />
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={styles.friendInactive}>No friend beacons today or upcoming</Text>
        )}
      </View>

      {/* Bottom-hugging main area */}
      <View style={styles.container}>
        <View style={styles.myBeaconRow}>
          <TouchableOpacity onPress={toggleBeacon} activeOpacity={0.7} style={styles.beaconContainer}>
            <Text style={styles.beaconIcon}>{isLit ? '🔥' : '🪵'}</Text>
          </TouchableOpacity>

          {/* Only show when beacon is ON and we have myNewestBeacon */}
          {isLit && myNewestBeacon ? (
            <TouchableOpacity
              onPress={() => setSelectedBeacon(myNewestBeacon)}
              activeOpacity={0.8}
              style={styles.myChatBtn}
            >
              <Text style={styles.myChatBtnTxt}>Open my beacon details</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Open options */}
        <TouchableOpacity onPress={() => setOptionsOpen(true)} activeOpacity={0.8}>
          <Text style={styles.title}>Beacon options</Text>
        </TouchableOpacity>
        <Text style={styles.subtitle}>Tap the {isLit ? 'fire to extinguish' : 'log to light'} your beacon</Text>

        {isLit && activeLabel ? (
          <Text style={styles.statusActive}>Your beacon is ACTIVE for {activeLabel}</Text>
        ) : plannedLabel ? (
          <Text style={styles.status}>Your beacon is SCHEDULED for {plannedLabel}</Text>
        ) : (
          <Text style={styles.statusInactive}>Your beacon is INACTIVE</Text>
        )}

        <View style={styles.feedButton}>
          <Button title="Go to Feed" onPress={() => router.push('/feed')} />
        </View>
        <View style={styles.feedButton}>
          <Button title="Friends" onPress={() => router.push('/friends')} />
        </View>
        <View style={styles.feedButton}>
          <Button title="Create Post" onPress={() => router.push('/create-post')} />
        </View>
      </View>

      {/* Options Modal */}
      <Modal visible={optionsOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule / Edit Beacon</Text>
              <Pressable onPress={() => setOptionsOpen(false)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Day</Text>
            <View style={styles.daysWrap}>
              {next7Days.map((d) => (
                <Pressable
                  key={d.offset}
                  onPress={() => setDayOffset(d.offset)}
                  style={[styles.dayChip, d.offset === dayOffset && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipText, d.offset === dayOffset && styles.dayChipTextActive]}>{d.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.modalLabel, { marginTop: 12 }]}>Message</Text>
            <TextInput
              style={styles.msgInput}
              placeholder={DEFAULT_BEACON_MESSAGE}
              value={message}
              onChangeText={setMessage}
              maxLength={140}
              multiline
            />
            <Text style={styles.msgHint}>140 chars • defaults if left blank</Text>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setOptionsOpen(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={saveBeaconOptions}>
                <Text style={styles.btnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Friend/Own beacon details modal (on card click) */}
      <Modal visible={!!selectedBeacon} animationType="fade" transparent onRequestClose={() => setSelectedBeacon(null)}>
        <View style={styles.modalBackdropCenter}>
          <View style={styles.detailCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Beacon</Text>
              <Pressable onPress={() => setSelectedBeacon(null)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            {selectedBeacon && (
              <>
                <Text style={styles.detailOwner}>{selectedBeacon.displayName}</Text>
                <Text style={styles.detailWhen}>
                  {dayLabel(selectedBeacon.startAt)} • {selectedBeacon.startAt.toLocaleString()}
                </Text>
                <Text style={styles.detailStatus}>
                  {sameDay(selectedBeacon.startAt, new Date()) && selectedBeacon.active
                    ? 'Active today'
                    : selectedBeacon.active
                    ? 'Active'
                    : 'Scheduled'}
                </Text>
                <View style={styles.detailMsgBox}>
                  <Text style={styles.detailMsg}>{selectedBeacon.message}</Text>
                </View>
                <View style={{ marginTop: 12 }}>
                  <ChatRoom beaconId={selectedBeacon.id} maxHeight={260} />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Bottom-hugging main area
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    padding: 24,
    justifyContent: 'flex-end',
    paddingBottom: 50,
  },
  myBeaconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  beaconContainer: {
    marginBottom: 8,
  },
  beaconIcon: {
    fontSize: 64,
  },
  myChatBtn: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  myChatBtnTxt: { fontWeight: '700', color: '#0B1426' },

  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  status: {
    fontSize: 16,
    color: '#555',
  },
  statusActive: {
    fontSize: 18,
    fontWeight: '600',
    color: 'green',
    marginBottom: 12,
    textTransform: 'none',
  },
  statusInactive: {
    fontSize: 18,
    fontWeight: '600',
    color: 'red',
    marginBottom: 12,
  },

  // Friends section
  friendsSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  friendActiveHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B1426',
    marginBottom: 10,
  },
  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: 'red',
    marginTop: 16,
  },

  // Beacon cards list
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
  beaconOwner: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B1426',
  },
  beaconWhen: {
    fontSize: 13,
    color: '#334155',
    marginTop: 2,
  },
  beaconMsg: {
    fontSize: 14,
    color: '#111827',
    marginTop: 4,
  },
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

  feedButton: {
    marginTop: 24,
    width: '60%',
  },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  modalBackdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    padding: 22,
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  detailCard: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  close: { fontSize: 22, paddingHorizontal: 8 },
  modalLabel: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 6 },

  daysWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  dayChipActive: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  dayChipText: { color: '#0B1426', fontSize: 14 },
  dayChipTextActive: { color: '#fff', fontWeight: '700' },

  msgInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  msgHint: { color: '#667085', fontSize: 12, marginTop: 4 },

  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  btnPrimary: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: '#fff' },
  btnGhostText: { color: '#0B1426', fontWeight: '600' },

  detailOwner: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  detailWhen: { fontSize: 14, color: '#334155', marginTop: 6 },
  detailStatus: { fontSize: 14, color: '#0B1426', marginTop: 6, fontWeight: '700' },
  detailMsgBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    padding: 10,
    borderRadius: 10,
  },
  detailMsg: { fontSize: 15, color: '#111827' },
});