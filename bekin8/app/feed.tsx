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
      } catch { /* ignore */ }
    })
  );
  return out;
}

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showMine, setShowMine] = useState<boolean>(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
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

  const loadFeed = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setPosts([]);
      setLoading(false);
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
    const authorUids = Array.from(new Set<string>([meUid, ...Array.from(friendMap.keys())]));

    // fill names
    const missingUids = authorUids.filter((u) => (u === meUid ? false : !friendMap.get(u)));
    const fetched = await fetchUsernames([meUid, ...missingUids]);
    const myUsername = fetched[meUid] || 'You';
    Object.entries(fetched).forEach(([uid, uname]) => {
      if (uid !== meUid) friendMap.set(uid, uname || friendMap.get(uid) || '');
    });

    // fetch posts
    try {
      const authorObjs = authorUids.map((uid) => ({
        uid,
        username: uid === meUid ? myUsername : friendMap.get(uid) || 'Friend',
      }));

      const postSnaps = await Promise.all(
        authorObjs.map((a) =>
          getDocs(
            query(
              collection(db, 'Posts'),
              where('author', '==', a.uid),
              orderBy('timestamp', 'desc'),
              limit(50)
            )
          )
        )
      );

      const collected: Post[] = [];
      postSnaps.forEach((snap, idx) => {
        const au = authorObjs[idx];
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const rawTs = data.timestamp ?? data.createdAt;
          const createdAt: Date =
            rawTs && typeof rawTs.toDate === 'function'
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
      console.error('Error loading posts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    setLoading(true);
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

  // filter my posts
  const displayedPosts = useMemo(() => {
    const me = auth.currentUser?.uid;
    if (!me) return posts;
    return showMine ? posts : posts.filter((p) => p.authorUid !== me);
  }, [posts, showMine]);

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
              <Text style={styles.postAuthor}>{item.authorUsername}</Text>

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
        {selectedPost && (
          <PostComments post={selectedPost} onClose={() => setSelectedPost(null)} />
        )}
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },

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
  postAuthor: { fontWeight: 'bold', marginBottom: 4, color: '#111827' },
  postLink: { color: '#2F6FED', textDecorationLine: 'underline', fontWeight: '600' },
  postContent: { marginBottom: 8, color: '#111827' },
  postDate: { fontSize: 12, color: '#555', textAlign: 'right' },
});