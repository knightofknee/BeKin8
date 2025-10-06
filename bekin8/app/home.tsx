// app/home.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import ChatRoom from '../components/ChatRoom';
import FriendsBeaconsList, { FriendBeacon } from '../components/FriendsBeaconsList';
import BottomBar from '@/components/BottomBar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { registerAndSaveExpoToken } from './lib/push';

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
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number')
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';

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

// --- Friend groups ---
type FriendGroup = {
  id: string;
  name: string;
  memberUids: string[];
};

export default function HomeScreen() {
  const router = useRouter();

  // Your beacon state
  const [isLit, setIsLit] = useState<boolean | null>(null);
  const [myActiveBeacon, setMyActiveBeacon] = useState<FriendBeacon | null>(null);
  const [nextPlannedDate, setNextPlannedDate] = useState<Date | null>(null);
  const [plannedMessage, setPlannedMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);

  // Modal state (options + details)
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dayOffset, setDayOffset] = useState<number>(0); // 0..6 selected chip
  const [message, setMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const [selectedBeacon, setSelectedBeacon] = useState<FriendBeacon | null>(null);

  // Friend groups state for scheduler
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // ---------- SUBSCRIBE: your beacon(s) (next 7 days) ----------
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => {
    const end = endOfDay(new Date(todayStart));
    end.setDate(end.getDate() + 6);
    return end;
  }, [todayStart]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setIsLit(false);
      setMyActiveBeacon(null);
      setNextPlannedDate(null);
      setPlannedMessage(DEFAULT_BEACON_MESSAGE);
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
        let activeDoc: { id: string; data: any } | null = null;
        let plannedSoonest: { id: string; data: any; start: Date } | null = null;

        snap.forEach((d) => {
          const data: any = d.data();
          const stMs = getMillis(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);

          if (data?.active) {
            if (
              !activeDoc ||
              getMillis(data?.updatedAt) > getMillis(activeDoc.data?.updatedAt)
            ) {
              activeDoc = { id: d.id, data };
            }
          } else if (data?.scheduled === true || data?.scheduled === 'true') {
            if (!plannedSoonest || st.getTime() < plannedSoonest.start.getTime()) {
              plannedSoonest = { id: d.id, data, start: st };
            }
          }
        });

        if (activeDoc) {
          const stMs = getMillis(activeDoc.data?.startAt);
          const msg =
            (typeof activeDoc.data?.message === 'string' && activeDoc.data.message.trim()) ||
            (typeof activeDoc.data?.details === 'string' && activeDoc.data.details.trim()) ||
            DEFAULT_BEACON_MESSAGE;

          setMyActiveBeacon({
            id: activeDoc.id,
            ownerUid: user.uid,
            displayName: 'You',
            startAt: new Date(stMs),
            active: true,
            scheduled:
              activeDoc.data?.scheduled === true || activeDoc.data?.scheduled === 'true',
            message: msg,
          });
          setIsLit(true);
          setPlannedMessage(msg);
          const gids: string[] = Array.isArray(activeDoc.data?.groupIds)
            ? activeDoc.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          setSelectedGroupIds(gids);
        } else {
          setMyActiveBeacon(null);
          setIsLit(false);
        }

        if (plannedSoonest) {
          const stMs = getMillis(plannedSoonest.data?.startAt);
          setNextPlannedDate(new Date(stMs));
          const msg =
            (typeof plannedSoonest.data?.message === 'string' &&
              plannedSoonest.data.message.trim()) ||
            (typeof plannedSoonest.data?.details === 'string' &&
              plannedSoonest.data.details.trim()) ||
            DEFAULT_BEACON_MESSAGE;
          setPlannedMessage(msg);

          const gids: string[] = Array.isArray(plannedSoonest.data?.groupIds)
            ? plannedSoonest.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          setSelectedGroupIds(gids);
        } else {
          setNextPlannedDate(null);
        }
      },
      (e) => {
        console.warn('mine onSnapshot error:', e);
        setIsLit(false);
        setMyActiveBeacon(null);
        setNextPlannedDate(null);
        setPlannedMessage(DEFAULT_BEACON_MESSAGE);
      }
    );

    return () => unsub();
  }, [todayStart, windowEnd]);

  // keep details modal live
  useEffect(() => {
    if (!selectedBeacon) return;
    const unsub = onSnapshot(doc(db, 'Beacons', selectedBeacon.id), (snap) => {
      if (!snap.exists()) {
        setSelectedBeacon(null);
        return;
      }
      const data: any = snap.data();
      const stMs = getMillis(data?.startAt);
      const msg =
        (typeof data?.message === 'string' && data.message.trim()) ||
        (typeof data?.details === 'string' && data.details.trim()) ||
        DEFAULT_BEACON_MESSAGE;

      setSelectedBeacon((prev) =>
        prev && stMs
          ? {
              ...prev,
              startAt: new Date(stMs),
              active: !!data?.active,
              scheduled: data?.scheduled === true || data?.scheduled === 'true',
              message: msg,
            }
          : prev
      );
    });
    return () => unsub();
  }, [selectedBeacon?.id]);

  // register the device’s push token (safe if it runs multiple times)
  useEffect(() => {
    registerAndSaveExpoToken();
  }, []);

  // Chips for the next 7 days (for Options Modal)
  const next7Days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const label =
        i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
      return { date: d, label, offset: i };
    });
  }, []);

  // Load friend groups — **skip unnamed groups** (no "Untit empty Group" fallback)
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setGroups([]);
      return;
    }
    setLoadingGroups(true);

    const qGroups = query(collection(db, 'FriendGroups'), where('ownerUid', '==', user.uid));
    const unsub = onSnapshot(
      qGroups,
      (snap) => {
        const mapped = snap.docs.map((d) => {
          const data: any = d.data();
          const rawMembers: any[] = data?.memberUids || data?.members || data?.memberIds || [];
          const memberUids = Array.isArray(rawMembers)
            ? rawMembers
                .map((m) => (typeof m === 'string' ? m : typeof m?.uid === 'string' ? m.uid : null))
                .filter(Boolean) as string[]
            : [];

          const name = (data?.name || data?.title || '').toString().trim();
          if (!name) return null; // skip unnamed groups entirely

          return { id: d.id, name, memberUids } as FriendGroup;
        });

        const arr: FriendGroup[] = (mapped.filter(Boolean) as FriendGroup[]).sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        setGroups(arr);
        setLoadingGroups(false);
      },
      () => {
        setGroups([]);
        setLoadingGroups(false);
      }
    );
    return () => unsub();
  }, []);

  // open options with prefill
  const openOptions = () => {
    const baseToday = startOfDay(new Date());
    let srcDate: Date | null = null;
    let srcMsg: string = DEFAULT_BEACON_MESSAGE;

    if (myActiveBeacon) {
      srcDate = startOfDay(myActiveBeacon.startAt);
      srcMsg = myActiveBeacon.message || DEFAULT_BEACON_MESSAGE;
    } else if (nextPlannedDate) {
      srcDate = startOfDay(nextPlannedDate);
      srcMsg = plannedMessage || DEFAULT_BEACON_MESSAGE;
    } else {
      srcDate = baseToday;
    }

    let diffDays = Math.round((srcDate.getTime() - baseToday.getTime()) / (24 * 3600 * 1000));
    if (diffDays < 0) diffDays = 0;
    if (diffDays > 6) diffDays = 6;

    setDayOffset(diffDays);
    setMessage(srcMsg);
    setOptionsOpen(true);
  };

  // toggle (off/on)
  const toggleBeacon = () => {
    const action = isLit ? 'Extinguish' : 'Light';
    Alert.alert(`${action} Beacon`, `Are you sure you want to ${action.toLowerCase()} your beacon?`, [
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

            if (isLit && myActiveBeacon) {
              await updateDoc(doc(db, 'Beacons', myActiveBeacon.id), {
                active: false,
                scheduled: true,
                updatedAt: serverTimestamp(),
              });

              const d = startOfDay(myActiveBeacon.startAt);
              setNextPlannedDate(d);
              setPlannedMessage(myActiveBeacon.message || DEFAULT_BEACON_MESSAGE);

              const baseToday = startOfDay(new Date());
              let diffDays = Math.round((d.getTime() - baseToday.getTime()) / (24 * 3600 * 1000));
              if (diffDays < 0) diffDays = 0;
              if (diffDays > 6) diffDays = 6;
              setDayOffset(diffDays);

              setIsLit(false);
              setMyActiveBeacon(null);
            } else {
              const base = startOfDay(new Date());
              const chosen = nextPlannedDate
                ? startOfDay(nextPlannedDate)
                : (() => {
                    const d = new Date(base);
                    d.setDate(base.getDate() + dayOffset);
                    return startOfDay(d);
                  })();
              const sd = startOfDay(chosen);
              const ed = endOfDay(chosen);

              const meUid = user.uid;
              let allowedUids: string[] = [meUid];
              groups
                .filter((g) => selectedGroupIds.includes(g.id))
                .forEach((g) => {
                  allowedUids.push(...g.memberUids);
                });
              allowedUids = Array.from(new Set(allowedUids));

              const ownerName = await resolveMyOwnerName(user);
              await addDoc(beaconsRef, {
                ownerUid: user.uid,
                ownerName,
                message: plannedMessage || DEFAULT_BEACON_MESSAGE,
                details: plannedMessage || DEFAULT_BEACON_MESSAGE,
                active: true,
                scheduled: true,
                createdAt: Timestamp.now(),
                updatedAt: serverTimestamp(),
                startAt: Timestamp.fromDate(sd),
                expiresAt: Timestamp.fromDate(ed),
                groupIds: selectedGroupIds,
                allowedUids,
              });

              const qDay = query(
                beaconsRef,
                where('ownerUid', '==', user.uid),
                where('startAt', '>=', Timestamp.fromDate(sd)),
                where('startAt', '<=', Timestamp.fromDate(ed))
              );
              const snapDay = await getDocs(qDay);
              await Promise.all(
                snapDay.docs
                  .filter((b) => b.data()?.active !== true)
                  .map((b) =>
                    updateDoc(b.ref, {
                      scheduled: false,
                      updatedAt: serverTimestamp(),
                    })
                  )
              );
            }
          } catch (err) {
            console.error('Error toggling beacon:', err);
            Alert.alert('Error', 'Failed to update beacon.');
          }
        },
      },
    ]);
  };

  // save options
  const saveBeaconOptions = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const base = startOfDay(new Date());
      const sd = startOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset));
      const ed = endOfDay(sd);

      const beaconsRef = collection(db, 'Beacons');
      const ownerName = await resolveMyOwnerName(user);

      const meUid = user.uid;
      let allowedUids: string[] = [meUid];
      groups
        .filter((g) => selectedGroupIds.includes(g.id))
        .forEach((g) => {
          allowedUids.push(...g.memberUids);
        });
      allowedUids = Array.from(new Set(allowedUids));

      if (isLit && myActiveBeacon) {
        await updateDoc(doc(db, 'Beacons', myActiveBeacon.id), {
          ownerName,
          message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          startAt: Timestamp.fromDate(sd),
          expiresAt: Timestamp.fromDate(ed),
          scheduled: true,
          updatedAt: serverTimestamp(),
          groupIds: selectedGroupIds,
          allowedUids,
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
            active: false,
            scheduled: true,
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            groupIds: selectedGroupIds,
            allowedUids,
          },
          { merge: true }
        );

        const qWin = query(
          beaconsRef,
          where('ownerUid', '==', user.uid),
          where('startAt', '>=', Timestamp.fromDate(todayStart)),
          where('startAt', '<=', Timestamp.fromDate(windowEnd))
        );
        const snap = await getDocs(qWin);
        const ops: Promise<any>[] = [];
        snap.forEach((d) => {
          const data: any = d.data();
          const stMs = getMillis(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);
          const isKeep = sameDay(st, sd);
          const isScheduled = data?.scheduled === true || data?.scheduled === 'true';
          const isActive = !!data?.active;
          if (!isKeep && isScheduled && !isActive) {
            ops.push(updateDoc(d.ref, { scheduled: false, updatedAt: serverTimestamp() }));
          }
        });
        if (ops.length) await Promise.all(ops);
      }

      setOptionsOpen(false);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to save options.');
    }
  };

  // "I'm in" handler
  const handleImIn = async () => {
    const user = auth.currentUser;
    const b = selectedBeacon;
    if (!user || !b) return;

    try {
      await updateDoc(doc(db, 'Beacons', b.id), {
        inUids: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });

      const name = await resolveMyOwnerName(user);
      await addDoc(collection(db, 'Beacons', b.id, 'ChatMessages'), {
        type: 'system',
        text: `${name || 'Someone'} is in`,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('im-in failed', e);
      Alert.alert('Error', 'Could not mark you as in. Try again.');
    }
  };

  // Loading baseline
  if (isLit === null) {
    return (
      <View style={styles.controls}>
        <Text style={styles.status}>Checking beacon status…</Text>
      </View>
    );
  }

  const scheduledDate = myActiveBeacon?.startAt ?? nextPlannedDate ?? startOfDay(new Date());
  const scheduledLabel = sameDay(scheduledDate, new Date())
    ? 'today'
    : scheduledDate.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();

  return (
    <>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={styles.page}>
          <View style={styles.beaconsWrap}>
            <FriendsBeaconsList onSelect={setSelectedBeacon} />
          </View>

          <View style={styles.controls}>
            <View style={styles.myBeaconRow}>
              <TouchableOpacity onPress={toggleBeacon} activeOpacity={0.7} style={styles.beaconContainer}>
                <Text style={styles.beaconIcon}>{isLit ? '🔥' : '🪵'}</Text>
              </TouchableOpacity>

              {isLit && myActiveBeacon ? (
                <TouchableOpacity
                  onPress={() => setSelectedBeacon(myActiveBeacon)}
                  activeOpacity={0.8}
                  style={styles.myChatBtn}
                >
                  <Text style={styles.myChatBtnTxt}>Open my beacon details</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Pressable
              onPress={openOptions}
              hitSlop={8}
              style={({ pressed }) => [styles.optionsCta, pressed && styles.optionsCtaPressed]}
              android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            >
              <View style={styles.optionsCtaIconWrap}>
                <Text style={styles.optionsCtaIcon}>🗓️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionsCtaTitle}>Beacon options</Text>
                <Text style={styles.optionsCtaSubtitle}>Pick a day • choose friends • add a note</Text>
              </View>
              <Text style={styles.optionsCtaChevron}>›</Text>
            </Pressable>

            {isLit && myActiveBeacon ? (
              <Text style={styles.statusActive}>Your beacon is ACTIVE for {scheduledLabel}</Text>
            ) : (
              <Text style={styles.status}>Your beacon is set for {scheduledLabel}</Text>
            )}
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

              {/* Day */}
              <Text style={styles.modalLabel}>Day</Text>
              <View style={styles.daysWrap}>
                {next7Days.map((d) => (
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

              {/* Friend Groups */}
              <Text style={[styles.modalLabel, { marginTop: 12 }]}>
                Friend Groups (if none selected, all friends can see)
              </Text>
              {loadingGroups ? (
                <View style={{ paddingVertical: 6 }}>
                  <ActivityIndicator />
                </View>
              ) : groups.length ? (
                <View style={styles.daysWrap}>
                  {groups.map((g) => {
                    const selected = selectedGroupIds.includes(g.id);
                    return (
                      <Pressable
                        key={g.id}
                        onPress={() =>
                          setSelectedGroupIds((prev) =>
                            selected ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                          )
                        }
                        style={[styles.dayChip, selected && styles.dayChipActive]}
                      >
                        <Text style={[styles.dayChipText, selected && styles.dayChipTextActive]}>{g.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={{ color: '#667085', marginBottom: 6 }}>
                  No groups yet — create some in Friends.
                </Text>
              )}

              {/* Message */}
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

        {/* Beacon details modal */}
        <Modal
          visible={!!selectedBeacon}
          animationType="fade"
          transparent
          onRequestClose={() => setSelectedBeacon(null)}
        >
          <View style={styles.modalBackdropCenter}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedBeacon(null)} />
            <View style={styles.detailCard} pointerEvents="box-none">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Beacon</Text>
                <Pressable onPress={() => setSelectedBeacon(null)}>
                  <Text style={styles.close}>✕</Text>
                </Pressable>
              </View>

              {selectedBeacon && (
                <>
                  <Text style={styles.detailOwner}>{selectedBeacon.displayName}</Text>
                  <View style={styles.detailMsgBox}>
                    <Text style={styles.detailMsg}>{selectedBeacon.message}</Text>
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <ChatRoom beaconId={selectedBeacon.id} maxHeight={420} />
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>

      <BottomBar />
    </>
  );
}

const styles = StyleSheet.create({
  // Page structure
  page: {
    flex: 1,
    gap: 8,
    paddingTop: 4,
    paddingHorizontal: 0,
  },
  beaconsWrap: {
    flex: 1,
    paddingHorizontal: 0,
  },

  controls: {
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    marginBottom: 72, // lift above BottomBar
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

  status: { fontSize: 16, color: '#555' },
  statusActive: { fontSize: 18, fontWeight: '600', color: 'green', marginBottom: 12 },

  // --- Options modal styles ---
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
    backgroundColor: '#fff',
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
    backgroundColor: '#fff',
  },
  msgHint: { color: '#667085', fontSize: 12, marginTop: 4 },

  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  btnPrimary: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: '#fff' },
  btnGhostText: { color: '#0B1426', fontWeight: '600' },

  // Details modal
  modalBackdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    padding: 22,
  },
  detailCard: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
  },
  detailOwner: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  detailMsgBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    padding: 10,
    borderRadius: 10,
  },
  detailMsg: { fontSize: 15, color: '#111827' },

  // Options CTA styles
  optionsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#EEF3FF',
    borderColor: '#D8E3FF',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  optionsCtaPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
  optionsCtaIconWrap: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionsCtaIcon: { color: '#fff', fontSize: 18, fontWeight: '800' },
  optionsCtaTitle: { fontSize: 16, fontWeight: '800', color: '#0B1426' },
  optionsCtaSubtitle: { marginTop: 2, color: '#48608C' },
  optionsCtaChevron: { fontSize: 22, color: '#2F6FED', marginLeft: 4, marginRight: 2 },
});