// app/feed.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  onSnapshot,
  addDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useRouter } from 'expo-router';
import BottomBar from '../components/BottomBar';
import { SafeAreaView } from 'react-native-safe-area-context';
import PostComments from '../components/PostComments';

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  title?: string;
  createdAt: Date;
  url?: string;
}

const prefKey = () => `feed_showMine:${auth.currentUser?.uid ?? 'anon'}`;

async function fetchUsernames(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'Profiles', uid));
        if (snap.exists()) {
          const data: any = snap.data();
          const uname = (data?.username || data?.displayName || '').toString().trim();
          if (uname) out[uid] = uname;
        }
      } catch {
        /* ignore */
      }
    })
  );
  return out;
}

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMine, setShowMine] = useState<boolean>(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  // Post action menu
  const [menuFor, setMenuFor] = useState<Post | null>(null);

  // My block list
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());

  const router = useRouter();

  // load persisted toggle
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(prefKey());
        if (saved != null) setShowMine(saved === '1');
      } catch {}
    })();
  }, []);

  // persist toggle
  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(prefKey(), showMine ? '1' : '0');
      } catch {}
    })();
  }, [showMine]);

  // subscribe to my block list
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const unsub = onSnapshot(collection(db, 'users', me, 'blocks'), (snap) => {
      const s = new Set<string>();
      snap.forEach((d) => s.add(d.id));
      setBlockedUids(s);
    });
    return unsub;
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        setPosts([]);
        return;
      }

      const meUid = user.uid;
      const friendMap = new Map<string, string>();

      // Friends doc
      try {
        const friendsRef = doc(db, 'Friends', meUid);
        const friendsSnap = await getDoc(friendsRef);
        if (friendsSnap.exists()) {
          const rawFriends = (friendsSnap.data().friends ?? []) as any[];
          rawFriends.forEach((f) => {
            const uid = f?.uid;
            const username = (f?.username || '').toString().trim();
            if (uid) friendMap.set(uid, username || friendMap.get(uid) || '');
          });
        }
      } catch (err) {
        console.error('Error fetching Friends doc:', err);
      }

      // FriendEdges (accepted)
      try {
        const qEdges = query(
          collection(db, 'FriendEdges'),
          where('uids', 'array-contains', meUid),
          where('state', '==', 'accepted')
        );
        const edgeSnap = await getDocs(qEdges);
        edgeSnap.forEach((d) => {
          const arr = (d.data() as any)?.uids || [];
          const other = arr.find((u: string) => u !== meUid);
          if (other) {
            if (!friendMap.has(other)) friendMap.set(other, '');
          }
        });
      } catch (e) {
        console.warn('FriendEdges fetch failed:', e);
      }

      // users/{uid}/friends subcollection
      try {
        const subSnap = await getDocs(collection(db, 'users', meUid, 'friends'));
        subSnap.forEach((d) => {
          const f: any = d.data();
          if (typeof f?.uid === 'string') {
            friendMap.set(
              f.uid,
              (f?.username || '').toString().trim() || friendMap.get(f.uid) || ''
            );
          }
        });
      } catch {}

      // include me
      const authorUids = Array.from(new Set([meUid, ...Array.from(friendMap.keys())]));

      // fill names
      const missingUids = authorUids.filter((u) => (u === meUid ? false : !friendMap.get(u)));
      const fetched = await fetchUsernames([meUid, ...missingUids]);
      const myUsername = fetched[meUid] || 'You';
      Object.entries(fetched).forEach(([uid, uname]) => {
        if (uid !== meUid) friendMap.set(uid, uname || friendMap.get(uid) || '');
      });

      // fetch posts (resilient to individual failures)
      const authorObjs = authorUids.map((uid) => ({
        uid,
        username: uid === meUid ? myUsername : friendMap.get(uid) || 'Friend',
      }));

      const queries = authorObjs.map((a) =>
        getDocs(
          query(
            collection(db, 'Posts'),
            where('author', '==', a.uid),
            orderBy('timestamp', 'desc'),
            limit(50)
          )
        )
      );

      const results = await Promise.allSettled(queries);

      const collected: Post[] = [];
      results.forEach((res, idx) => {
        if (res.status !== 'fulfilled') {
          console.warn('Posts query failed for', authorObjs[idx].uid, res.reason);
          return;
        }
        const snap = res.value;
        const au = authorObjs[idx];
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const rawTs = data.timestamp ?? data.createdAt;
          const createdAt: Date =
            rawTs && typeof rawTs?.toDate === 'function'
              ? rawTs.toDate()
              : rawTs instanceof Date
              ? rawTs
              : typeof rawTs === 'number'
              ? new Date(rawTs)
              : new Date();

          collected.push({
            id: docSnap.id,
            authorUid: au.uid,
            authorUsername: au.username,
            content: data.content ?? '',
            title: data.title ?? '',
            createdAt,
            url: data.url ?? data.link ?? data.href ?? undefined,
          });
        });
      });

      // dedupe + sort
      const seen = new Map<string, Post>();
      collected.forEach((p) => {
        const existing = seen.get(p.id);
        if (!existing || existing.createdAt < p.createdAt) seen.set(p.id, p);
      });
      const uniquePosts = Array.from(seen.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );

      setPosts(uniquePosts);
    } catch (err) {
      console.error('loadFeed fatal error:', err);
      // we still drop the loader in finally
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // live refresh on friends changes
  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    const unsubA = onSnapshot(collection(db, 'users', me, 'friends'), () => loadFeed(), () => {});
    const unsubB = onSnapshot(
      query(collection(db, 'FriendEdges'), where('uids', 'array-contains', me), where('state', '==', 'accepted')),
      () => loadFeed(),
      () => {}
    );
    return () => {
      unsubA();
      unsubB();
    };
  }, [loadFeed]);

  // filter my posts toggle, THEN filter out blocked users
  const displayedPosts = useMemo(() => {
    const me = auth.currentUser?.uid;
    const base = showMine || !me ? posts : posts.filter((p) => p.authorUid !== me);
    if (!blockedUids.size) return base;
    return base.filter((p) => !blockedUids.has(p.authorUid));
  }, [posts, showMine, blockedUids]);

  const handleReport = useCallback(
    async (p: Post) => {
      const me = auth.currentUser?.uid;
      if (!me) return;
      try {
        await addDoc(collection(db, 'Reports'), {
          targetType: 'post',
          targetId: p.id,
          targetOwnerUid: p.authorUid,
          reporterUid: me,
          createdAt: serverTimestamp(),
          status: 'open',
        });
        Alert.alert('Thanks', 'We received your report.');
      } catch (e: any) {
        Alert.alert('Report failed', e?.message ?? 'Try again.');
      }
    },
    []
  );

  const handleBlock = useCallback(
    async (p: Post) => {
      const me = auth.currentUser?.uid;
      if (!me) return;
      if (p.authorUid === me) return;
      try {
        await setDoc(doc(db, 'users', me, 'blocks', p.authorUid), {
          blockedAt: serverTimestamp(),
        });
        Alert.alert('Blocked', 'You will no longer see this user’s content.');
      } catch (e: any) {
        Alert.alert('Block failed', e?.message ?? 'Try again.');
      }
    },
    []
  );

  if (loading) {
    return (
      <>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
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
          keyExtractor={(item) => `${item.id}-${item.createdAt.getTime()}`}
          contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
          renderItem={({ item }) => (
            <Pressable style={styles.postContainer} onPress={() => setSelectedPost(item)}>
              {/* top row: author + menu */}
              <View style={styles.postHeaderRow}>
                <Text style={styles.postAuthor}>{item.authorUsername}</Text>
                <Pressable onPress={() => setMenuFor(item)} hitSlop={10} style={styles.menuBtn}>
                  <Text style={styles.menuDots}>⋯</Text>
                </Pressable>
              </View>

              {item.title ? (
                <Text style={styles.postTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              ) : null}

              {item.url ? (
                <Pressable
                  onPress={() =>
                    Linking.openURL(/^https?:\/\//i.test(item.url!) ? item.url! : `https://${item.url}`)
                  }
                  style={{ marginBottom: 6 }}
                >
                  <Text style={styles.postLink} numberOfLines={1}>
                    {String(item.url).replace(/^https?:\/\//i, '')}
                  </Text>
                </Pressable>
              ) : null}

              <Text style={styles.postContent}>{item.content}</Text>
              <Text style={styles.postDate}>{item.createdAt.toLocaleString()}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
      <BottomBar />

      {/* Comments Modal (tap outside to close) */}
      <Modal
        visible={!!selectedPost}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedPost(null)}
      >
        {selectedPost && <PostComments post={selectedPost} onClose={() => setSelectedPost(null)} />}
      </Modal>

      {/* Post Action Menu */}
      <Modal
        visible={!!menuFor}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                if (menuFor) handleReport(menuFor);
                setMenuFor(null);
              }}
            >
              <Text style={styles.menuText}>Report</Text>
            </Pressable>

            {menuFor && menuFor.authorUid !== auth.currentUser?.uid ? (
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  if (menuFor) handleBlock(menuFor);
                  setMenuFor(null);
                }}
              >
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },

  toggleBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#2F6FED',
  },
  toggleBtnText: { color: '#fff', fontWeight: '800' },

  list: { padding: 16, backgroundColor: '#fff' },
  postContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },

  postHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  menuBtn: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 4 },
  menuDots: { fontSize: 18, color: '#6b7280' },

  postAuthor: { fontWeight: 'bold', marginBottom: 4, color: '#111827' },
  postTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  postLink: { color: '#2F6FED', textDecorationLine: 'underline', fontWeight: '600' },
  postContent: { marginBottom: 8, color: '#111827', marginTop: 4 },
  postDate: { fontSize: 12, color: '#555', textAlign: 'right' },

  menuBackdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  menuRow: { paddingVertical: 14 },
  menuCancel: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#374151' },
  menuText: { color: '#fff', fontSize: 16 },
});
