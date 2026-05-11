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
} from 'react-native';
import { auth, db } from '../firebase.config';
import { SCREEN_PAD } from './ui/layout';
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
import { useTheme } from '../providers/ThemeProvider';
import { tap, press, warning } from '../utils/haptics';

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
  targetMessageId?: string;
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

export default function ChatRoom({ beaconId, maxHeight, onClose, style, targetMessageId }: ChatRoomProps) {
  const { colors: tc } = useTheme();
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);

  const [startLabel, setStartLabel] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');
  const [beaconMessage, setBeaconMessage] = useState<string>('');
  const [msgExpanded, setMsgExpanded] = useState(false);
  const [msgTruncated, setMsgTruncated] = useState(false);
  const expiresAtRef = useRef<number | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pendingScrollRef = useRef(false);
  const didInitialScrollRef = useRef(false);
  const lastScrolledTargetRef = useRef<string | undefined>(undefined);

  // Scroll-to-top arrow (only when list is scrollable and user has scrolled down)
  const [listViewportH, setListViewportH] = useState(0);
  const [listContentH, setListContentH] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  const isListScrollable = listContentH > listViewportH + 24;
  const hasRealMessages = useMemo(() => messages.some((m) => m.type !== 'system'), [messages]);

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollY(e.nativeEvent.contentOffset.y);
  };

  const scrollToTop = () => {
    tap();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // Reset per-room scroll state so it doesn't carry over between different beacons
  useEffect(() => {
    setScrollY(0);
    setListViewportH(0);
    setListContentH(0);
    pendingScrollRef.current = false;
    didInitialScrollRef.current = false;
    lastScrolledTargetRef.current = undefined;
  }, [beaconId]);

  // Keyboard handling is owned by the parent modal via KeyboardAvoidingView
  // (see app/home.tsx beacon-details modal). Translating the panel here would
  // push the header off the top of the modal — instead, the parent shrinks the
  // panel's available space so the header stays pinned, the list shrinks, and
  // the composer sits just above the keyboard.

  // ---- Data subscriptions ----
  useEffect(() => {
    const ref = doc(db, 'Beacons', beaconId);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          expiresAtRef.current = null;
          setStartLabel('');
          setOwnerName('');
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

        // Capture beacon message
        const msg = typeof data?.message === 'string' ? data.message.trim() : '';
        setBeaconMessage(msg);

        // Resolve owner display name
        const oUid = data?.ownerUid;
        if (typeof oUid === 'string' && oUid) {
          try {
            const profSnap = await getDoc(doc(db, 'Profiles', oUid));
            const prof = profSnap.exists() ? (profSnap.data() as any) : {};
            const dn = (prof.displayName || prof.username || '').toString().trim();
            setOwnerName(dn || data?.ownerName || '');
          } catch {
            setOwnerName(data?.ownerName || '');
          }
        } else {
          setOwnerName(data?.ownerName || '');
        }
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [beaconId]);

  useEffect(() => {
    setMessagesLoaded(false);
    const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
    const q = query(col, orderBy('createdAt', 'asc'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
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
        setMessagesLoaded(true);
      },
      () => setMessagesLoaded(true)
    );

    return () => unsub();
  }, [beaconId]);

  // Scroll-to-bottom on first load, OR to targetMessageId (initial or when it changes
  // to a new value after a follow-up notification arrives while the modal is open).
  useEffect(() => {
    if (messages.length === 0) return;

    // Initial scroll: to target if provided, otherwise to end.
    if (!didInitialScrollRef.current) {
      const targetIdx = targetMessageId
        ? messages.findIndex((m) => m.id === targetMessageId)
        : -1;
      requestAnimationFrame(() => {
        if (targetIdx >= 0) {
          listRef.current?.scrollToIndex({ index: targetIdx, animated: false, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetMessageId;
        } else {
          listRef.current?.scrollToEnd({ animated: false });
        }
        didInitialScrollRef.current = true;
      });
      return;
    }

    // Subsequent scroll-to-target: a follow-up notification arrived, targetMessageId changed.
    if (targetMessageId && targetMessageId !== lastScrolledTargetRef.current) {
      const idx = messages.findIndex((m) => m.id === targetMessageId);
      if (idx >= 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetMessageId;
        });
        return;
      }
    }

    if (pendingScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
        pendingScrollRef.current = false;
      });
    }
  }, [messages, targetMessageId]);

  const iAmIn = useMemo(() => {
    if (!me) return false;
    return messages.some((m) => m.type === 'system' && m.subtype === 'im-in' && m.actorUid === me.uid);
  }, [messages, me]);

  const canSendMsg = useMemo(() => !!me && text.trim().length > 0 && !sending, [me, text, sending]);

  const handleSend = async () => {
    press();
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

  const handleReport = (msg: ChatMessage) => {
    setMenuFor(null);
    Alert.alert(
      'Report message?',
      'Are you sure you want to report this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
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
          },
        },
      ]
    );
  };

  const handleDelete = (msg: ChatMessage) => {
    setMenuFor(null);
    Alert.alert(
      'Delete message?',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            warning();
            const uid = auth.currentUser?.uid;
            if (!uid || msg.authorUid !== uid) return;
            try {
              await deleteDoc(doc(db, 'Beacons', beaconId, 'ChatMessages', msg.id));
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };


  const ComposerRow = (
    <View style={[styles.inputRow, { borderTopColor: tc.border, backgroundColor: tc.headerBg }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={tc.subtle}
        editable
        style={[styles.input, { borderColor: tc.border, backgroundColor: tc.inputBg, color: tc.text }]}
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
        style={[styles.sendBtn, { opacity: canSendMsg ? 1 : 0.5, backgroundColor: tc.primary }]}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
      </Pressable>
    </View>
  );

  const PanelBody = (
    <>
      <View style={[styles.slimHeader, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: tc.text }]} numberOfLines={1} ellipsizeMode="tail">
            {ownerName ? `Beacon from ${ownerName}` : 'Beacon'}
          </Text>
          {!!startLabel && <Text style={[styles.headerDate, { color: tc.subtle }]}>{startLabel}</Text>}
        </View>

        {iAmIn ? (
          <View style={[styles.imInChip, styles.imInChipDone]}>
            <Text style={[styles.imInText, styles.imInTextDone]}>✓ I'm in</Text>
          </View>
        ) : (
          <Pressable
            onPress={handleImIn}
            style={({ pressed }) => [styles.imInChip, { backgroundColor: tc.primary }, pressed && { opacity: 0.9 }]}
            hitSlop={8}
          >
            <Text style={styles.imInText}>I'm in</Text>
          </Pressable>
        )}
      </View>

      {!!beaconMessage && (
        <View style={[styles.beaconMsgSection, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
          <Text
            style={[styles.beaconMsgText, { color: tc.subtle }]}
            numberOfLines={msgExpanded ? undefined : 5}
            onTextLayout={(e) => {
              if (!msgExpanded && e.nativeEvent.lines.length > 5) {
                setMsgTruncated(true);
              }
            }}
          >
            {beaconMessage}
          </Text>
          {(msgTruncated || msgExpanded) && (
            <Pressable onPress={() => setMsgExpanded((v) => !v)} hitSlop={6}>
              <Text style={[styles.beaconMsgToggle, { color: tc.primary }]}>{msgExpanded ? 'See less' : 'See more'}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View
        style={styles.listArea}
        onLayout={(e) => setListViewportH(e.nativeEvent.layout.height)}
      >
        {hasRealMessages && isListScrollable && scrollY > 24 && (
          <Pressable
            onPress={scrollToTop}
            hitSlop={10}
            style={({ pressed }) => [
              styles.scrollTopBtn,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Jump to top"
          >
            <Text style={styles.scrollTopIcon}>↑</Text>
          </Pressable>
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={
            messages.length === 0
              ? { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }
              : { padding: 6, gap: 6, paddingBottom: 6 }
          }
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          onScroll={onListScroll}
          onContentSizeChange={(_w, h) => setListContentH(h)}
          onScrollToIndexFailed={(info) => {
            const offset = info.averageItemLength * info.index;
            listRef.current?.scrollToOffset({ offset, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.3 });
            }, 100);
          }}
          style={{ flex: 1 }}
          ListEmptyComponent={
            !messagesLoaded ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: tc.subtle, fontSize: 13 }}>No messages yet</Text>
            )
          }
          renderItem={({ item }) => {
            if (item.type === 'system') {
              return (
                <View style={[styles.systemRow, { backgroundColor: tc.inputBg }]}>
                  <Text style={[styles.systemText, { color: tc.subtle }]}>{item.text}</Text>
                </View>
              );
            }

            const mine = item.authorUid === me?.uid;

            return (
              <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
                <View style={[styles.bubble, mine ? [styles.bubbleMine, { backgroundColor: tc.bubbleMine, borderColor: tc.bubbleMineBorder }] : [styles.bubbleTheirs, { backgroundColor: tc.bubbleTheirs, borderColor: tc.bubbleTheirsBorder }]]}>
                  <View style={styles.metaRow}>
                    <Text style={[styles.msgMeta, { color: tc.subtle }]} numberOfLines={1} ellipsizeMode="tail">
                      {(item.authorName || (mine ? 'You' : 'Friend'))}
                      {' • '}
                      {(() => {
                        const d = item.createdAt;
                        const now = new Date();
                        const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
                        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        if (isToday) return time;
                        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + time;
                      })()}
                    </Text>
                    <Pressable
                      onPress={() => openMenu(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Message options"
                    >
                      <Text style={[styles.dotsInline, { color: tc.subtle }]}>⋯</Text>
                    </Pressable>
                  </View>
                  <Text selectable style={[styles.msgText, { color: tc.text }]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />
      </View>

      {ComposerRow}

      <Modal
        visible={!!menuFor && Platform.OS !== 'ios'}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={[styles.menuBackdrop, { backgroundColor: tc.backdrop }]} onPress={() => setMenuFor(null)}>
          <View style={[styles.menuSheet, { backgroundColor: tc.card }]}>
            <Pressable
              style={styles.menuItem}
              onPress={() => { if (menuFor) handleReport(menuFor); }}
            >
              <Text style={[styles.menuText, { color: tc.text }]}>Report</Text>
            </Pressable>

            {menuFor && me && menuFor.authorUid === me.uid ? (
              <>
                <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { if (menuFor) handleDelete(menuFor); }}
                >
                  <Text style={[styles.menuText, styles.menuTextDestructive, { color: tc.danger }]}>Delete message</Text>
                </Pressable>
              </>
            ) : null}

            <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={[styles.menuText, { color: tc.text }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );

  // ----- Render (apply only-overlap lift) -----

  const DoneAccessory = Platform.OS === 'ios' ? (
    <InputAccessoryView nativeID={CHAT_ACCESSORY_ID}>
      <View style={[styles.iosAccessory, { borderTopColor: tc.border, backgroundColor: tc.card }]}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.iosDoneBtn}>
          <Text style={[styles.iosDoneText, { color: tc.text }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  ) : null;

  if (onClose) {
    return (
      <>
        <View style={[styles.modalShim, { backgroundColor: tc.backdrop }]}>
          {/* Backdrop tap closes */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

          <View style={[styles.cardWrap, { backgroundColor: tc.card }]}>
            <View style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}>{PanelBody}</View>
          </View>
        </View>
        {DoneAccessory}
      </>
    );
  }

  if (loading) {
    return (
      <View style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <View
        style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}
      >
        {PanelBody}
      </View>
      {DoneAccessory}
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
    padding: SCREEN_PAD,
  },
  cardWrap: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  wrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },

  slimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
  },
  headerLeft: {
    flex: 1,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B1426',
  },
  headerDate: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },

  imInChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#2F6FED',
  },
  imInText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  imInChipDone: { backgroundColor: '#E6FCEB', borderWidth: 1, borderColor: '#A7F3D0' },
  imInTextDone: { color: '#065F46' },

  beaconMsgSection: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
  },
  beaconMsgText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  beaconMsgToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2F6FED',
    marginTop: 4,
  },

  listArea: {
    flex: 1,
    position: 'relative',
  },
  scrollTopBtn: {
    position: 'absolute',
    top: 10,
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
    maxWidth: '90%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: '#EEF2FF', borderColor: '#D4DEFF' },
  bubbleTheirs: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' },

  msgMeta: { fontSize: 11, color: '#94A3B8', marginBottom: 3, fontWeight: '500' },
  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 21 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dotsInline: { fontSize: 14, color: '#94A3B8', paddingLeft: 4 },

  systemRow: {
    alignItems: 'center',
    paddingVertical: 4,
    alignSelf: 'center',
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  systemText: { color: '#475569', fontWeight: '600', fontSize: 12 },

  inputRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 8,
    backgroundColor: '#FAFBFF',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    color: '#0B1426',
    backgroundColor: '#FFFFFF',
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#2F6FED',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

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