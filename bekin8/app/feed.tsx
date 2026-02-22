// app/feed.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Button,
  Pressable,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebase.config';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  DocumentSnapshot,
} from 'firebase/firestore';
import { useRouter } from 'expo-router';
import BottomBar from '../components/BottomBar';
import { SafeAreaView } from 'react-native-safe-area-context';
import PostComments from '../components/PostComments';
import { useAuth } from '../providers/AuthProvider';

const PAGE_SIZE = 10; // posts per page

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  title?: string;
  createdAt: Date;
  url?: string;
  commentsEnabled?: boolean;
  authorCommentsEnabled?: boolean;
  // cursor support — raw timestamp for pagination
  _timestamp: number;
}

const prefKey = () => `feed_showMine:${auth.currentUser?.uid ?? 'anon'}`;

function toDate(rawTs: any): Date {
  if (!rawTs) return new Date();
  if (typeof rawTs?.toDate === 'function') return rawTs.toDate();
  if (rawTs instanceof Date) return rawTs;
  if (typeof rawTs === 'number') return new Date(rawTs);
  return new Date();
}

function toTimestamp(rawTs: any): number {
  if (typeof rawTs === 'number') return rawTs;
  if (typeof rawTs?.toDate === 'function') return rawTs.toDate().getTime();
  if (rawTs instanceof Date) return rawTs.getTime();
  return 0;
}

export default function Feed() {
  const { profile } = useAuth();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showMine, setShowMine] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [menuFor, setMenuFor] = useState<Post | null>(null);
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());

  // cache: uid → { displayName/username, commentsEnabled }
  const authorCache = useRef<Record<string, { label: string; commentsEnabled: boolean }>>({});
  // friend uid set
  const friendUids = useRef<Set<string>>(new Set());
  // oldest timestamp loaded so far (for pagination cursor)
  const oldestTs = useRef<number>(Date.now());

  const router = useRouter();

  // my global comments setting — from cached profile, no extra read
  const myGlobalCommentsEnabled = profile?.commentsEnabled ?? false;

  // ── persist show-mine toggle ────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(prefKey())
      .then((v) => { if (v != null) setShowMine(v === '1'); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(prefKey(), showMine ? '1' : '0').catch(() => {});
  }, [showMine]);

  // ── block list ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    return onSnapshot(collection(db, 'users', me, 'blocks'), (snap) => {
      const s = new Set<string>();
      snap.forEach((d) => s.add(d.id));
      setBlockedUids(s);
    });
  }, []);

  // ── build friend uid set (one-time, refreshed on friend changes) ────────────
  const loadFriends = useCallback(async (): Promise<Set<string>> => {
    const me = auth.currentUser?.uid;
    if (!me) return new Set();
    const uids = new Set<string>();
    uids.add(me);

    await Promise.allSettled([
      // Friends doc
      getDoc(doc(db, 'Friends', me)).then((snap) => {
        if (snap.exists()) {
          ((snap.data().friends ?? []) as any[]).forEach((f) => { if (f?.uid) uids.add(f.uid); });
        }
      }),
      // FriendEdges
      getDocs(query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me))).then((snap) => {
        snap.forEach((d) => {
          const arr: string[] = (d.data() as any)?.uids ?? [];
          arr.forEach((u) => { if (u !== me) uids.add(u); });
        });
      }),
      // subcollection
      getDocs(collection(db, 'users', me, 'friends')).then((snap) => {
        snap.forEach((d) => { const f: any = d.data(); if (f?.uid) uids.add(f.uid); });
      }),
    ]);

    friendUids.current = uids;
    return uids;
  }, []);

  // ── resolve author label + commentsEnabled for a batch of uids ─────────────
  const resolveAuthors = useCallback(async (uids: string[]) => {
    const missing = uids.filter((u) => !authorCache.current[u]);
    if (!missing.length) return;
    await Promise.allSettled(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'Profiles', uid));
          const data: any = snap.exists() ? snap.data() : {};
          const label = (data.displayName || data.username || '').trim() || 'Friend';
          authorCache.current[uid] = { label, commentsEnabled: data.commentsEnabled === true };
        } catch {
          authorCache.current[uid] = { label: 'Friend', commentsEnabled: false };
        }
      })
    );
  }, []);

  // ── load one page of posts ──────────────────────────────────────────────────
  // olderThan: unix ms — load posts with timestamp < olderThan
  const loadPage = useCallback(async (uids: string[], olderThan: number): Promise<Post[]> => {
    if (!uids.length) return [];

    // Fire one query per author (Firestore limitation — no OR on different fields)
    // Each returns up to PAGE_SIZE, we then merge and take the top PAGE_SIZE globally
    const perAuthorLimit = Math.max(3, Math.ceil(PAGE_SIZE / uids.length) + 2);

    const results = await Promise.allSettled(
      uids.map((uid) =>
        getDocs(
          query(
            collection(db, 'Posts'),
            where('author', '==', uid),
            orderBy('timestamp', 'desc'),
            where('timestamp', '<', olderThan),
            limit(perAuthorLimit)
          )
        )
      )
    );

    const collected: Post[] = [];
    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled') return;
      const uid = uids[idx];
      const author = authorCache.current[uid] ?? { label: 'Friend', commentsEnabled: false };
      res.value.docs.forEach((d) => {
        const data = d.data() as any;
        const rawTs = data.timestamp ?? data.createdAt;
        collected.push({
          id: d.id,
          authorUid: uid,
          authorUsername: author.label,
          content: data.content ?? '',
          title: data.title ?? '',
          createdAt: toDate(rawTs),
          url: data.url ?? data.link ?? data.href ?? undefined,
          commentsEnabled: data.commentsEnabled !== false,
          authorCommentsEnabled: author.commentsEnabled,
          _timestamp: toTimestamp(rawTs),
        });
      });
    });

    // sort desc, take page
    collected.sort((a, b) => b._timestamp - a._timestamp);
    return collected.slice(0, PAGE_SIZE);
  }, []);

  // ── initial load ────────────────────────────────────────────────────────────
  const initialLoad = useCallback(async () => {
    setLoading(true);
    try {
      const uids = Array.from(await loadFriends());
      await resolveAuthors(uids);
      const page = await loadPage(uids, Date.now() + 1000);
      oldestTs.current = page.length ? page[page.length - 1]._timestamp : 0;
      setHasMore(page.length >= PAGE_SIZE);

      // dedupe by id
      const seen = new Map<string, Post>();
      page.forEach((p) => seen.set(p.id, p));
      setPosts(Array.from(seen.values()));
    } catch (err) {
      console.error('Feed initial load error:', err);
    } finally {
      setLoading(false);
    }
  }, [loadFriends, resolveAuthors, loadPage]);

  // ── load more (pagination) ──────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestTs.current) return;
    setLoadingMore(true);
    try {
      const uids = Array.from(friendUids.current);
      const page = await loadPage(uids, oldestTs.current);
      if (page.length < PAGE_SIZE) setHasMore(false);
      if (!page.length) return;
      oldestTs.current = page[page.length - 1]._timestamp;

      setPosts((prev) => {
        const seen = new Map<string, Post>(prev.map((p) => [p.id, p]));
        page.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, p); });
        return Array.from(seen.values()).sort((a, b) => b._timestamp - a._timestamp);
      });
    } catch (err) {
      console.error('Feed loadMore error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loadPage]);

  useEffect(() => { initialLoad(); }, [initialLoad]);

  // ── live refresh on friend changes — skip the first snapshot (it's just the initial delivery) ──
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    let debounce: ReturnType<typeof setTimeout>;
    const makeRefresh = (skip: { val: boolean }) => () => {
      if (skip.val) { skip.val = false; return; }
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        // keep author cache — names don't change just because friends list changed
        oldestTs.current = Date.now() + 1000;
        setHasMore(true);
        initialLoad();
      }, 800);
    };
    const skipObjA = { val: true };
    const skipObjB = { val: true };
    const unsubA = onSnapshot(collection(db, 'users', me, 'friends'), makeRefresh(skipObjA), () => {});
    const unsubB = onSnapshot(query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me)), makeRefresh(skipObjB), () => {});
    return () => { clearTimeout(debounce); unsubA(); unsubB(); };
  }, [initialLoad]);

  // ── filter ──────────────────────────────────────────────────────────────────
  const displayedPosts = useMemo(() => {
    const me = auth.currentUser?.uid;
    const base = showMine || !me ? posts : posts.filter((p) => p.authorUid !== me);
    return blockedUids.size ? base.filter((p) => !blockedUids.has(p.authorUid)) : base;
  }, [posts, showMine, blockedUids]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const handleReport = useCallback((p: Post) => {
    Alert.alert('Report post?', 'Are you sure you want to report this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report', style: 'destructive',
        onPress: async () => {
          const me = auth.currentUser?.uid;
          if (!me) return;
          try {
            await addDoc(collection(db, 'Reports'), {
              targetType: 'post', targetId: p.id, targetOwnerUid: p.authorUid,
              reporterUid: me, createdAt: serverTimestamp(), status: 'open',
            });
            Alert.alert('Thanks', 'We received your report.');
          } catch (e: any) { Alert.alert('Report failed', e?.message ?? 'Try again.'); }
        },
      },
    ]);
  }, []);

  const handleBlock = useCallback((p: Post) => {
    Alert.alert('Block user?', `You will no longer see posts from ${p.authorUsername}. Are you sure?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block', style: 'destructive',
        onPress: async () => {
          const me = auth.currentUser?.uid;
          if (!me || p.authorUid === me) return;
          try {
            await setDoc(doc(db, 'users', me, 'blocks', p.authorUid), { blockedAt: serverTimestamp() });
            Alert.alert('Blocked', 'You will no longer see this user\u2019s content.');
          } catch (e: any) { Alert.alert('Block failed', e?.message ?? 'Try again.'); }
        },
      },
    ]);
  }, []);

  const handleToggleComments = useCallback(async (p: Post) => {
    const me = auth.currentUser?.uid;
    if (!me || p.authorUid !== me) return;
    const next = !(p.commentsEnabled !== false);
    try {
      await updateDoc(doc(db, 'Posts', p.id), { commentsEnabled: next });
      setPosts((prev) => prev.map((post) => post.id === p.id ? { ...post, commentsEnabled: next } : post));
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Try again.'); }
  }, []);

  // ── render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <View style={styles.center}><ActivityIndicator size="large" /></View>
        <BottomBar />
      </>
    );
  }

  if (!displayedPosts.length) {
    return (
      <>
        <View style={styles.center}>
          <Text>No posts from your friends yet.</Text>
          <View style={{ marginTop: 12, width: '60%' }}>
            <Button title="Add Friends" onPress={() => router.push('/friends')} />
          </View>
        </View>
        <BottomBar />
      </>
    );
  }

  return (
    <>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.headerCol}>
          <Text style={styles.headerTitle}>Feed</Text>
          <Pressable
            onPress={() => setShowMine((s) => !s)}
            style={({ pressed }) => [styles.toggleBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.toggleBtnText}>{showMine ? 'Hide my posts' : 'Show my posts'}</Text>
          </Pressable>
        </View>

        <FlatList
          data={displayedPosts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          renderItem={({ item }) => {
            const commentsVisible = item.commentsEnabled !== false && item.authorCommentsEnabled === true;
            return (
              <View style={styles.postContainer}>
                <View style={styles.postHeaderRow}>
                  <Text style={styles.postAuthor}>{item.authorUsername}</Text>
                  <Pressable onPress={() => setMenuFor(item)} hitSlop={10} style={styles.menuBtn}>
                    <Text style={styles.menuDots}>⋯</Text>
                  </Pressable>
                </View>

                {item.title ? (
                  <Text style={styles.postTitle} numberOfLines={2}>{item.title}</Text>
                ) : null}

                {item.url ? (
                  <Pressable
                    onPress={() => Linking.openURL(/^https?:\/\//i.test(item.url!) ? item.url! : `https://${item.url}`)}
                    style={{ marginBottom: 6 }}
                  >
                    <Text style={styles.postLink} numberOfLines={1}>
                      {String(item.url).replace(/^https?:\/\//i, '')}
                    </Text>
                  </Pressable>
                ) : null}

                <Text style={styles.postContent}>{item.content}</Text>

                <View style={styles.postFooter}>
                  {commentsVisible ? (
                    <Pressable
                      onPress={() => setSelectedPost(item)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.viewCommentsBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.viewCommentsTxt}>💬 View comments</Text>
                    </Pressable>
                  ) : <View />}
                  <Text style={styles.postDate}>{item.createdAt.toLocaleString()}</Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                style={({ pressed }) => [styles.loadMoreBtn, pressed && { opacity: 0.8 }, loadingMore && { opacity: 0.6 }]}
              >
                {loadingMore
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.loadMoreTxt}>Load more</Text>
                }
              </Pressable>
            ) : (
              <Text style={styles.endTxt}>You're all caught up</Text>
            )
          }
        />
      </SafeAreaView>
      <BottomBar />

      {/* Comments Modal */}
      <Modal visible={!!selectedPost} animationType="fade" transparent onRequestClose={() => setSelectedPost(null)}>
        {selectedPost && <PostComments post={selectedPost} onClose={() => setSelectedPost(null)} />}
      </Modal>

      {/* Post Action Menu */}
      <Modal visible={!!menuFor} animationType="fade" transparent onRequestClose={() => setMenuFor(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            {menuFor?.authorUid === auth.currentUser?.uid && myGlobalCommentsEnabled ? (
              <Pressable style={styles.menuRow} onPress={() => { if (menuFor) handleToggleComments(menuFor); setMenuFor(null); }}>
                <Text style={styles.menuText}>{menuFor.commentsEnabled !== false ? 'Turn off comments' : 'Turn on comments'}</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid !== auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleReport(p); }}>
                <Text style={styles.menuText}>Report</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid !== auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleBlock(p); }}>
                <Text style={styles.menuText}>Block user</Text>
              </Pressable>
            ) : null}

            <Pressable style={[styles.menuRow, styles.menuCancel]} onPress={() => setMenuFor(null)}>
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },

  headerCol: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },

  toggleBtn: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2F6FED' },
  toggleBtnText: { color: '#fff', fontWeight: '800' },

  list: { padding: 16, backgroundColor: '#fff' },
  postContainer: { marginBottom: 16, padding: 16, backgroundColor: '#f9f9f9', borderRadius: 8, borderWidth: 1, borderColor: '#eee' },

  postHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  menuBtn: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 4 },
  menuDots: { fontSize: 18, color: '#6b7280' },

  postAuthor: { fontWeight: 'bold', marginBottom: 4, color: '#111827' },
  postTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  postLink: { color: '#2F6FED', textDecorationLine: 'underline', fontWeight: '600' },
  postContent: { marginBottom: 8, color: '#111827', marginTop: 4 },
  postFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  postDate: { fontSize: 12, color: '#555' },
  viewCommentsBtn: { paddingVertical: 2 },
  viewCommentsTxt: { fontSize: 13, color: '#2F6FED', fontWeight: '600' },

  loadMoreBtn: {
    backgroundColor: '#2F6FED', borderRadius: 12, paddingVertical: 12,
    marginHorizontal: 32, marginVertical: 16, alignItems: 'center',
  },
  loadMoreTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  endTxt: { textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingVertical: 20 },

  menuBackdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: '#1f2937', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  menuRow: { paddingVertical: 14 },
  menuCancel: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#374151' },
  menuText: { color: '#fff', fontSize: 16 },
});
