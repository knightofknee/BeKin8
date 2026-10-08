// components/RallyModal.tsx
// RALLY picker: who you're bringing. "All friends" or any of your friend groups (the tutorial's
// test group is never offered). Rallying lights YOUR beacon for the original beacon's plan; your
// picked friends get notified and join the original beacon's chat (lib/rsvp startRally).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase.config';
import { useTheme } from '../providers/ThemeProvider';
import { startRally } from '../lib/rsvp';
import { press, selection, success } from '../utils/haptics';

type Props = {
  visible: boolean;
  /** The ORIGINAL beacon being rallied for. */
  ogBeaconId: string | null;
  /** Its owner's name, for the copy. */
  ogOwnerName: string;
  onClose: () => void;
};

type Group = { id: string; name: string };

export default function RallyModal({ visible, ogBeaconId, ogOwnerName, onClose }: Props) {
  const { colors } = useTheme();
  const [groups, setGroups] = useState<Group[]>([]);
  const [picked, setPicked] = useState<string[]>([]); // [] = all friends
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPicked([]);
    const me = auth.currentUser?.uid;
    if (!me || !ogBeaconId) return;
    let alive = true;
    getDocs(query(collection(db, 'FriendGroups'), where('ownerUid', '==', me)))
      .then((snap) => {
        if (!alive) return;
        const testId = `${me}__tutorial_test`;
        setGroups(
          snap.docs
            .filter((d) => d.id !== testId)
            .map((d) => ({ id: d.id, name: String((d.data() as any)?.name || 'Group') }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible, ogBeaconId]);

  const toggle = (id: string) => {
    selection();
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const rally = async () => {
    if (!ogBeaconId || busy) return;
    press();
    setBusy(true);
    const ok = await startRally(ogBeaconId, picked);
    setBusy(false);
    if (ok) {
      success();
      onClose();
    }
  };

  const allOn = picked.length === 0;
  const Option = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={[styles.option, { borderColor: on ? colors.primary : colors.border, backgroundColor: colors.inputBg }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.primary : colors.subtle} />
      <Text style={[styles.optionTxt, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Rally your friends</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>
            You&apos;re going, and your beacon lights up for {ogOwnerName ? `${ogOwnerName}'s` : 'this'} plan. The friends
            you pick get notified and join the same chat.
          </Text>
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 8 }}>
            <Option label="All friends" on={allOn} onPress={() => { selection(); setPicked([]); }} />
            {groups.map((g) => (
              <Option key={g.id} label={g.name} on={picked.includes(g.id)} onPress={() => toggle(g.id)} />
            ))}
          </ScrollView>
          <View style={styles.row}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]} disabled={busy}>
              <Text style={[styles.btnTxt, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={rally} style={[styles.btn, { backgroundColor: colors.primary }]} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnTxt, { color: '#fff' }]}>Rally</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { width: '100%', borderRadius: 20, padding: 24 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 16 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  optionTxt: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontSize: 16, fontWeight: '700' },
});
