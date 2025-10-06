// components/ChatRoom.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ActionSheetIOS,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

type ChatMessage = {
  id: string;
  text: string;
  createdAt: Date;
  authorUid?: string;
  authorName?: string;
  type?: 'user' | 'system';
  subtype?: 'im-in' | string;
  actorUid?: string;
  actorName?: string;
};

type ChatRoomProps = {
  beaconId: string;
  /** Height cap for the chat panel; omit to use tall default */
  maxHeight?: number;
  /** If provided, renders a local backdrop that closes when tapped (like PostComments) */
  onClose?: () => void;
  /** Optional style for the outer card/panel */
  style?: StyleProp<ViewStyle>;
};

function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

async function resolveMyName(uid: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'Profiles', uid));
    const username = (snap.data() as any)?.username;
    if (typeof username === 'string' && username.trim()) return username.trim();
  } catch {}
  const u = auth.currentUser;
  return (u?.displayName || '').toString().trim() || 'Me';
}

export default function ChatRoom({ beaconId, maxHeight = 420, onClose, style }: ChatRoomProps) {
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // 3-dots menu state (Android/others)
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);

  // Slim header state
  const [startLabel, setStartLabel] = useState<string>('');
  const expiresAtRef = useRef<number | null>(null);

  // 🔽 FlatList ref + scroll flags
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pendingScrollRef = useRef(false);
  const didInitialScrollRef = useRef(false);

  // Show a small "scroll to top" arrow when not at the top
  const [canScrollUp, setCanScrollUp] = useState(false);

  // Subscribe to the beacon meta (for TTL + date)
  useEffect(() => {
    const ref = doc(db, 'Beacons', beaconId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          expiresAtRef.current = null;
          setStartLabel('');
          return;
        }
        const data: any = snap.data();
        const expiresAtMs = getMillis(data?.expiresAt);
        expiresAtRef.current = expiresAtMs || null;

        const stMs = getMillis(data?.startAt);
        if (stMs) {
          const d = new Date(stMs);
          setStartLabel(
            d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
          );
        } else {
          setStartLabel('');
        }
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [beaconId]);

  // Subscribe to messages
  useEffect(() => {
    const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
    const q = query(col, orderBy('createdAt', 'asc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      const arr: ChatMessage[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const createdAtMs = getMillis(data?.createdAt) || 0;
        arr.push({
          id: d.id,
          text: (data?.text || '').toString(),
          authorUid: data?.authorUid ? String(data.authorUid) : undefined,
          authorName: data?.authorName ? String(data.authorName) : undefined,
          createdAt: createdAtMs ? new Date(createdAtMs) : new Date(0),
          type: (data?.type as any) || 'user',
          subtype: data?.subtype ? String(data.subtype) : undefined,
          actorUid: data?.actorUid ? String(data.actorUid) : undefined,
          actorName: data?.actorName ? String(data.actorName) : undefined,
        });
      });
      setMessages(arr);
    });

    return () => unsub();
  }, [beaconId]);

  // ✅ Scroll logic:
  // 1) After first load with content, scroll to bottom once.
  // 2) Whenever we have a pending scroll (after sending), scroll on ANY messages update.
  useEffect(() => {
    if (messages.length > 0 && !didInitialScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        didInitialScrollRef.current = true;
        setCanScrollUp(true); // we started at bottom, so there IS content above
      });
      return;
    }
    if (pendingScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
        pendingScrollRef.current = false;
        setCanScrollUp(true);
      });
    }
  }, [messages]);

  const iAmIn = useMemo(() => {
    if (!me) return false;
    return messages.some((m) => m.type === 'system' && m.subtype === 'im-in' && m.actorUid === me.uid);
  }, [messages, me]);

  const canSendMsg = useMemo(() => !!me && text.trim().length > 0 && !sending, [me, text, sending]);

  const handleSend = async () => {
    if (!canSendMsg || !me) return;
    try {
      setSending(true);
      const authorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
      const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

      await addDoc(col, {
        text: text.trim(),
        authorUid: me.uid,
        authorName,
        type: 'user',
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });

      setText('');
      // Ask to scroll once snapshot includes/updates our row
      pendingScrollRef.current = true;
    } catch (e) {
      Alert.alert('Send failed', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleImIn = async () => {
    if (!me || iAmIn) return;
    try {
      const actorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
      const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

      await addDoc(col, {
        type: 'system',
        subtype: 'im-in',
        actorUid: me.uid,
        actorName,
        text: `${actorName} is in`,
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });

      pendingScrollRef.current = true;
    } catch {
      Alert.alert("Couldn't set status", 'Please try again.');
    }
  };

  // Menu helpers (unchanged)
  const openMenu = (msg: ChatMessage) => {
    if (msg.type === 'system') return;
    if (Platform.OS === 'ios' && ActionSheetIOS) {
      const isMine = !!me && msg.authorUid === me.uid;
      const options = ['Cancel', 'Report'];
      const cancelButtonIndex = 0;
      let destructiveButtonIndex: number | undefined = undefined;
      if (isMine) {
        options.push('Delete message');
        destructiveButtonIndex = options.length - 1;
      }
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Options', options, cancelButtonIndex, destructiveButtonIndex },
        async (idx) => {
          const picked = options[idx];
          if (picked === 'Report') await handleReport(msg);
          if (picked === 'Delete message') await handleDelete(msg);
        }
      );
    } else {
      setMenuFor(msg);
    }
  };

  const handleReport = async (msg: ChatMessage) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await addDoc(collection(db, 'Reports'), {
        targetType: 'beacon_message',
        beaconId,
        messageId: msg.id,
        messageAuthorUid: msg.authorUid || null,
        reporterUid: uid,
        createdAt: serverTimestamp(),
        status: 'open',
        snippet: String(msg.text || '').slice(0, 200),
      });
      Alert.alert('Thanks', 'We received your report.');
    } catch (e: any) {
      Alert.alert('Report failed', e?.message ?? 'Please try again.');
    }
  };

  const handleDelete = async (msg: ChatMessage) => {
    const uid = auth.currentUser?.uid;
    if (!uid || msg.authorUid !== uid) return;
    try {
      await deleteDoc(doc(db, 'Beacons', beaconId, 'ChatMessages', msg.id));
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message ?? 'Please try again.');
    } finally {
      setMenuFor(null);
    }
  };

  // track whether we can scroll up (i.e., not at top)
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setCanScrollUp(y > 8);
  };

  const scrollToTop = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // -------- Render body (the panel) --------
  const Panel = (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.wrap, { maxHeight }, style]}
    >
      {/* Slim header */}
      {(startLabel || true) && (
        <View style={styles.slimHeader}>
          <Text style={styles.slimDate}>{startLabel || 'Beacon'}</Text>

          {iAmIn ? (
            <View style={[styles.imInChip, styles.imInChipDone]}>
              <Text style={[styles.imInText, styles.imInTextDone]}>✓ I’m in</Text>
            </View>
          ) : (
            <Pressable
              onPress={handleImIn}
              style={({ pressed }) => [styles.imInChip, pressed && { opacity: 0.9 }]}
              hitSlop={8}
            >
              <Text style={styles.imInText}>I’m in</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Floating "more above" arrow */}
      {canScrollUp && (
        <Pressable
          onPress={scrollToTop}
          hitSlop={10}
          style={({ pressed }) => [
            styles.scrollTopBtn,
            pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Scroll to top"
        >
          <Text style={styles.scrollTopIcon}>↑</Text>
        </Pressable>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 8, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        onScroll={onListScroll}
        scrollEventThrottle={32}
        renderItem={({ item }) => {
          if (item.type === 'system') {
            return (
              <View style={styles.systemRow}>
                <Text style={styles.systemText}>{item.text}</Text>
              </View>
            );
          }

          const mine = item.authorUid === me?.uid;

          // Dots are outside the bubble so they never overlap the meta line
          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
              {!mine && (
                <Pressable
                  onPress={() => openMenu(item)}
                  hitSlop={8}
                  style={[styles.dotsOutside, { marginRight: 6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Message options"
                >
                  <Text style={styles.dots}>⋯</Text>
                </Pressable>
              )}

              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.msgMeta} numberOfLines={1} ellipsizeMode="tail">
                  {(item.authorName || (mine ? 'You' : 'Friend'))}
                  {' • '}
                  {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.msgText}>{item.text}</Text>
              </View>

              {mine && (
                <Pressable
                  onPress={() => openMenu(item)}
                  hitSlop={8}
                  style={[styles.dotsOutside, { marginLeft: 6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Message options"
                >
                  <Text style={styles.dots}>⋯</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor="#9CA3AF"
          editable
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSendMsg}
          style={[styles.sendBtn, { opacity: canSendMsg ? 1 : 0.5 }]}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
        </Pressable>
      </View>

      {/* Android/others action sheet */}
      <Modal
        visible={!!menuFor && Platform.OS !== 'ios'}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                if (menuFor) handleReport(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={styles.menuText}>Report</Text>
            </Pressable>

            {menuFor && me && menuFor.authorUid === me.uid ? (
              <>
                <View style={styles.menuDivider} />
                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    if (menuFor) handleDelete(menuFor);
                  }}
                >
                  <Text style={[styles.menuText, styles.menuTextDestructive]}>Delete message</Text>
                </Pressable>
              </>
            ) : null}

            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );

  // If onClose is provided, mimic PostComments: add a local backdrop that closes on tap
  if (onClose) {
    return (
      <View style={styles.modalShim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.cardWrap}>{Panel}</View>
      </View>
    );
  }

  // Otherwise just render the panel (as before)
  if (loading) {
    return (
      <View style={[styles.wrap, { maxHeight }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return Panel;
}

const styles = StyleSheet.create({
  // Optional modal-like wrapper (when onClose is passed)
  modalShim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    padding: 16,
  },
  cardWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },

  wrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Slim header
  slimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FCFCFF',
  },
  slimDate: { fontSize: 12, color: '#475569', fontWeight: '700' },

  imInChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#2F6FED',
  },
  imInText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  imInChipDone: { backgroundColor: '#E6FCEB', borderWidth: 1, borderColor: '#A7F3D0' },
  imInTextDone: { color: '#065F46' },

  // Floating scroll-to-top button
  scrollTopBtn: {
    position: 'absolute',
    top: 6,
    alignSelf: 'center',
    zIndex: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scrollTopIcon: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Message rows
  msgRow: { flexDirection: 'row', alignItems: 'flex-start' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: '#EEF2FF', borderColor: '#C7DAFF' },
  bubbleTheirs: { backgroundColor: '#F8FAFC', borderColor: '#E5E7EB' },

  msgMeta: { fontSize: 11, color: '#64748B', marginBottom: 2 },
  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 20 },

  // Dots OUTSIDE the bubble
  dotsOutside: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { fontSize: 16, color: '#64748B' },

  // Centered system line
  systemRow: { alignItems: 'center', paddingVertical: 2, alignSelf: 'center' },
  systemText: { color: '#64748B', fontStyle: 'italic', fontSize: 12 },

  // Composer
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 8,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    color: '#0B1426',
  },
  sendBtn: {
    backgroundColor: '#2F6FED',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontWeight: '800' },

  // Bottom sheet menu (Android/others)
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#fff',
    paddingVertical: 4,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuText: { fontSize: 16, color: '#0B1426', textAlign: 'center' },
  menuTextDestructive: { color: '#DC2626', fontWeight: '700' },
  menuDivider: { height: 1, backgroundColor: '#E5E7EB' },
});