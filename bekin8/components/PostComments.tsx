// components/PostComments.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActionSheetIOS,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  KeyboardAvoidingView,
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
    // Prefer editable display name stored in Profiles
    const profSnap = await getDoc(doc(db, 'Profiles', uid));
    const prof: any = profSnap.exists() ? profSnap.data() : {};
    const display = typeof prof.displayName === 'string' ? prof.displayName.trim() : '';
    if (display) return display;

    // Fallbacks to usernames (no case mangling)
    const unameProfile = typeof prof.username === 'string' ? prof.username.trim() : '';
    if (unameProfile) return unameProfile;

    const userSnap = await getDoc(doc(db, 'users', uid));
    const userDoc: any = userSnap.exists() ? userSnap.data() : {};
    const unameUsers = typeof userDoc.username === 'string' ? userDoc.username.trim() : '';
    if (unameUsers) return unameUsers;

    // Local-only fallbacks if resolving self
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
const IOS_ACCESSORY_HEIGHT = 56;

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
    (async () => {
      try {
        const name = await resolveMyName(post.authorUid);
        if (alive) setPostAuthorName(name);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [post.authorUid]);

  const listRef = useRef<FlatList<Comment>>(null);
  const didInitialScrollRef = useRef(false);
  const pendingScrollRef = useRef(false);

  const ensureInitialScroll = useCallback(() => {
    if (!didInitialScrollRef.current && comments.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
        didInitialScrollRef.current = true;
      });
    }
  }, [comments.length]);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);

  useEffect(() => {
    const col = collection(db, 'Posts', post.id, 'comments');
    const qy = query(col, orderBy('createdAt', 'asc'), limit(300));
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

  useEffect(() => {
    ensureInitialScroll();
    if (pendingScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
        pendingScrollRef.current = false;
      });
    }
  }, [comments, ensureInitialScroll]);

  const onListLayout = (e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height);
  const onContentSizeChange = (_w: number, h: number) => {
    setContentHeight(h);
    const canScroll = h > listHeight + 1;
    if (!canScroll) setShowScrollTop(false);
  };
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const canScroll = contentHeight > listHeight + 1;
    setShowScrollTop(canScroll && y > 8);
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
        } catch {}
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
    <>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Center container STAYS centered; KAV moves the CARD only */}
        <View style={styles.centerWrap} pointerEvents="box-none">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'position' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_ACCESSORY_HEIGHT : 0}
            style={styles.kav}
          >
            <View style={styles.card} pointerEvents="box-none">
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>
                    {(postAuthorName?.[0] || 'F').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.author}>{postAuthorName}</Text>
                  <Text style={styles.meta}>{post.createdAt.toLocaleString()}</Text>
                </View>
                <Pressable hitSlop={10} onPress={onClose}>
                  <Text style={styles.close}>✕</Text>
                </Pressable>
              </View>

              {/* Post preview */}
              <Text style={styles.postPreview} numberOfLines={2}>
                {post.content}
              </Text>

              {/* Thread */}
              <View style={styles.threadWrap}>
                {loading ? (
                  <View style={styles.loading}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <>
                    {showScrollTop && (
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
                      onLayout={onListLayout}
                      style={{ flex: 1 }}
                      data={comments}
                      keyExtractor={(c) => c.id}
                      contentContainerStyle={{ paddingVertical: 8, gap: 8, paddingBottom: 8 }}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator
                      onContentSizeChange={onContentSizeChange}
                      onScroll={onListScroll}
                      scrollEventThrottle={32}
                      removeClippedSubviews={false}
                      initialNumToRender={25}
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
                                <Text style={[styles.msgMeta, deleted && styles.deletedMeta]} numberOfLines={1}>
                                  {deleted ? 'Deleted' : (item.authorName || (mine ? 'You' : 'Friend'))}{' '}
                                  {!deleted && (
                                    <>• {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                                  )}
                                </Text>

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
                  </>
                )}

                {/* Composer */}
                <View style={styles.inputRow}>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder="Add a friendly comment"
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
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>

      {/* Android / cross-platform sheet */}
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
                if (menuFor) doReport(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={styles.menuText}>Report</Text>
            </Pressable>

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

      {/* iOS Done bar */}
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },

  // Center the card when keyboard is hidden; no bottom padding so it can be flush when lifted
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  kav: {
    width: '100%'
  },

  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2F6FED', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontWeight: '800' },
  author: { fontWeight: '800', color: '#0B1426' },
  meta: { color: '#64748B', fontSize: 12 },
  close: { fontSize: 20, color: '#64748B' },

  postPreview: { color: '#111827', marginBottom: 8 },

  threadWrap: { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 8, height: 420 },
  loading: { paddingVertical: 16, alignItems: 'center' },

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

  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1 },
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

  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: '#fff', paddingVertical: 4, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuItemDestructive: {},
  menuText: { fontSize: 16, color: '#0B1426', textAlign: 'center' },
  menuTextDestructive: { color: '#DC2626', fontWeight: '700' },
  menuDivider: { height: 1, backgroundColor: '#E5E7EB' },

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
});