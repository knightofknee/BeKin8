// app/home.tsx
import React, { useState, useEffect, useMemo } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  collection,
  query,
  where,
  Timestamp,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { reconcileFriendEdges } from '@/helpers/ReconcileFriendEdges';

type FriendBeacon = {
  id: string;
  ownerUid: string;
  displayName: string;
};

// --- helpers for dates ---
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
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

const DEFAULT_BEACON_MESSAGE = 'Beacon lit — who’s in?';

export default function HomeScreen() {
  const router = useRouter();
  const [isLit, setIsLit] = useState<boolean | null>(null);

  // New: detailed list of friend beacons (today)
  const [friendBeacons, setFriendBeacons] = useState<FriendBeacon[] | null>(null);

  // Track the earliest active/scheduled beacon date for label
  const [nextBeaconDate, setNextBeaconDate] = useState<Date | null>(null);

  const friendLitCount = useMemo(
    () => (friendBeacons ? friendBeacons.length : null),
    [friendBeacons]
  );

  // --- modal state for scheduling/options ---
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dayOffset, setDayOffset] = useState<number>(0); // 0..6
  const [message, setMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const next7Days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const label =
        i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return { date: d, label, offset: i };
    });
  }, []);

  useEffect(() => {
    const todayStart = startOfDay(new Date());
    const windowEnd = endOfNextSixDays(todayStart);

    // --- Your own beacon: ANY in [today .. +6d] counts as lit (active OR scheduled) ---
    const checkUserBeacon = async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsLit(false);
        setNextBeaconDate(null);
        return;
      }
      const beaconsRef = collection(db, 'Beacons');
      const qOwn = query(
        beaconsRef,
        where('ownerUid', '==', user.uid),
        where('startAt', '>=', Timestamp.fromDate(todayStart)),
        where('startAt', '<=', Timestamp.fromDate(windowEnd))
      );
      try {
        const snap = await getDocs(qOwn);
        let lit = false;
        let soonest: Date | null = null;

        snap.forEach(d => {
          const data: any = d.data();
          const isCounting = data?.active || data?.scheduled;
          const st: Date | null = data?.startAt?.toDate ? data.startAt.toDate() : null;
          if (isCounting && st) {
            lit = true;
            if (!soonest || st.getTime() < soonest.getTime()) soonest = st;
          }
        });

        setIsLit(lit);
        setNextBeaconDate(soonest);
      } catch (err) {
        console.error('Error checking your beacon:', err);
        setIsLit(false);
        setNextBeaconDate(null);
      }
    };

    // --- Friends' beacons (active today) ---
    const checkFriendBeacons = async () => {
      const me = auth.currentUser;
      if (!me) {
        setFriendBeacons([]);
        return;
      }

      const beaconsRef = collection(db, 'Beacons');

      // 1) Build my friend UID list and a uid->username map
      const friendUids: string[] = [];
      const friendNameByUid: Record<string, string> = {};

      // Preferred subcollection: users/{uid}/friends
      try {
        const friendsSub = collection(db, 'users', me.uid, 'friends');
        const friendsSubSnap = await getDocs(friendsSub);
        friendsSubSnap.forEach(fd => {
          const f: any = fd.data();
          if (typeof f?.uid === 'string') {
            friendUids.push(f.uid);
            if (typeof f?.username === 'string') {
              friendNameByUid[f.uid] = f.username;
            }
          }
        });
      } catch {
        // ignore
      }

      // Fallback top-level Friends/{uid}.friends
      try {
        if (friendUids.length === 0) {
          const topRef = doc(db, 'Friends', me.uid);
          const topSnap = await getDoc(topRef);
          if (topSnap.exists()) {
            const arr = (topSnap.data() as any).friends;
            if (Array.isArray(arr)) {
              arr.forEach((f: any) => {
                if (f && typeof f === 'object' && typeof f.uid === 'string') {
                  if (!friendUids.includes(f.uid)) friendUids.push(f.uid);
                  if (typeof f.username === 'string') {
                    friendNameByUid[f.uid] = f.username;
                  }
                }
              });
            }
          }
        }
      } catch {
        // ignore
      }

      // 2) Candidate docs = A) beacons that include me, B) beacons owned by my friends
      const seen = new Set<string>();
      const candidateDocs: any[] = [];

      // A) Beacons that explicitly include me
      try {
        const qAudience = query(beaconsRef, where('audienceUids', 'array-contains', me.uid));
        const snapA = await getDocs(qAudience);
        snapA.forEach(d => {
          if (!seen.has(d.id)) { seen.add(d.id); candidateDocs.push(d); }
        });
      } catch (e) {
        console.warn('audienceUids query failed:', e);
      }

      // B) Beacons owned by my friends (chunk ownerUid IN by ≤10)
      const chunk = (arr: string[], size = 10) => {
        const out: string[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      try {
        const batches = chunk([...new Set(friendUids)].filter(Boolean), 10);
        for (const batch of batches) {
          const qOwners = query(beaconsRef, where('ownerUid', 'in', batch));
          const snapB = await getDocs(qOwners);
          snapB.forEach(d => {
            if (!seen.has(d.id)) { seen.add(d.id); candidateDocs.push(d); }
          });
        }
      } catch (e) {
        console.warn('ownerUid IN query failed:', e);
      }

      // 3) Filter locally for "active today" (use startAt for date)
      const startMs = todayStart.getTime();
      const endMs = endOfDay(new Date(todayStart)).getTime();

      const results: FriendBeacon[] = [];
      const ownersSeen = new Set<string>(); // de-dupe per owner

      candidateDocs.forEach(d => {
        const data: any = d.data();
        const active = !!data.active;
        const st = data?.startAt?.toMillis?.() ? data.startAt.toMillis() : 0;
        if (!active || st < startMs || st > endMs) return;

        const ownerUid = String(data.ownerUid ?? '');
        if (!ownerUid || ownersSeen.has(ownerUid)) return;

        const ownerName: string | undefined =
          (typeof data.ownerName === 'string' && data.ownerName.trim()) ? data.ownerName.trim() :
          (friendNameByUid[ownerUid] ?? undefined);

        results.push({
          id: d.id,
          ownerUid,
          displayName: ownerName ?? 'Friend',
        });
        ownersSeen.add(ownerUid);
      });

      // sort by name for stable UI
      results.sort((a, b) => a.displayName.localeCompare(b.displayName));

      setFriendBeacons(results);
    };

    (async () => {
      if (auth.currentUser) {
        try {
          await reconcileFriendEdges();
        } catch (e) {
          console.warn('reconcileFriendEdges failed:', e);
        }
      }
      checkUserBeacon();
      checkFriendBeacons();
    })();
  }, []);

  const toggleBeacon = () => {
    const action = isLit ? 'Extinguish' : 'Light';
    Alert.alert(
      `${action} Beacon`,
      `Are you sure you want to ${action.toLowerCase()} your beacon${isLit ? ' (today and any upcoming within 7 days)' : ''}?`,
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

            const todayStart = startOfDay(new Date());
            const windowEnd = endOfNextSixDays(todayStart);
            const beaconsRef = collection(db, 'Beacons');

            try {
              // Look for any beacon in the 7-day window by startAt
              const qWindow = query(
                beaconsRef,
                where('ownerUid', '==', user.uid),
                where('startAt', '>=', Timestamp.fromDate(todayStart)),
                where('startAt', '<=', Timestamp.fromDate(windowEnd))
              );
              const snap = await getDocs(qWindow);

              if (isLit && !snap.empty) {
                // Extinguish: deactivate/cancel all in the window
                const updates = snap.docs.map((b) =>
                  updateDoc(b.ref, {
                    active: false,
                    scheduled: false,
                    updatedAt: serverTimestamp(),
                    // ensure they won't show as upcoming
                    expiresAt: Timestamp.fromDate(new Date(Date.now() - 1000)),
                  })
                );
                await Promise.all(updates);
                setIsLit(false);
                setNextBeaconDate(null);
              } else if (!isLit) {
                // Light for TODAY (quick action)
                const todayStartLocal = startOfDay(new Date());
                const todayEndLocal = endOfDay(new Date());
                await addDoc(beaconsRef, {
                  ownerUid: user.uid,
                  ownerName: user.displayName ?? null,
                  message: DEFAULT_BEACON_MESSAGE,
                  details: DEFAULT_BEACON_MESSAGE, // legacy-friendly
                  active: true,
                  scheduled: true,
                  createdAt: Timestamp.now(),
                  updatedAt: serverTimestamp(),
                  startAt: Timestamp.fromDate(todayStartLocal),
                  expiresAt: Timestamp.fromDate(todayEndLocal),
                  audienceUids: [],
                  audienceUsernames: [],
                  friends: [],
                });
                setIsLit(true);
                setNextBeaconDate(todayStartLocal);
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

  // Save from modal: schedule for chosen day (0..6) with message
  const saveBeaconOptions = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to set a beacon.');
      return;
    }
    try {
      const base = startOfDay(new Date());
      base.setDate(base.getDate() + dayOffset);
      const sd = startOfDay(base);
      const ed = endOfDay(base);

      const beaconsRef = collection(db, 'Beacons');

      if (dayOffset === 0) {
        // TODAY: upsert by startAt range
        const qToday = query(
          beaconsRef,
          where('ownerUid', '==', user.uid),
          where('startAt', '>=', Timestamp.fromDate(startOfDay(new Date()))),
          where('startAt', '<=', Timestamp.fromDate(endOfDay(new Date())))
        );
        const snap = await getDocs(qToday);
        if (!snap.empty) {
          await updateDoc(snap.docs[0].ref, {
            message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            active: true,
            scheduled: true,
            updatedAt: serverTimestamp(),
          });
          setIsLit(true);
          setNextBeaconDate(sd);
          Alert.alert('Updated', 'Today’s beacon was updated.');
        } else {
          await addDoc(beaconsRef, {
            ownerUid: user.uid,
            ownerName: user.displayName ?? null,
            message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            active: true,
            scheduled: true,
            createdAt: Timestamp.now(),
            updatedAt: serverTimestamp(),
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
          });
          setIsLit(true);
          setNextBeaconDate(sd);
          Alert.alert('Beacon set', 'Your beacon is live for today.');
        }
      } else {
        // FUTURE: upsert deterministic doc id and mark scheduled
        const yyyy = sd.getFullYear();
        const mm = String(sd.getMonth() + 1).padStart(2, '0');
        const dd = String(sd.getDate()).padStart(2, '0');
        const docId = `${user.uid}_${yyyy}${mm}${dd}`;

        await setDoc(
          doc(db, 'Beacons', docId),
          {
            ownerUid: user.uid,
            ownerName: user.displayName ?? null,
            message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            active: false,     // not active today…
            scheduled: true,   // …but counts as lit in UI
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        setIsLit(true);
        setNextBeaconDate(sd);
        Alert.alert('Scheduled', `Beacon scheduled for ${sd.toLocaleDateString()}.`);
      }
      setOptionsOpen(false);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to save options.');
    }
  };

  // Compute friendly label: "today" or weekday name in lowercase
  const activeLabel = useMemo(() => {
    if (!isLit || !nextBeaconDate) return null;
    return sameDay(nextBeaconDate, new Date())
      ? 'today'
      : nextBeaconDate.toLocaleDateString(undefined, { weekday: 'long' });
  }, [isLit, nextBeaconDate]);

  // loading state
  if (isLit === null || friendBeacons === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.status}>Checking beacon status…</Text>
      </View>
    );
  }

  return (
    <>
      {/* Friend beacons section */}
      <View style={styles.friendsSection}>
        {friendBeacons.length > 0 ? (
          <>
            <Text style={styles.friendActiveHeader}>
              {friendBeacons.length} friend{friendBeacons.length > 1 ? 's have' : ' has'} active beacons
            </Text>

            {/* Chips grid: 🔥 Name */}
            <View style={styles.chipsWrap}>
              {friendBeacons.map((fb) => ( // later: make these clickable to open details/chat
                <View key={fb.id} style={styles.chip}>
                  <Text style={styles.chipIcon}>🔥</Text>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {fb.displayName}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.friendInactive}>No friends have active beacons today</Text>
        )}
      </View>

      {/* Bottom-hugging main area */}
      <View style={styles.container}>
        <TouchableOpacity
          onPress={toggleBeacon}
          activeOpacity={0.7}
          style={styles.beaconContainer}
        >
          <Text style={styles.beaconIcon}>
            {isLit ? '🔥' : '🪵'}
          </Text>
        </TouchableOpacity>

        {/* Open modal */}
        <TouchableOpacity onPress={() => setOptionsOpen(true)} activeOpacity={0.8}>
          <Text style={styles.title}>Beacon options</Text>
        </TouchableOpacity>
        <Text style={styles.subtitle}>
          Tap the {isLit ? 'fire to extinguish' : 'log to light'} your beacon
        </Text>

        {isLit ? (
          <Text style={styles.statusActive}>
            Your beacon is ACTIVE for {activeLabel}
          </Text>
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
              {next7Days.map(d => (
                <Pressable
                  key={d.offset}
                  onPress={() => setDayOffset(d.offset)}
                  style={[styles.dayChip, d.offset === dayOffset && styles.dayChipActive]}
                >
                  <Text style={[styles.dayChipText, d.offset === dayOffset && styles.dayChipTextActive]}>
                    {d.label}
                  </Text>
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

            {/* <Text style={styles.modalFootNote}>
              Tip: Saving for <Text style={{ fontWeight: '700' }}>{dayOffset === 0 ? 'Today' : next7Days[dayOffset].label}</Text>{' '}
              {dayOffset === 0 ? 'updates/creates today’s beacon.' : 'creates a scheduled beacon that still counts as lit.'}
            </Text> */}
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
  beaconContainer: {
    marginBottom: 24,
  },
  beaconIcon: {
    fontSize: 64,
  },
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
    color: 'green',
    marginBottom: 10,
  },
  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: 'red',
    marginTop: 16,
  },

  // Chips grid
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    maxWidth: '100%',
  },
  chipIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  chipText: {
    fontSize: 14,
    maxWidth: 160, // prevents overflow on very long names
  },

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
  modalCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
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

  modalFootNote: { marginTop: 8, color: '#667085' },
});
