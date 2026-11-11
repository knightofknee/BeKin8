// components/ProfilePeek.tsx
//
// Tap a name anywhere in a beacon chat and see WHICH person it is: display name, @username, color,
// bio. Profiles are audience-scoped, so someone outside my audience (a rallied-in stranger) shows
// just the name we already had and a note that the profile isn't available.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.config';
import { useTheme } from '../providers/ThemeProvider';
import { tap } from '../utils/haptics';

export type PeekTarget = { uid: string; name?: string };

type Props = {
  target: PeekTarget | null;
  onClose: () => void;
  /** When provided, a "View profile" button routes to the full profile (the caller closes any modal above it). */
  onViewProfile?: (username: string) => void;
};

type Loaded = { username: string; displayName: string; color: string; bio: string } | 'unavailable';

export default function ProfilePeek({ target, onClose, onViewProfile }: Props) {
  const { colors } = useTheme();
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    setData(null);
    if (!target?.uid) return;
    let alive = true;
    getDoc(doc(db, 'Profiles', target.uid))
      .then((snap) => {
        if (!alive) return;
        if (!snap.exists()) { setData('unavailable'); return; }
        const d: any = snap.data();
        setData({
          username: (d?.username || '').toString().trim(),
          displayName: (d?.displayName || '').toString().trim(),
          color: (d?.profileColor || d?.avatarColor || '').toString().trim() || colors.primary,
          bio: (d?.bio || '').toString().trim(),
        });
      })
      .catch(() => { if (alive) setData('unavailable'); });
    return () => { alive = false; };
  }, [target?.uid]);

  const close = () => { tap(); onClose(); };
  const isMe = !!target && target.uid === auth.currentUser?.uid;
  const loaded = data && data !== 'unavailable' ? data : null;
  const title = loaded ? loaded.displayName || loaded.username : target?.name || 'Friend';
  const initial = (title[0] || '?').toUpperCase();

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.backdrop }]} onPress={close}>
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
          <View style={[styles.avatar, { backgroundColor: loaded?.color || colors.primary }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>{title}{isMe ? ' (you)' : ''}</Text>
          {data === null ? (
            <ActivityIndicator style={{ marginTop: 8 }} />
          ) : data === 'unavailable' ? (
            <Text style={[styles.handle, { color: colors.subtle }]}>Profile not available</Text>
          ) : (
            <>
              {!!loaded?.username && (
                <Text style={[styles.handle, { color: colors.subtle }]} numberOfLines={1}>@{loaded.username}</Text>
              )}
              {!!loaded?.bio && (
                <Text style={[styles.bio, { color: colors.text }]} numberOfLines={4}>{loaded.bio}</Text>
              )}
              {!!onViewProfile && !!loaded?.username && (
                <Pressable
                  onPress={() => { tap(); onViewProfile(loaded.username); }}
                  style={({ pressed }) => [styles.viewBtn, { borderColor: colors.primary }, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.viewBtnText, { color: colors.primary }]}>View profile</Text>
                </Pressable>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 26 },
  name: { fontSize: 19, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  handle: { fontSize: 14, marginTop: 3, textAlign: 'center' },
  bio: { fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: 'center' },
  viewBtn: { marginTop: 16, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  viewBtnText: { fontWeight: '800', fontSize: 14 },
});
