// components/PostComments.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActionSheetIOS,
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
  updateDoc,
} from 'firebase/firestore';

type Post = {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  url?: string;
};

type Comment = {
  id: string;
  text: string;
  createdAt: Date;
  authorUid: string;
  authorName?: string;
  deleted?: boolean;
};

type Props = {
  post: Post;
  onClose: () => void;
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
  return 'Me';
}

export default function PostComments({ post, onClose }: Props) {
  const me = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // overflow menu state (3-dots)
  const [menuFor, setMenuFor] = useState<Comment | null>(null);

  // 🔽 FlatList ref + scroll flags
  const listRef = useRef<FlatList<Comment>>(null);
  const pendingScrollRef = useRef(false);
  const didInitialScrollRef = useRef(false);

  // subscribe to comments (Posts/{postId}/comments) — unchanged
  useEffect(() => {
    const col = collection(db, 'Posts', post.id, 'comments');
    const qy = query(col, orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: Comment[] = [];
        snap.forEach((d) => {
          const data: any = d.data();
          arr.push({
            id: d.id,
            text: String(data?.text || ''),
            authorUid: String(data?.authorUid || ''),
            authorName: String(data?.authorName || ''),
            createdAt: new Date(getMillis(data?.createdAt) || 0),
            deleted: data?.deleted === true,
          });
        });
        setComments(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [post.id]);

  // ✅ Scroll logic:
  // 1) After first load with content, scroll to bottom once.
  // 2) Whenever we have a pending scroll (after sending), scroll on ANY comments update.
  useEffect(() => {
    if (comments.length > 0 && !didInitialScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        didInitialScrollRef.current = true;
      });
      return;
    }
    if (pendingScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
        pendingScrollRef.current = false;
      });
    }
  }, [comments]); // watch the array, not just length

  const canSend = useMemo(() => !!me && text.trim().length > 0 && !sending, [me, text, sending]);

  const handleSend = async () => {
    if (!canSend || !me) return;
    try {
      setSending(true);
      const authorName = await resolveMyName(me.uid);
      await addDoc(collection(db, 'Posts', post.id, 'comments'), {
        text: text.trim(),
        authorUid: me.uid,
        authorName,
        createdAt: serverTimestamp(),
        deleted: false,
      });
      setText('');
      // Ask to scroll when snapshot includes our new row / resolves timestamp
      pendingScrollRef.current = true;
    } finally {
      setSending(false);
    }
  };

  // --- Report & Delete helpers (NEW: doReport, requestMenu supports both) ---
  const doReport = async (comment: Comment) => {
    if (!me) return;
    try {
      await addDoc(collection(db, 'Reports'), {
        targetType: 'comment',
        targetId: comment.id,
        targetOwnerUid: comment.authorUid,
        postId: post.id,
        reporterUid: me.uid,
        createdAt: serverTimestamp(),
        status: 'open',
      });
      Alert.alert('Thanks', 'We received your report.');
    } catch (e: any) {
      Alert.alert('Report failed', e?.message ?? 'Try again.');
    }
  };

  const doDelete = async (comment: Comment) => {
    try {
      // Try hard delete
      await deleteDoc(doc(db, 'Posts', post.id, 'comments', comment.id));
      setMenuFor(null);
      return;
    } catch (e: any) {
      const code = e?.code || '';
      if (code === 'permission-denied') {
        try {
          await updateDoc(doc(db, 'Posts', post.id, 'comments', comment.id), {
            deleted: true,
            text: '[deleted]',
          });
          setMenuFor(null);
          return;
        } catch (e2) {
          // fall through to generic error
        }
      }
      Alert.alert('Delete failed', 'Please try again.');
      setMenuFor(null);
    }
  };

  const requestMenu = (comment: Comment) => {
    if (!me || comment.deleted) return;
    const isMine = comment.authorUid === me.uid;

    if (Platform.OS === 'ios' && ActionSheetIOS) {
      const options: string[] = ['Cancel', 'Report'];
      const actions: Array<() => void> = [() => {}, () => void doReport(comment)];
      let cancelButtonIndex = 0;
      let destructiveButtonIndex: number | undefined = undefined;

      if (isMine) {
        options.push('Delete comment');
        actions.push(() => void doDelete(comment));
        destructiveButtonIndex = options.length - 1;
      }

      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Options', options, cancelButtonIndex, destructiveButtonIndex },
        (idx) => {
          const fn = actions[idx];
          if (fn) fn();
        }
      );
    } else {
      setMenuFor(comment);
    }
  };

  return (
    // Backdrop: tap to close
    <Pressable style={styles.backdrop} onPress={onClose}>
      {/* Card: stop tap propagation */}
      <Pressable onPress={() => {}} style={styles.card}>
        {/* Compact post header */}
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>
              {(post.authorUsername?.[0] || 'F').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.author}>{post.authorUsername}</Text>
            <Text style={styles.meta}>{post.createdAt.toLocaleString()}</Text>
          </View>
          <Pressable hitSlop={10} onPress={onClose}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {/* Post preview (2 lines max) */}
        <Text style={styles.postPreview} numberOfLines={2}>
          {post.content}
        </Text>

        {/* Thread */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.threadWrap}
        >
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              ref={listRef} // 🔗
              data={comments}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const mine = item.authorUid === me?.uid;
                const deleted = item.deleted === true;
                return (
                  <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                        deleted && styles.bubbleDeleted,
                      ]}
                    >
                      <View style={styles.rowTop}>
                        <Text
                          style={[styles.msgMeta, deleted && styles.deletedMeta]}
                          numberOfLines={1}
                        >
                          {deleted
                            ? 'Deleted'
                            : (item.authorName || (mine ? 'You' : 'Friend'))}{' '}
                          {!deleted && (
                            <>• {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                          )}
                        </Text>

                        {/* 3-dots (report for others; delete+report for mine) */}
                        {!deleted ? (
                          <Pressable hitSlop={8} onPress={() => requestMenu(item)} style={styles.dotsBtn}>
                            <Text style={styles.dots}>⋯</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      <Text style={[styles.msgText, deleted && styles.deletedText]}>
                        {deleted ? '[deleted]' : item.text}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* Input */}
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Add a friendly comment"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              multiline
            />
            <Pressable onPress={handleSend} disabled={!canSend} style={[styles.sendBtn, { opacity: canSend ? 1 : 0.5 }]}>
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Pressable>

      {/* ANDROID / CROSS-PLATFORM BOTTOM SHEET FOR 3-DOTS */}
      <Modal
        visible={!!menuFor && Platform.OS !== 'ios'}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            {/* Report always */}
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                if (menuFor) doReport(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={styles.menuText}>Report</Text>
            </Pressable>

            {/* Delete only if mine */}
            {menuFor && me && menuFor.authorUid === me.uid ? (
              <>
                <View style={styles.menuDivider} />
                <Pressable
                  style={[styles.menuItem, styles.menuItemDestructive]}
                  onPress={() => {
                    if (menuFor) doDelete(menuFor);
                    setMenuFor(null);
                  }}
                >
                  <Text style={[styles.menuText, styles.menuTextDestructive]}>Delete comment</Text>
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Backdrop & card
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2F6FED', alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { color: '#fff', fontWeight: '800' },
  author: { fontWeight: '800', color: '#0B1426' },
  meta: { color: '#64748B', fontSize: 12 },
  close: { fontSize: 20, color: '#64748B' },

  postPreview: { color: '#111827', marginBottom: 8 },

  // Thread area
  threadWrap: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    maxHeight: 340,
  },
  loading: { paddingVertical: 16, alignItems: 'center' },

  // Messages
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: '#EEF2FF', borderColor: '#C7DAFF' },
  bubbleTheirs: { backgroundColor: '#F8FAFC', borderColor: '#E5E7EB' },
  bubbleDeleted: { backgroundColor: '#F9FAFB', borderColor: '#F1F5F9' },

  rowTop: { flexDirection: 'row', alignItems: 'center' },
  dotsBtn: { marginLeft: 8, paddingHorizontal: 4, paddingVertical: 2 },
  dots: { fontSize: 18, color: '#64748B' },

  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 20 },
  deletedText: { color: '#94A3B8', fontStyle: 'italic' },
  msgMeta: { fontSize: 11, marginBottom: 2, color: '#64748B', flexShrink: 1 },
  deletedMeta: { color: '#94A3B8' },

  // Input
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    marginTop: 8,
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
  menuItemDestructive: {},
  menuText: { fontSize: 16, color: '#0B1426' },
  menuTextDestructive: { color: '#DC2626', fontWeight: '700' },
  menuDivider: { height: 1, backgroundColor: '#E5E7EB' },
});
