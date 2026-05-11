// components/PostComments.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActionSheetIOS,
  NativeSyntheticEvent,
  NativeScrollEvent,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
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
import { useTheme } from '../providers/ThemeProvider';
import { tap, press, warning } from '../utils/haptics';

type Post = {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  url?: string;
  commentsEnabled?: boolean;
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
  targetCommentId?: string;
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
    const profSnap = await getDoc(doc(db, 'Profiles', uid));
    const prof: any = profSnap.exists() ? profSnap.data() : {};
    const display = typeof prof.displayName === 'string' ? prof.displayName.trim() : '';
    if (display) return display;
    const unameProfile = typeof prof.username === 'string' ? prof.username.trim() : '';
    if (unameProfile) return unameProfile;
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userDoc: any = userSnap.exists() ? userSnap.data() : {};
    const unameUsers = typeof userDoc.username === 'string' ? userDoc.username.trim() : '';
    if (unameUsers) return unameUsers;
    if (auth.currentUser?.uid === uid) {
      const authName = (auth.currentUser.displayName || '').trim();
      if (authName) return authName;
      const emailPrefix = (auth.currentUser.email || '').split('@')[0] || '';
      if (emailPrefix) return emailPrefix;
    }
  } catch {}
  return 'Me';
}

const ACCESSORY_ID = 'postcomments-accessory';

export default function PostComments({ post, onClose, targetCommentId }: Props) {
  const { colors: tc } = useTheme();
  const me = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [postAuthorName, setPostAuthorName] = useState<string>(post.authorUsername);
  const [postAuthorColor, setPostAuthorColor] = useState<string>('#2F6FED');
  const [authorCommentsEnabled, setAuthorCommentsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    resolveMyName(post.authorUid).then((n) => { if (alive) setPostAuthorName(n); }).catch(() => {});
    // Fetch the post author's global comments setting + profile color from their Profile
    getDoc(doc(db, 'Profiles', post.authorUid)).then((snap) => {
      if (!alive) return;
      if (snap.exists()) {
        const data = snap.data() as any;
        setAuthorCommentsEnabled(data.commentsEnabled === true);
        // Fall back to legacy `avatarColor` for older accounts.
        const color = data.profileColor || data.avatarColor;
        if (color) setPostAuthorColor(color);
      } else {
        setAuthorCommentsEnabled(false);
      }
    }).catch(() => { if (alive) setAuthorCommentsEnabled(false); });
    return () => { alive = false; };
  }, [post.authorUid]);

  const listRef = useRef<FlatList<Comment>>(null);
  const didInitialScrollRef = useRef(false);
  const pendingScrollRef = useRef(false);
  const lastScrolledTargetRef = useRef<string | undefined>(undefined);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);

  useEffect(() => {
    const col = collection(db, 'Posts', post.id, 'comments');
    const qy = query(col, orderBy('createdAt', 'asc'), limit(300));
    const unsub = onSnapshot(qy, (snap) => {
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
    }, () => setLoading(false));
    return () => unsub();
  }, [post.id]);

  // Initial scroll on load (to targetCommentId or end), and re-scroll if a follow-up
  // notification changes targetCommentId while the modal is already open.
  useEffect(() => {
    if (comments.length === 0) return;

    if (!didInitialScrollRef.current) {
      const targetIdx = targetCommentId
        ? comments.findIndex((c) => c.id === targetCommentId)
        : -1;
      requestAnimationFrame(() => {
        if (targetIdx >= 0) {
          listRef.current?.scrollToIndex({ index: targetIdx, animated: false, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetCommentId;
        } else {
          listRef.current?.scrollToEnd({ animated: false });
        }
        didInitialScrollRef.current = true;
      });
      return;
    }

    if (targetCommentId && targetCommentId !== lastScrolledTargetRef.current) {
      const idx = comments.findIndex((c) => c.id === targetCommentId);
      if (idx >= 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetCommentId;
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
  }, [comments, targetCommentId]);

  const onContentSizeChange = (_w: number, h: number) => {
    setContentHeight(h);
    if (h <= listHeight + 1) setShowScrollTop(false);
  };
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop(contentHeight > listHeight + 1 && y > 8);
  };
  const scrollToTop = () => { tap(); listRef.current?.scrollToOffset({ offset: 0, animated: true }); };

  const canSend = useMemo(() => !!me && text.trim().length > 0 && !sending, [me, text, sending]);

  const handleSend = async () => {
    press();
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
      pendingScrollRef.current = true;
    } finally {
      setSending(false);
    }
  };

  const doReport = (comment: Comment) => {
    setMenuFor(null);
    Alert.alert('Report comment?', 'Are you sure you want to report this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report', style: 'destructive',
        onPress: async () => {
          warning();
          if (!me) return;
          try {
            await addDoc(collection(db, 'Reports'), {
              targetType: 'comment',
              targetId: comment.id,
              targetOwnerUid: comment.authorUid,
              targetOwnerName: comment.authorName || null,
              postId: post.id,
              reporterUid: me.uid,
              createdAt: serverTimestamp(),
              status: 'open',
              snippet: String(comment.text || '').slice(0, 300),
            });
            Alert.alert('Thanks', 'We received your report.');
          } catch (e: any) {
            Alert.alert('Report failed', e?.message ?? 'Try again.');
          }
        },
      },
    ]);
  };

  const doDelete = (comment: Comment) => {
    setMenuFor(null);
    Alert.alert('Delete comment?', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          warning();
          try {
            await deleteDoc(doc(db, 'Posts', post.id, 'comments', comment.id));
          } catch (e: any) {
            if (e?.code === 'permission-denied') {
              try {
                await updateDoc(doc(db, 'Posts', post.id, 'comments', comment.id), {
                  deleted: true, text: '[deleted]',
                });
                return;
              } catch {}
            }
            Alert.alert('Delete failed', 'Please try again.');
          }
        },
      },
    ]);
  };

  const requestMenu = (comment: Comment) => {
    if (!me || comment.deleted) return;
    const isMine = comment.authorUid === me.uid;
    if (Platform.OS === 'ios' && ActionSheetIOS) {
      const options = ['Cancel', 'Report'];
      const actions: Array<() => void> = [() => {}, () => doReport(comment)];
      let destructiveButtonIndex: number | undefined;
      if (isMine) {
        options.push('Delete comment');
        actions.push(() => doDelete(comment));
        destructiveButtonIndex = options.length - 1;
      }
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Options', options, cancelButtonIndex: 0, destructiveButtonIndex },
        (idx) => actions[idx]?.()
      );
    } else {
      setMenuFor(comment);
    }
  };

  // Keyboard handling is owned by the parent modal wrapper via KeyboardAvoidingView
  // (see app/feed.tsx and app/profile/[username].tsx where this modal is rendered).
  // Translating the panel here pushed the header off-screen — instead, the parent
  // shrinks the card from the bottom so the header stays pinned and the composer
  // sits just above the keyboard.

  // Comments are on only if: per-post flag is enabled AND author's global setting allows comments
  // authorCommentsEnabled=null means still loading — show composer optimistically if per-post is enabled
  const commentsOn = post.commentsEnabled !== false && (authorCommentsEnabled === null || authorCommentsEnabled === true);

  return (
    <>
      {/* Full-screen backdrop — tap outside card to close */}
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: tc.backdrop }]} onPress={onClose} />

      {/* Floating card — centered; KeyboardAvoidingView shrinks available space
          when the composer is focused so the card sits above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.cardOuter}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <View style={[styles.card, { backgroundColor: tc.card, borderColor: tc.border }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.avatar, { backgroundColor: postAuthorColor }]}>
              <Text style={styles.avatarTxt}>{(postAuthorName?.[0] || 'F').toUpperCase()}</Text>
            </View>
            <View>
              <Text style={[styles.headerAuthor, { color: tc.text }]} numberOfLines={1}>{postAuthorName}</Text>
            </View>
          </View>
          <Pressable hitSlop={12} onPress={() => { tap(); onClose(); }} style={styles.closeBtn}>
            <Text style={[styles.closeIcon, { color: tc.subtle }]}>✕</Text>
          </Pressable>
        </View>

        {/* Comment thread — hidden entirely when comments are off */}
        {commentsOn ? (
          <>
            <View
              style={styles.listArea}
              onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
            >
              {loading ? (
                <View style={styles.loading}><ActivityIndicator /></View>
              ) : (
                <>
                  {showScrollTop && (
                    <Pressable
                      onPress={scrollToTop}
                      hitSlop={10}
                      style={({ pressed }) => [styles.scrollTopBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Text style={styles.scrollTopIcon}>↑</Text>
                    </Pressable>
                  )}
                  {comments.length === 0 && (
                    <View style={styles.emptyWrap}>
                      <Text style={[styles.emptyText, { color: tc.subtle }]}>No comments yet. Be the first!</Text>
                    </View>
                  )}
                  <FlatList
                    ref={listRef}
                    data={comments}
                    keyExtractor={(c) => c.id}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 8 }}
                    keyboardShouldPersistTaps="handled"
                    scrollEventThrottle={32}
                    onScroll={onListScroll}
                    onContentSizeChange={onContentSizeChange}
                    onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
                    onScrollToIndexFailed={(info) => {
                      const offset = info.averageItemLength * info.index;
                      listRef.current?.scrollToOffset({ offset, animated: false });
                      setTimeout(() => {
                        listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.3 });
                      }, 100);
                    }}
                    renderItem={({ item }) => {
                      const mine = item.authorUid === me?.uid;
                      const deleted = item.deleted === true;
                      return (
                        <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
                          {!mine && (
                            <Pressable
                              onPress={() => requestMenu(item)}
                              hitSlop={8}
                              style={[styles.dotsOutside, { marginRight: 6 }]}
                            >
                              <Text style={[styles.dots, { color: tc.subtle }]}>⋯</Text>
                            </Pressable>
                          )}
                          <View style={[styles.bubble, mine ? [styles.bubbleMine, { backgroundColor: tc.bubbleMine, borderColor: tc.bubbleMineBorder }] : [styles.bubbleTheirs, { backgroundColor: tc.bubbleTheirs, borderColor: tc.bubbleTheirsBorder }], deleted && styles.bubbleDeleted]}>
                            <Text style={[styles.msgMeta, { color: tc.subtle }, deleted && styles.deletedMeta]} numberOfLines={1}>
                              {deleted ? 'Deleted' : (item.authorName || (mine ? 'You' : 'Friend'))}
                              {!deleted && (() => {
                                const d = item.createdAt;
                                const now = new Date();
                                const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
                                const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                return ' · ' + (isToday ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + time);
                              })()}
                            </Text>
                            <Text selectable style={[styles.msgText, { color: tc.text }, deleted && styles.deletedText]}>
                              {deleted ? '[deleted]' : item.text}
                            </Text>
                          </View>
                          {mine && !deleted && (
                            <Pressable
                              onPress={() => requestMenu(item)}
                              hitSlop={8}
                              style={[styles.dotsOutside, { marginLeft: 6 }]}
                            >
                              <Text style={[styles.dots, { color: tc.subtle }]}>⋯</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    }}
                  />
                </>
              )}
            </View>

            {/* Composer */}
            <View style={[styles.inputRow, { borderTopColor: tc.border, backgroundColor: tc.headerBg }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Add a comment…"
                placeholderTextColor={tc.subtle}
                style={[styles.input, { borderColor: tc.border, backgroundColor: tc.inputBg, color: tc.text }]}
                multiline
                inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
                blurOnSubmit={false}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                onFocus={() => listRef.current?.scrollToEnd({ animated: true })}
              />
              <Pressable
                onPress={handleSend}
                disabled={!canSend}
                style={[styles.sendBtn, { opacity: canSend ? 1 : 0.5, backgroundColor: tc.primary }]}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          /* Comments are off — hide thread, show banner only */
          <View style={styles.commentsOffWrap}>
            <Text style={styles.commentsOffIcon}>💬</Text>
            <Text style={[styles.commentsOffText, { color: tc.subtle }]}>Comments are turned off</Text>
          </View>
        )}
        </View>{/* end card */}
      </KeyboardAvoidingView>{/* end cardOuter */}

      {/* Android menu sheet */}
      {menuFor && Platform.OS !== 'ios' && (
        <Pressable style={[styles.menuBackdrop, { backgroundColor: tc.backdrop }]} onPress={() => setMenuFor(null)}>
          <View style={[styles.menuSheet, { backgroundColor: tc.card }]}>
            <Pressable style={styles.menuItem} onPress={() => { if (menuFor) doReport(menuFor); }}>
              <Text style={[styles.menuText, { color: tc.text }]}>Report</Text>
            </Pressable>
            {menuFor && me && menuFor.authorUid === me.uid && (
              <>
                <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
                <Pressable style={styles.menuItem} onPress={() => { if (menuFor) doDelete(menuFor); }}>
                  <Text style={[styles.menuText, styles.menuTextDestructive, { color: tc.danger }]}>Delete comment</Text>
                </Pressable>
              </>
            )}
            <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={[styles.menuText, { color: tc.text }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
          <View style={[styles.iosAccessory, { borderTopColor: tc.border, backgroundColor: tc.card }]}>
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.iosDoneBtn}>
              <Text style={[styles.iosDoneText, { color: tc.text }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  cardOuter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    // Card flexes naturally up to ~480px tall in normal use, but is allowed to
    // shrink when the keyboard takes vertical space (via KeyboardAvoidingView
    // padding). Without flex:1 the fixed height punches through and the
    // composer ends up under the keyboard.
    flex: 1,
    maxHeight: 480,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 8 },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#2F6FED', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  headerAuthor: { fontWeight: '800', color: '#0B1426', fontSize: 14 },
  closeBtn: { paddingHorizontal: 4 },
  closeIcon: { fontSize: 18, color: '#64748B' },

  listArea: { flex: 1, position: 'relative' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  emptyText: { color: '#9CA3AF', fontSize: 14 },

  scrollTopBtn: {
    position: 'absolute', top: 8, alignSelf: 'center', zIndex: 5,
    backgroundColor: 'rgba(15,23,42,0.65)', borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  scrollTopIcon: { color: '#fff', fontWeight: '800', fontSize: 14 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-start' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  dotsOutside: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  dots: { fontSize: 16, color: '#64748B' },

  bubble: {
    maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 16, borderWidth: 1,
  },
  bubbleMine: { backgroundColor: '#EEF2FF', borderColor: '#D4DEFF' },
  bubbleTheirs: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' },
  bubbleDeleted: { backgroundColor: '#F9FAFB', borderColor: '#F1F5F9' },

  msgMeta: { fontSize: 11, color: '#94A3B8', marginBottom: 3, fontWeight: '500' },
  deletedMeta: { color: '#CBD5E1' },
  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 21 },
  deletedText: { color: '#94A3B8', fontStyle: 'italic' },

  inputRow: {
    flexDirection: 'row', gap: 8,
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
    padding: 10, backgroundColor: '#FAFBFF',
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100,
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    textAlignVertical: 'top', color: '#0B1426',
    backgroundColor: '#FFFFFF', fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#2F6FED', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  commentsOffWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 32, gap: 10,
  },
  commentsOffIcon: { fontSize: 36 },
  commentsOffText: { color: '#9CA3AF', fontSize: 15, fontStyle: 'italic' },

  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#fff', paddingVertical: 4,
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuText: { fontSize: 16, color: '#0B1426', textAlign: 'center' },
  menuTextDestructive: { color: '#DC2626', fontWeight: '700' },
  menuDivider: { height: 1, backgroundColor: '#E5E7EB' },

  iosAccessory: {
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6,
  },
  iosDoneBtn: {
    alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.08)',
  },
  iosDoneText: { fontWeight: '700', color: '#0B1426' },
});
