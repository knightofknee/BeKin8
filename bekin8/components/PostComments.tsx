// components/PostComments.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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

export default function PostComments({ post, onClose }: Props) {
  const me = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [postAuthorName, setPostAuthorName] = useState<string>(post.authorUsername);

  useEffect(() => {
    let alive = true;
    resolveMyName(post.authorUid).then((n) => { if (alive) setPostAuthorName(n); }).catch(() => {});
    return () => { alive = false; };
  }, [post.authorUid]);

  const listRef = useRef<FlatList<Comment>>(null);
  const didInitialScrollRef = useRef(false);
  const pendingScrollRef = useRef(false);

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
  }, [comments]);

  const onContentSizeChange = (_w: number, h: number) => {
    setContentHeight(h);
    if (h <= listHeight + 1) setShowScrollTop(false);
  };
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowScrollTop(contentHeight > listHeight + 1 && y > 8);
  };
  const scrollToTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

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

  const commentsOn = post.commentsEnabled !== false;

  return (
    <>
      {/* Full-screen backdrop — tap to close */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{(postAuthorName?.[0] || 'F').toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.headerAuthor} numberOfLines={1}>{postAuthorName}</Text>
              <Text style={styles.headerSub} numberOfLines={1}>{post.content}</Text>
            </View>
          </View>
          <Pressable hitSlop={12} onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {/* Comment thread */}
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
                  <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
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
                          <Text style={styles.dots}>⋯</Text>
                        </Pressable>
                      )}
                      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, deleted && styles.bubbleDeleted]}>
                        <Text style={[styles.msgMeta, deleted && styles.deletedMeta]} numberOfLines={1}>
                          {deleted ? 'Deleted' : (item.authorName || (mine ? 'You' : 'Friend'))}
                          {!deleted && ` · ${item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        </Text>
                        <Text style={[styles.msgText, deleted && styles.deletedText]}>
                          {deleted ? '[deleted]' : item.text}
                        </Text>
                      </View>
                      {mine && !deleted && (
                        <Pressable
                          onPress={() => requestMenu(item)}
                          hitSlop={8}
                          style={[styles.dotsOutside, { marginLeft: 6 }]}
                        >
                          <Text style={styles.dots}>⋯</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                }}
              />
            </>
          )}
        </View>

        {/* Composer or disabled banner */}
        {commentsOn ? (
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Add a comment…"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
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
              style={[styles.sendBtn, { opacity: canSend ? 1 : 0.5 }]}
            >
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.commentsOffBanner}>
            <Text style={styles.commentsOffText}>Comments are turned off</Text>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Android menu sheet */}
      {menuFor && Platform.OS !== 'ios' && (
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            <Pressable style={styles.menuItem} onPress={() => { if (menuFor) doReport(menuFor); }}>
              <Text style={styles.menuText}>Report</Text>
            </Pressable>
            {menuFor && me && menuFor.authorUid === me.uid && (
              <>
                <View style={styles.menuDivider} />
                <Pressable style={styles.menuItem} onPress={() => { if (menuFor) doDelete(menuFor); }}>
                  <Text style={[styles.menuText, styles.menuTextDestructive]}>Delete comment</Text>
                </Pressable>
              </>
            )}
            <View style={styles.menuDivider} />
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
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
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 8 },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#2F6FED', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  headerAuthor: { fontWeight: '800', color: '#0B1426', fontSize: 14 },
  headerSub: { color: '#64748B', fontSize: 12, marginTop: 1 },
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

  commentsOffBanner: {
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
    paddingVertical: 14, alignItems: 'center', backgroundColor: '#FAFBFF',
  },
  commentsOffText: { color: '#9CA3AF', fontSize: 14, fontStyle: 'italic' },

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
