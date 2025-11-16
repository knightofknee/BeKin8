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
  Platform,
  Alert,
  Modal,
  ActionSheetIOS,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleProp,
  ViewStyle,
  Keyboard,
  InputAccessoryView,
  Dimensions,
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
  maxHeight?: number;
  onClose?: () => void;
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
  // Prefer Profiles.displayName (editable), then username, then auth/displayName, then email prefix.
  try {
    const profSnap = await getDoc(doc(db, 'Profiles', uid));
    const prof = profSnap.exists() ? (profSnap.data() as any) : {};
    const display = typeof prof.displayName === 'string' ? prof.displayName.trim() : '';
    if (display.length > 0) return display;

    // Fallbacks for username
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userDoc = userSnap.exists() ? (userSnap.data() as any) : {};
    const unameProfiles = typeof prof.username === 'string' ? prof.username.trim() : '';
    const unameUsers    = typeof userDoc.username === 'string' ? userDoc.username.trim() : '';
    if (unameUsers) return unameUsers;
    if (unameProfiles) return unameProfiles;

    const authName = (auth.currentUser?.displayName || '').toString().trim();
    if (authName) return authName;

    const emailPrefix = (auth.currentUser?.email || '').split('@')[0] || '';
    if (emailPrefix) return emailPrefix;
  } catch {
    // ignore and continue to final fallback
  }
  return 'Me';
}

const CHAT_ACCESSORY_ID = 'chatroom-accessory';

export default function ChatRoom({ beaconId, maxHeight = 420, onClose, style }: ChatRoomProps) {
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);

  const [startLabel, setStartLabel] = useState<string>('');
  const expiresAtRef = useRef<number | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pendingScrollRef = useRef(false);
  const didInitialScrollRef = useRef(false);

  const [canScrollUp, setCanScrollUp] = useState(false);

  // ---- Only-lift-by-overlap logic (iOS) ----
  const containerRef = useRef<View>(null);
  const lastKbTopRef = useRef<number | null>(null); // screenY of keyboard top
  const [lift, setLift] = useState(0);

  const recalcLift = (kbTop?: number | null) => {
    if (Platform.OS !== 'ios') return;
    if (typeof kbTop === 'number') lastKbTopRef.current = kbTop;
    requestAnimationFrame(() => {
      containerRef.current?.measureInWindow((_x, y, _w, h) => {
        const panelBottom = y + h;
        const keyboardTop =
          typeof (kbTop ?? lastKbTopRef.current) === 'number'
            ? (kbTop ?? lastKbTopRef.current)!
            : Dimensions.get('window').height;
        const overlap = panelBottom - keyboardTop; // positive if covered
        setLift(overlap > 0 ? overlap : 0);
      });
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const onWillShow = (e: any) => recalcLift(e?.endCoordinates?.screenY ?? null);
    const onWillChange = (e: any) => recalcLift(e?.endCoordinates?.screenY ?? null);
    const onWillHide = () => {
      lastKbTopRef.current = null;
      setLift(0);
    };
    const s1 = Keyboard.addListener('keyboardWillShow', onWillShow);
    const s2 = Keyboard.addListener('keyboardWillChangeFrame', onWillChange);
    const s3 = Keyboard.addListener('keyboardWillHide', onWillHide);
    return () => {
      s1.remove();
      s2.remove();
      s3.remove();
    };
  }, []);

  // Recompute after layout changes too
  const onContainerLayout = () => recalcLift(null);

  // ---- Data subscriptions ----
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

  // Scroll-to-bottom behaviors
  useEffect(() => {
    if (messages.length > 0 && !didInitialScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        didInitialScrollRef.current = true;
        setCanScrollUp(true);
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

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setCanScrollUp(y > 8);
  };

  const scrollToTop = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const ComposerRow = (
    <View style={styles.inputRow}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor="#9CA3AF"
        editable
        style={styles.input}
        multiline
        onFocus={() => listRef.current?.scrollToEnd({ animated: true })}
        inputAccessoryViewID={Platform.OS === 'ios' ? CHAT_ACCESSORY_ID : undefined}
        blurOnSubmit={false}
        returnKeyType="send"
        onSubmitEditing={handleSend}
      />
      <Pressable
        onPress={handleSend}
        disabled={!canSendMsg}
        style={[styles.sendBtn, { opacity: canSendMsg ? 1 : 0.5 }]}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
      </Pressable>
    </View>
  );

  const PanelBody = (
    <>
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
        contentContainerStyle={{ padding: 8, gap: 8, paddingBottom: 8 }}
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

      {ComposerRow}

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
    </>
  );

  // ----- Render (apply only-overlap lift) -----
  const translated = Platform.OS === 'ios' && lift > 0 ? { transform: [{ translateY: -lift }] } : null;

  if (onClose) {
    return (
      <>
        <View style={styles.modalShim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View ref={containerRef} onLayout={onContainerLayout} style={[styles.cardWrap, translated]}>
            <View style={[styles.wrap, { maxHeight }, style]}>{PanelBody}</View>
          </View>
        </View>

        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={CHAT_ACCESSORY_ID}>
            <View style={styles.iosAccessory}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.iosDoneBtn}>
                <Text style={styles.iosDoneText}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        )}
      </>
    );
  }

  if (loading) {
    return (
      <View style={[styles.wrap, { maxHeight }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <View
        ref={containerRef}
        onLayout={onContainerLayout}
        style={[styles.wrap, { maxHeight }, style, translated]}
      >
        {PanelBody}
      </View>

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={CHAT_ACCESSORY_ID}>
          <View style={styles.iosAccessory}>
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.iosDoneBtn}>
              <Text style={styles.iosDoneText}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // iOS input accessory
  iosAccessory: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  iosDoneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(15,23,42,0.08)',
  },
  iosDoneText: { fontWeight: '700', color: '#0B1426' },

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

  dotsOutside: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { fontSize: 16, color: '#64748B' },

  systemRow: { alignItems: 'center', paddingVertical: 2, alignSelf: 'center' },
  systemText: { color: '#64748B', fontStyle: 'italic', fontSize: 12 },

  inputRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 8,
    backgroundColor: '#fff',
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