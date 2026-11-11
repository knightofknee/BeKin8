// components/FriendPickerSheet.tsx
//
// Pick individual friends for a beacon (the "+" chip next to the friend groups in Beacon options).
// Multi-select with search; selection is pushed up on every tap, so Done just closes.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { tap, selection } from '../utils/haptics';
import { friendLabel, type FriendLite } from '../lib/useFriends';

type Props = {
  visible: boolean;
  onClose: () => void;
  friends: FriendLite[];
  loading: boolean;
  selected: string[];
  onChange: (uids: string[]) => void;
};

export default function FriendPickerSheet({ visible, onClose, friends, loading, selected, onChange }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return friends;
    return friends.filter(
      (f) => f.username.toLowerCase().includes(needle) || (f.displayName || '').toLowerCase().includes(needle)
    );
  }, [friends, q]);

  const toggle = (uid: string) => {
    selection();
    onChange(selected.includes(uid) ? selected.filter((x) => x !== uid) : [...selected, uid]);
  };

  const close = () => {
    tap();
    setQ('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>Add friends</Text>
            <Pressable onPress={close} hitSlop={8} style={[styles.doneBtn, { backgroundColor: colors.primary }]} accessibilityRole="button">
              <Text style={styles.doneText}>Done{selected.length ? ` (${selected.length})` : ''}</Text>
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: colors.subtle }]}>
            They see this beacon along with any friend groups you picked.
          </Text>
          <View style={[styles.search, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.subtle} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search friends"
              placeholderTextColor={colors.subtle}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>

          {loading && friends.length === 0 ? (
            <View style={styles.empty}><ActivityIndicator /></View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(f) => f.uid}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: colors.subtle }}>{friends.length ? 'No matches.' : 'No friends yet. Add some in Friends.'}</Text>
                </View>
              }
              renderItem={({ item }) => {
                const on = selected.includes(item.uid);
                const label = friendLabel(item);
                return (
                  <Pressable
                    onPress={() => toggle(item.uid)}
                    style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { opacity: 0.7 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${label}, @${item.username}`}
                  >
                    <View style={[styles.avatar, { backgroundColor: item.profileColor || colors.primary }]}>
                      <Text style={styles.avatarText}>{label[0]?.toUpperCase() || '?'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{label}</Text>
                      {label !== item.username && (
                        <Text style={[styles.handle, { color: colors.subtle }]} numberOfLines={1}>@{item.username}</Text>
                      )}
                    </View>
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={on ? colors.primary : colors.border}
                    />
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 14, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800' },
  doneBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  doneText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 10 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
    marginBottom: 6,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '600' },
  handle: { fontSize: 12, marginTop: 1 },
  empty: { paddingVertical: 28, alignItems: 'center' },
});
