// app/feed.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Linking,
  Modal,
  Alert,
  Animated,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
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
  deleteDoc,
  updateDoc,
  serverTimestamp,
  DocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useLocalSearchParams, useRouter } from 'expo-router';
import BottomBar from '../components/BottomBar';
import { SCREEN_PAD } from '../components/ui/layout';
import { SafeAreaView } from 'react-native-safe-area-context';
import PostComments from '../components/PostComments';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import LinkPreview from '../components/LinkPreview';
import { tap, press, warning, selection } from '../utils/haptics';

const PAGE_SIZE = 10; // posts per page

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorUsernameSlug: string; // raw username for profile route
  content: string;
  title?: string;
  createdAt: Date;
  url?: string;
  commentsEnabled?: boolean;
  authorCommentsEnabled?: boolean;
  // cursor support, raw timestamp for pagination
  _timestamp: number;
}

const prefKey = () => `feed_showMine:${auth.currentUser?.uid ?? 'anon'}`;

// Author label + commentsEnabled cache, hoisted to module scope so a remount
// (navigating away and back) reuses resolved Profiles instead of re-reading them.
const moduleAuthorCache: Record<string, { label: string; username: string; commentsEnabled: boolean }> = {};

// Firestore 'in' queries cap at 10 values, chunk author uids into groups of 10.
function chunk10<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 10) out.push(arr.slice(i, i + 10));
  return out;
}

// ── Skeleton loader ────────────────────────────────────────────────────────
function SkeletonBlock({ width, height, style, color, shimmer }: { width: number | string; height: number; style?: any; color?: string; shimmer?: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: 6, backgroundColor: shimmer || color || '#E5E7EB', opacity: anim }, style]}
    />
  );
}

function SkeletonCard({ cardBg, cardBorder, shimmer }: { cardBg?: string; cardBorder?: string; shimmer?: string } = {}) {
  return (
    <View style={[skeletonStyles.card, cardBg ? { backgroundColor: cardBg } : undefined, cardBorder ? { borderColor: cardBorder } : undefined]}>
      <SkeletonBlock width={100} height={14} shimmer={shimmer} />
      <SkeletonBlock width="80%" height={18} style={{ marginTop: 10 }} shimmer={shimmer} />
      <SkeletonBlock width="100%" height={14} style={{ marginTop: 8 }} shimmer={shimmer} />
      <SkeletonBlock width="60%" height={14} style={{ marginTop: 6 }} shimmer={shimmer} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        <SkeletonBlock width={120} height={14} shimmer={shimmer} />
        <SkeletonBlock width={80} height={14} shimmer={shimmer} />
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
});

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
  const { colors: tc } = useTheme();
  const online = useOnline();
  const { profile } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ postId?: string; commentId?: string; scrollToPostId?: string }>();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showMine, setShowMine] = useState(false);
  // Transient, session-only override that reveals the user's own posts right after they create one
  // (arriving with scrollToPostId). Kept SEPARATE from showMine so it never persists or silently
  // changes the saved "show my posts" preference.
  const [forceShowMine, setForceShowMine] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [targetCommentId, setTargetCommentId] = useState<string | undefined>(undefined);
  const listRef = useRef<FlatList<Post>>(null);
  const handledPostIdRef = useRef<string | null>(null);
  const handledScrollIdRef = useRef<string | null>(null);

  const [menuFor, setMenuFor] = useState<Post | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  const [silencedPostIds, setSilencedPostIds] = useState<Set<string>>(new Set());

  // cache: uid → { label (display name), username (slug for profile route), commentsEnabled }
  // Backed by module scope so it survives remounts.
  const authorCache = useRef(moduleAuthorCache);
  // friend uid set
  const friendUids = useRef<Set<string>>(new Set());
  // friends-of-friends uid set (session cache, kept separate from friends)
  const fofUids = useRef<Set<string>>(new Set());
  // last seen value of my Profiles/{me}.friendsOfFriendsPosts flag
  const prevFofFlagRef = useRef<boolean | null>(null);
  // oldest timestamp loaded so far (for pagination cursor)
  const oldestTs = useRef<number>(Date.now());
  // ids already shown, so the '<=' cursor boundary doesn't re-add or skip equal-ts posts
  const seenIdsRef = useRef<Set<string>>(new Set());
  // pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);

  // my global comments setting, from cached profile, no extra read
  const myGlobalCommentsEnabled = profile?.commentsEnabled ?? false;

  // ── persist show-mine toggle ────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(prefKey())
      .then((v) => {
        if (v != null) setShowMine(v === '1');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(prefKey(), showMine ? '1' : '0').catch(() => {});
  }, [showMine]);

  // Reveal the user's own new post when they land here with a scrollToPostId (e.g. just created a
  // post), so it isn't hidden by the default "hide my posts" filter. This is a SESSION-ONLY latch,
  // NOT a preference change: the saved showMine value is untouched, so a later cold launch still
  // respects what the user actually chose.
  useEffect(() => {
    if (params.scrollToPostId) setForceShowMine(true);
  }, [params.scrollToPostId]);

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

  // ── silenced posts (comment-on-comment notifications muted per post) ─────────
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    return onSnapshot(collection(db, 'users', me, 'silencedPosts'), (snap) => {
      const s = new Set<string>();
      snap.forEach((d) => s.add(d.id));
      setSilencedPostIds(s);
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

    // friends-of-friends: only when I opted in; the callable enforces mutual opt-in
    const fof = new Set<string>();
    try {
      const mySnap = await getDoc(doc(db, 'Profiles', me));
      if (mySnap.exists() && (mySnap.data() as any)?.friendsOfFriendsPosts === true) {
        const getFriendsOfFriends = httpsCallable<void, { uids: string[] }>(
          getFunctions(),
          'getFriendsOfFriends'
        );
        const result = await getFriendsOfFriends();
        const returned = Array.isArray(result.data?.uids) ? result.data.uids : [];
        returned.forEach((u) => {
          if (typeof u === 'string' && u && u !== me && !uids.has(u)) fof.add(u);
        });
      }
    } catch (err) {
      // FoF must never break the feed (offline, callable not deployed yet)
      if (__DEV__) console.warn('Feed friends-of-friends load failed:', err);
    }
    fofUids.current = fof;

    return new Set([...Array.from(uids), ...Array.from(fof)]);
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
          const username = (data.username || '').trim();
          const label = (data.displayName || username || '').trim() || 'Friend';
          authorCache.current[uid] = { label, username, commentsEnabled: data.commentsEnabled === true };
        } catch {
          authorCache.current[uid] = { label: 'Friend', username: '', commentsEnabled: false };
        }
      })
    );
  }, []);

  // ── load one page of posts ──────────────────────────────────────────────────
  // Batched: authors are grouped into chunks of 10 and queried with where('author','in', chunk)
  // + orderBy('timestamp','desc') + limit(PAGE_SIZE), so cost is ceil(N/10) reads not N.
  // Returns the merged page plus a next cursor that is guaranteed not to skip any
  // post newer than it. A chunk that returns exactly PAGE_SIZE docs is "truncated":
  // there may be more posts in it older than the last returned doc but newer than the
  // global page slice, so the cursor must not advance past that chunk's oldest returned
  // timestamp. seenIds carries de-dupe state across pages so equal-timestamp posts at a
  // '<=' boundary aren't lost or duplicated.
  const loadPage = useCallback(async (
    uids: string[],
    olderThanOrEq: number,
    seenIds: Set<string>,
  ): Promise<{ posts: Post[]; nextCursor: number; exhausted: boolean }> => {
    if (!uids.length) return { posts: [], nextCursor: 0, exhausted: true };

    const chunks = chunk10(uids);
    const results = await Promise.allSettled(
      chunks.map((group) =>
        getDocs(
          query(
            collection(db, 'Posts'),
            where('author', 'in', group),
            orderBy('timestamp', 'desc'),
            where('timestamp', '<=', olderThanOrEq),
            limit(PAGE_SIZE)
          )
        )
      )
    );

    const collected: Post[] = [];
    // Oldest returned timestamp among chunks that came back FULL (truncated). The cursor
    // may never advance past the newest such boundary, or we'd skip that chunk's posts.
    let truncatedFloor = -Infinity;
    let anyFulfilled = false;

    results.forEach((res) => {
      if (res.status !== 'fulfilled') return;
      anyFulfilled = true;
      const docs = res.value.docs;
      docs.forEach((d) => {
        const data = d.data() as any;
        const uid = String(data.author ?? '');
        const author = authorCache.current[uid] ?? { label: 'Friend', username: '', commentsEnabled: false };
        // The query orders + cursors on the numeric `timestamp` field, so _timestamp
        // (used for sort AND the next cursor) MUST come from that same field or the
        // '<=' boundary would skip/duplicate. timestampServer is only a display fallback
        // for createdAt (authoritative wall-clock, immune to client skew).
        const cursorTs = toTimestamp(data.timestamp ?? data.createdAt);
        const displayTs = data.timestampServer ?? data.timestamp ?? data.createdAt;
        collected.push({
          id: d.id,
          authorUid: uid,
          authorUsername: author.label,
          authorUsernameSlug: author.username,
          content: data.content ?? '',
          title: data.title ?? '',
          createdAt: toDate(displayTs),
          url: data.url ?? data.link ?? data.href ?? undefined,
          commentsEnabled: data.commentsEnabled !== false,
          authorCommentsEnabled: author.commentsEnabled,
          _timestamp: cursorTs,
        });
      });
      if (docs.length === PAGE_SIZE) {
        const lastData = docs[docs.length - 1].data() as any;
        const oldest = toTimestamp(lastData.timestamp ?? lastData.createdAt);
        if (oldest > truncatedFloor) truncatedFloor = oldest;
      }
    });

    // De-dupe against posts already shown (across pages), then sort newest-first.
    const deduped = collected.filter((p) => !seenIds.has(p.id));
    deduped.sort((a, b) => b._timestamp - a._timestamp);
    const pageSlice = deduped.slice(0, PAGE_SIZE);
    pageSlice.forEach((p) => seenIds.add(p.id));

    // Cursor: advance to the oldest post we're actually showing this page, but never
    // past any truncated chunk's oldest returned ts (or we'd skip that chunk's newer
    // posts forever). Use '<=' next time + seenIds de-dupe to keep the boundary safe.
    const sliceOldest = pageSlice.length ? pageSlice[pageSlice.length - 1]._timestamp : olderThanOrEq;
    let nextCursor: number;
    if (truncatedFloor > -Infinity) {
      // max(sliceOldest, truncatedFloor): don't move past a chunk that still has posts.
      nextCursor = Math.max(sliceOldest, truncatedFloor);
    } else {
      nextCursor = sliceOldest;
    }

    // Exhausted only when no chunk was truncated AND we didn't fill a page, i.e. there is
    // provably nothing older left to fetch.
    const exhausted = anyFulfilled && truncatedFloor === -Infinity && deduped.length < PAGE_SIZE;

    return { posts: pageSlice, nextCursor, exhausted };
  }, []);

  // ── patch already-built posts with freshly resolved author labels ──────────
  // loadPage builds posts from whatever author cache exists; after resolving the
  // DISTINCT authors actually present we re-apply their labels so nothing renders
  // as a stale "Friend" placeholder.
  const applyAuthorLabels = useCallback((page: Post[]): Post[] =>
    page.map((p) => {
      const a = authorCache.current[p.authorUid];
      return a ? { ...p, authorUsername: a.label, authorUsernameSlug: a.username, authorCommentsEnabled: a.commentsEnabled } : p;
    })
  , []);

  // ── initial load ────────────────────────────────────────────────────────────
  const initialLoad = useCallback(async () => {
    setLoading(true);
    try {
      seenIdsRef.current = new Set();
      const uids = Array.from(await loadFriends());
      // '<=' with a far-future cursor so the newest post is included.
      const { posts: rawPage, nextCursor, exhausted } = await loadPage(uids, Date.now() + 1000, seenIdsRef.current);
      // Resolve Profiles only for the distinct authors actually present in this page.
      await resolveAuthors(Array.from(new Set(rawPage.map((p) => p.authorUid).filter(Boolean))));
      const page = applyAuthorLabels(rawPage);
      oldestTs.current = nextCursor;
      setHasMore(!exhausted && page.length > 0);

      const seen = new Map<string, Post>();
      page.forEach((p) => seen.set(p.id, p));
      setPosts(Array.from(seen.values()));
    } catch (err) {
      if (__DEV__) console.error('Feed initial load error:', err);
    } finally {
      setLoading(false);
    }
  }, [loadFriends, resolveAuthors, loadPage, applyAuthorLabels]);

  // ── load more (pagination) ──────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    press();
    // Never paginate while a pull-to-refresh is resetting the cursor + seenIds, or the two
    // races clobber oldestTs and re-merge onto a freshly-replaced list.
    if (loadingMore || refreshing || !hasMore || !oldestTs.current) return;
    setLoadingMore(true);
    try {
      const uids = Array.from(new Set([...Array.from(friendUids.current), ...Array.from(fofUids.current)]));
      const prevCursor = oldestTs.current;
      const { posts: rawPage, nextCursor, exhausted } = await loadPage(uids, prevCursor, seenIdsRef.current);
      await resolveAuthors(Array.from(new Set(rawPage.map((p) => p.authorUid).filter(Boolean))));
      const page = applyAuthorLabels(rawPage);
      // Advance cursor even on an empty slice so a truncated-but-all-seen page keeps moving.
      oldestTs.current = nextCursor;
      // Stall guard: an all-seen page that can't move the cursor would loop forever.
      // If we added nothing new and the cursor didn't advance, we're done.
      if (exhausted || (!page.length && nextCursor >= prevCursor)) setHasMore(false);
      if (!page.length) return;

      setPosts((prev) => {
        const seen = new Map<string, Post>(prev.map((p) => [p.id, p]));
        page.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, p); });
        return Array.from(seen.values()).sort((a, b) => b._timestamp - a._timestamp);
      });
    } catch (err) {
      if (__DEV__) console.error('Feed loadMore error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, refreshing, hasMore, loadPage, resolveAuthors, applyAuthorLabels]);

  // ── pull-to-refresh ──────────────────────────────────────────────────────────
  // Resets the cursor + hasMore and re-runs the initial load (mirrors the
  // friend-change refresh path). Uses `refreshing` so the spinner shows in the
  // pull control rather than swapping the list for the skeleton.
  const onRefresh = useCallback(async () => {
    if (loadingMore) return; // don't start a refresh on top of an in-flight pagination
    tap();
    setRefreshing(true);
    oldestTs.current = Date.now() + 1000;
    setHasMore(true);
    try {
      await initialLoad();
    } finally {
      setRefreshing(false);
    }
  }, [initialLoad, loadingMore]);

  useEffect(() => { initialLoad(); }, [initialLoad]);

  // ── live refresh on friend changes, skip the first snapshot (it's just the initial delivery) ──
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    let debounce: ReturnType<typeof setTimeout>;
    const triggerRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        // keep author cache, names don't change just because friends list changed
        oldestTs.current = Date.now() + 1000;
        setHasMore(true);
        initialLoad();
      }, 800);
    };
    const makeRefresh = (skip: { val: boolean }) => () => {
      if (skip.val) { skip.val = false; return; }
      triggerRefresh();
    };
    const skipObjA = { val: true };
    const skipObjB = { val: true };
    const unsubA = onSnapshot(collection(db, 'users', me, 'friends'), makeRefresh(skipObjA), () => {});
    const unsubB = onSnapshot(query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me)), makeRefresh(skipObjB), () => {});
    // re-init when MY friendsOfFriendsPosts flag flips (toggled in advanced settings);
    // watch only this field's value transitions, ignore unrelated profile changes
    const unsubC = onSnapshot(doc(db, 'Profiles', me), (snap) => {
      const flag = snap.exists() && (snap.data() as any)?.friendsOfFriendsPosts === true;
      if (prevFofFlagRef.current === null) { prevFofFlagRef.current = flag; return; }
      if (prevFofFlagRef.current === flag) return;
      prevFofFlagRef.current = flag;
      triggerRefresh();
    }, () => {});
    return () => { clearTimeout(debounce); unsubA(); unsubB(); unsubC(); };
  }, [initialLoad]);

  // Effective "show mine" = the saved preference OR the transient post-creation latch.
  const effectiveShowMine = showMine || forceShowMine;

  // ── filter ──────────────────────────────────────────────────────────────────
  const displayedPosts = useMemo(() => {
    const me = auth.currentUser?.uid;
    const base = effectiveShowMine || !me ? posts : posts.filter((p) => p.authorUid !== me);
    return blockedUids.size ? base.filter((p) => !blockedUids.has(p.authorUid)) : base;
  }, [posts, effectiveShowMine, blockedUids]);

  // ── deep link: post comment notification ────────────────────────────────────
  // Opens the comments modal for the target post, scrolls feed to it, and
  // forwards an optional commentId so the modal can scroll to the comment.
  useEffect(() => {
    const pid = params.postId;
    if (!pid) {
      handledPostIdRef.current = null;
      return;
    }
    if (handledPostIdRef.current === pid) return;

    const found = posts.find((p) => p.id === pid);
    if (found) {
      handledPostIdRef.current = pid;
      setSelectedPost(found);
      setTargetCommentId(params.commentId || undefined);
      const idx = displayedPosts.findIndex((p) => p.id === pid);
      if (idx >= 0) {
        requestAnimationFrame(() =>
          listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 })
        );
      }
      router.setParams({ postId: undefined as any, commentId: undefined as any });
      return;
    }
    if (loading) return;

    handledPostIdRef.current = pid;
    const cid = params.commentId || undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'Posts', pid));
        if (cancelled || !snap.exists()) return;
        const d: any = snap.data();
        // Posts are written with author/timestamp/link/authorName (see create-post.tsx),
        // NOT authorUid/createdAt/url/authorUsername. Map the real field names, else
        // authorUid is '' and PostComments throws on doc(db,'Profiles','').
        const authorUid = d?.author ?? d?.authorUid ?? '';
        const ts = toTimestamp(d?.timestampServer ?? d?.timestamp ?? d?.createdAt) || Date.now();
        const cached = authorUid ? authorCache.current[authorUid] : undefined;
        setSelectedPost({
          id: pid,
          authorUid,
          authorUsername: cached?.label ?? d?.authorName ?? d?.authorUsername ?? '',
          authorUsernameSlug: cached?.username ?? d?.authorName ?? d?.authorUsername ?? '',
          content: d?.content || '',
          title: d?.title,
          createdAt: new Date(ts),
          url: d?.url ?? d?.link,
          commentsEnabled: d?.commentsEnabled,
          authorCommentsEnabled: cached?.commentsEnabled,
          _timestamp: ts,
        });
        setTargetCommentId(cid);
      } catch {}
      if (!cancelled) router.setParams({ postId: undefined as any, commentId: undefined as any });
    })();
    return () => { cancelled = true; };
  }, [params.postId, params.commentId, loading, posts, displayedPosts, router]);

  // ── deep link: new post notification (scroll only, no modal) ────────────────
  useEffect(() => {
    const pid = params.scrollToPostId;
    if (!pid) {
      handledScrollIdRef.current = null;
      return;
    }
    if (handledScrollIdRef.current === pid) return;

    const idx = displayedPosts.findIndex((p) => p.id === pid);
    if (idx >= 0) {
      handledScrollIdRef.current = pid;
      requestAnimationFrame(() =>
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 })
      );
      router.setParams({ scrollToPostId: undefined as any });
      return;
    }
    if (loading) return;

    // Posts loaded but not in feed (paginated past or hidden by filter). Give up.
    handledScrollIdRef.current = pid;
    router.setParams({ scrollToPostId: undefined as any });
  }, [params.scrollToPostId, loading, displayedPosts, router]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const handleReport = useCallback((p: Post) => {
    Alert.alert('Report post?', 'Are you sure you want to report this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report', style: 'destructive',
        onPress: async () => {
          warning();
          const me = auth.currentUser?.uid;
          if (!me) return;
          try {
            await addDoc(collection(db, 'Reports'), {
              targetType: 'post', targetId: p.id, targetOwnerUid: p.authorUid,
              targetOwnerUsername: p.authorUsername || null,
              reporterUid: me, createdAt: serverTimestamp(), status: 'open',
              snippet: String(p.title || '').slice(0, 100),
              contentSnippet: String(p.content || '').slice(0, 300),
              url: p.url || null,
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
          warning();
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

  const handleToggleSilencePost = useCallback(async (p: Post) => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const ref = doc(db, 'users', me, 'silencedPosts', p.id);
    const isSilenced = silencedPostIds.has(p.id);
    try {
      if (isSilenced) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, { silencedAt: serverTimestamp() });
      }
    } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Try again.'); }
  }, [silencedPostIds]);

  const handleDeletePost = useCallback((p: Post) => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          warning();
          try {
            await deleteDoc(doc(db, 'Posts', p.id));
            setPosts((prev) => prev.filter((post) => post.id !== p.id));
          } catch (e: any) { Alert.alert('Failed', e?.message ?? 'Try again.'); }
        },
      },
    ]);
  }, []);

  const handleStartEdit = useCallback((p: Post) => {
    setEditingPost(p);
    setEditTitle(p.title || '');
    setEditContent(p.content);
    setEditUrl(p.url || '');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    press();
    if (!editingPost) return;
    const content = editContent.trim();
    if (!content) { Alert.alert('Content required'); return; }
    setEditSaving(true);
    try {
      const updates: any = { content, title: editTitle.trim() || '' };
      if (editUrl.trim()) updates.url = editUrl.trim();
      else updates.url = '';
      await updateDoc(doc(db, 'Posts', editingPost.id), updates);
      setPosts((prev) => prev.map((p) => p.id === editingPost.id
        ? { ...p, content, title: updates.title, url: updates.url || undefined }
        : p
      ));
      setEditingPost(null);
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Try again.');
    } finally {
      setEditSaving(false);
    }
  }, [editingPost, editTitle, editContent, editUrl]);

  // ── render ──────────────────────────────────────────────────────────────────
  if (loading && !refreshing) {
    return (
      <>
        <SafeAreaView style={{ flex: 1, backgroundColor: tc.bg }} edges={['top', 'left', 'right']}>
          <View style={[styles.list, { flex: 1, backgroundColor: tc.bg }]}>
            <View style={[styles.headerCol, { backgroundColor: tc.card, borderBottomColor: tc.border }]}>
              <Text style={[styles.headerTitle, { color: tc.text }]}>Feed</Text>
              <View style={[styles.toggleBtn, { backgroundColor: tc.primary, opacity: 0.4 }]}>
                <Text style={styles.toggleBtnText}>Show my posts</Text>
              </View>
            </View>
            <SkeletonCard cardBg={tc.card} cardBorder={tc.border} shimmer={tc.skeleton} />
            <SkeletonCard cardBg={tc.card} cardBorder={tc.border} shimmer={tc.skeleton} />
            <SkeletonCard cardBg={tc.card} cardBorder={tc.border} shimmer={tc.skeleton} />
          </View>
          <BottomBar />
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: tc.bg }} edges={['top', 'left', 'right']}>
        <FlatList
          ref={listRef}
          style={{ flex: 1, backgroundColor: tc.bg }}
          data={displayedPosts}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tc.primary} colors={[tc.primary]} />
          }
          contentContainerStyle={[styles.list, { paddingBottom: 100, flexGrow: 1, backgroundColor: tc.bg }]}
          onScrollToIndexFailed={(info) => {
            // Item not yet measured (off-screen). Estimate offset, then retry.
            const offset = info.averageItemLength * info.index;
            listRef.current?.scrollToOffset({ offset, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 });
            }, 100);
          }}
          ListHeaderComponent={
            <View style={[styles.headerCol, { backgroundColor: tc.card, borderBottomColor: tc.border }]}>
              <Text style={[styles.headerTitle, { color: tc.text }]}>Feed</Text>
              <Pressable
                onPress={() => {
                  tap();
                  // Toggle the DISPLAYED state. Hiding also clears the transient latch so a post
                  // just created can be hidden; the saved preference tracks the user's real choice.
                  if (effectiveShowMine) { setShowMine(false); setForceShowMine(false); }
                  else setShowMine(true);
                }}
                style={({ pressed }) => [styles.toggleBtn, { backgroundColor: tc.primary }, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.toggleBtnText}>{effectiveShowMine ? 'Hide my posts' : 'Show my posts'}</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            online ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>📰</Text>
                <Text style={[styles.emptyTitle, { color: tc.text }]}>Your feed is quiet</Text>
                <Text style={[styles.emptyBody, { color: tc.subtle }]}>
                  Posts from your friends will show up here. Add some friends to get started.
                </Text>
                <Pressable
                  onPress={() => { tap(); router.push('/friends'); }}
                  style={({ pressed }) => [styles.emptyBtn, { backgroundColor: tc.primary }, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.emptyBtnTxt}>Find Friends</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>📡</Text>
                <Text style={[styles.emptyTitle, { color: tc.text }]}>No internet connection</Text>
                <Text style={[styles.emptyBody, { color: tc.subtle }]}>
                  Can{'’'}t load your feed right now. Check your connection and try again.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const commentsVisible = item.commentsEnabled !== false && item.authorCommentsEnabled === true;
            return (
              <View style={[styles.postContainer, { backgroundColor: tc.postBg, borderColor: tc.border }]}>
                <View style={styles.postHeaderRow}>
                  <Pressable
                    onPress={() => { tap(); item.authorUsernameSlug && router.push(`/profile/${item.authorUsernameSlug}`); }}
                    disabled={!item.authorUsernameSlug}
                  >
                    <Text style={[styles.postAuthor, { color: tc.text }, item.authorUsernameSlug && [styles.postAuthorLink, { color: tc.linkText }]]} numberOfLines={1} ellipsizeMode="tail">
                      {item.authorUsername}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { tap(); setMenuFor(item); }}
                    hitSlop={10}
                    style={styles.menuBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Post options"
                    accessibilityHint="Report, block, or manage this post"
                  >
                    <Text style={[styles.menuDots, { color: tc.subtle }]}>⋯</Text>
                  </Pressable>
                </View>

                {item.title ? (
                  <Text selectable style={[styles.postTitle, { color: tc.text }]} numberOfLines={2}>{item.title}</Text>
                ) : null}

                {item.url ? <LinkPreview url={item.url} /> : null}

                <Text selectable style={[styles.postContent, { color: tc.text }]}>{item.content}</Text>

                <View style={styles.postFooter}>
                  {commentsVisible ? (
                    <Pressable
                      onPress={() => { tap(); setSelectedPost(item); }}
                      hitSlop={8}
                      style={({ pressed }) => [styles.viewCommentsBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={[styles.viewCommentsTxt, { color: tc.linkText }]}>💬 View comments</Text>
                    </Pressable>
                  ) : <View />}
                  <Text style={[styles.postDate, { color: tc.subtle }]}>{item.createdAt.toLocaleString()}</Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            hasMore ? (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                style={({ pressed }) => [styles.loadMoreBtn, { backgroundColor: tc.primary }, pressed && { opacity: 0.8 }, loadingMore && { opacity: 0.6 }]}
              >
                {loadingMore
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.loadMoreTxt}>Load more</Text>
                }
              </Pressable>
            ) : (
              <Text style={[styles.endTxt, { color: tc.subtle }]}>You{'’'}re all caught up</Text>
            )
          }
        />
        <BottomBar />
      </SafeAreaView>

      {/* Comments Modal */}
      <Modal visible={!!selectedPost} animationType="fade" transparent onRequestClose={() => setSelectedPost(null)}>
        {selectedPost && <PostComments post={selectedPost} targetCommentId={targetCommentId} onClose={() => { setSelectedPost(null); setTargetCommentId(undefined); }} />}
      </Modal>

      {/* Post Action Menu */}
      <Modal visible={!!menuFor} animationType="fade" transparent onRequestClose={() => setMenuFor(null)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: tc.backdrop }]} onPress={() => setMenuFor(null)}>
          <Pressable style={[styles.menuSheet, { backgroundColor: tc.card }]} onPress={(e) => e.stopPropagation()}>
            {menuFor?.authorUid === auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleStartEdit(p); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>Edit post</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid === auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleDeletePost(p); }}>
                <Text style={[styles.menuText, { color: tc.danger }]}>Delete post</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid === auth.currentUser?.uid && myGlobalCommentsEnabled ? (
              <Pressable style={styles.menuRow} onPress={() => { selection(); if (menuFor) handleToggleComments(menuFor); setMenuFor(null); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>{menuFor?.commentsEnabled !== false ? 'Turn off comments' : 'Turn on comments'}</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid !== auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleReport(p); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>Report</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid !== auth.currentUser?.uid ? (
              <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleBlock(p); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>Block user</Text>
              </Pressable>
            ) : null}

            {menuFor?.authorUid !== auth.currentUser?.uid && (profile as any)?.commentOnCommentNotify ? (
              <Pressable style={styles.menuRow} onPress={() => { selection(); const p = menuFor; setMenuFor(null); if (p) handleToggleSilencePost(p); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>
                  {menuFor && silencedPostIds.has(menuFor.id) ? 'Unsilence comment notifications' : 'Silence comment notifications'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable style={[styles.menuRow, styles.menuCancel, { borderTopColor: tc.border }]} onPress={() => { tap(); setMenuFor(null); }}>
              <Text style={[styles.menuText, { color: tc.text }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit Post Modal */}
      <Modal visible={!!editingPost} animationType="slide" transparent onRequestClose={() => setEditingPost(null)}>
        <KeyboardAvoidingView
          style={[styles.editBackdrop, { backgroundColor: tc.backdrop }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.editCard, { backgroundColor: tc.card }]}>
            <Text style={[styles.editModalTitle, { color: tc.text }]}>Edit Post</Text>
            <TextInput
              style={[styles.editInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
              placeholder="Title (optional)"
              placeholderTextColor={tc.subtle}
              value={editTitle}
              onChangeText={setEditTitle}
              maxLength={200}
            />
            <TextInput
              style={[styles.editInput, { minHeight: 100, textAlignVertical: 'top', backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
              placeholder="What's on your mind?"
              placeholderTextColor={tc.subtle}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              maxLength={2000}
            />
            <TextInput
              style={[styles.editInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
              placeholder="Link (optional)"
              placeholderTextColor={tc.subtle}
              value={editUrl}
              onChangeText={setEditUrl}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={500}
            />
            <View style={styles.editActions}>
              <Pressable onPress={() => { tap(); setEditingPost(null); }} style={[styles.editCancelBtn, { backgroundColor: tc.inputBg }]}>
                <Text style={[styles.editCancelTxt, { color: tc.subtle }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveEdit} disabled={editSaving} style={[styles.editSaveBtn, { backgroundColor: tc.primary }, editSaving && { opacity: 0.6 }]}>
                <Text style={styles.editSaveTxt}>{editSaving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },

  headerCol: {
    paddingHorizontal: SCREEN_PAD, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },

  toggleBtn: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2F6FED' },
  toggleBtnText: { color: '#fff', fontWeight: '800' },

  list: { padding: SCREEN_PAD, backgroundColor: '#fff' },
  postContainer: { marginBottom: 16, padding: 16, backgroundColor: '#f9f9f9', borderRadius: 8, borderWidth: 1, borderColor: '#eee' },

  postHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  menuBtn: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 4 },
  menuDots: { fontSize: 18, color: '#6b7280' },

  postAuthor: { fontWeight: 'bold', marginBottom: 4, color: '#111827' },
  postAuthorLink: { color: '#2F6FED' },
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

  // ── empty state ──
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  emptyBtn: {
    backgroundColor: '#2F6FED',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── edit post modal ──
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: 20,
  },
  editCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
    textAlign: 'center',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    marginBottom: 12,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  editCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  editCancelTxt: { fontWeight: '700', color: '#6B7280' },
  editSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#2F6FED',
  },
  editSaveTxt: { fontWeight: '700', color: '#fff' },
});
