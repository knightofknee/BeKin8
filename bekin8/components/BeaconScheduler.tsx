// components/BeaconScheduler.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { auth, db } from '../firebase.config';
import {
  Timestamp,
  serverTimestamp,
  setDoc,
  doc,
  onSnapshot,
} from 'firebase/firestore';

const DEFAULT_BEACON_MESSAGE = 'Anyone want to chill?';

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
function yyyymmdd(d: Date) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}${m}${dd}`;
}

export default function BeaconScheduler() {
  const [dayOffset, setDayOffset] = useState<number>(0);
  const [message, setMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const [saving, setSaving] = useState<boolean>(false);
  const [meDisplayName, setMeDisplayName] = useState<string>('Me');

  // Next 7 days
  const next7Days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const label =
        i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return { date: d, label, offset: i };
    });
  }, []);

  // Get my display name
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userDocRef, (snap) => {
      const data = snap.data() as any;
      setMeDisplayName(data?.username || data?.displayName || user.email || 'Me');
    });
    return unsub;
  }, []);

  const upsertBeacon = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to set a beacon.');
      return;
    }
    setSaving(true);
    try {
      const targetDate = startOfDay(new Date());
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const sd = startOfDay(targetDate);
      const ed = endOfDay(targetDate);
      const id = `${user.uid}_${yyyymmdd(targetDate)}`;

      await setDoc(
        doc(db, 'beacons', id),
        {
          userId: user.uid,
          displayName: meDisplayName || user.email || 'Unknown',
          message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          startAt: Timestamp.fromDate(sd),
          expiresAt: Timestamp.fromDate(ed),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      Alert.alert(
        'Beacon set',
        dayOffset === 0
          ? 'Your beacon is live for today.'
          : `Your beacon is scheduled for ${targetDate.toLocaleDateString()}`
      );
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to set beacon.');
    } finally {
      setSaving(false);
    }
  }, [dayOffset, message, meDisplayName]);

  const cancelBeacon = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const targetDate = startOfDay(new Date());
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const id = `${user.uid}_${yyyymmdd(targetDate)}`;
      // Mark expired
      await setDoc(
        doc(db, 'beacons', id),
        {
          expiresAt: Timestamp.fromDate(new Date(Date.now() - 1000)),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      Alert.alert('Beacon cancelled', 'It will no longer appear as active/upcoming.');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to cancel beacon.');
    }
  }, [dayOffset]);

  return (
    <View>
      <Text style={styles.title}>Beacon options</Text>

      {/* Day chips */}
      <View style={styles.dayRow}>
        {next7Days.map((d) => (
          <TouchableOpacity
            key={d.offset}
            onPress={() => setDayOffset(d.offset)}
            style={[styles.dayChip, d.offset === dayOffset && styles.dayChipActive]}
          >
            <Text style={[styles.dayChipText, d.offset === dayOffset && styles.dayChipTextActive]}>
              {d.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Message */}
      <View style={styles.msgWrap}>
        <Text style={styles.msgLabel}>Message</Text>
        <TextInput
          style={styles.msgInput}
          placeholder={DEFAULT_BEACON_MESSAGE}
          value={message}
          onChangeText={setMessage}
          maxLength={140}
          multiline
          returnKeyType="done"
          blurOnSubmit={Platform.OS !== 'ios'}
        />
        <Text style={styles.msgHint}>140 chars • defaults if left blank</Text>
      </View>

      {/* Actions */}
      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={upsertBeacon} disabled={saving}>
          <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Set beacon'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={cancelBeacon} disabled={saving}>
          <Text style={styles.btnGhostText}>Cancel for this day</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const colors = {
  primary: '#2F6FED',
  ink: '#0B1426',
  dim: '#667085',
  border: '#E5E7EB',
};

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { color: colors.ink, fontSize: 14 },
  dayChipTextActive: { color: '#fff', fontWeight: '700' },

  msgWrap: { marginBottom: 8 },
  msgLabel: { fontSize: 14, color: colors.dim, marginBottom: 6 },
  msgInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  msgHint: { color: colors.dim, fontSize: 12, marginTop: 4 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: '#fff' },
  btnGhostText: { color: colors.ink, fontWeight: '600' },
});
