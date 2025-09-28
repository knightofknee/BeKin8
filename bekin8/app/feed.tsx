// app/feed.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Button,
  Pressable,
  Linking,
} from 'react-native';
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

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  url?: string;
}

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
  const router = useRouter();

  const loadFeed = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const friendMap = new Map<string, string>();

    // A) Friends doc
    try {
      const friendsRef = doc(db, 'Friends', user.uid);
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

    // B) FriendEdges (accepted)
    try {
      const me = user.uid;
      const qEdges = query(
        collection(db, 'FriendEdges'),
        where('uids', 'array-contains', me),
        where('state', '==', 'accepted')
      );
      const edgeSnap = await getDocs(qEdges);
      edgeSnap.forEach((d) => {
        const arr = (d.data() as any)?.uids || [];
        const other = arr.find((u: string) => u !== me);
        if (other) {
          if (!friendMap.has(other)) friendMap.set(other, '');
        }
      });
    } catch (e) {
      console.warn('FriendEdges fetch failed:', e);
    }

    // C) users/{uid}/friends subcollection
    try {
      const subSnap = await getDocs(collection(db, 'users', user.uid, 'friends'));
      subSnap.forEach((d) => {
        const f: any = d.data();
        if (typeof f?.uid === 'string') {
          friendMap.set(
            f.uid,
            (f?.username || '').toString().trim() || friendMap.get(f.uid) || ''
          );
        }
      });
    } catch {
      /* ignore */
    }

    const friendUids = Array.from(friendMap.keys());
    if (!friendUids.length) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const missingUids = friendUids.filter((u) => !friendMap.get(u));
    if (missingUids.length) {
      const fetched = await fetchUsernames(missingUids);
      Object.entries(fetched).forEach(([uid, uname]) => {
        friendMap.set(uid, uname);
      });
    }

    // Fetch posts per friend
    try {
      const friendObjs = friendUids.map((uid) => ({
        uid,
        username: friendMap.get(uid) || 'Friend',
      }));

      const postSnaps = await Promise.all(
        friendObjs.map((f) =>
          getDocs(
            query(
              collection(db, 'Posts'),
              where('author', '==', f.uid),
              orderBy('timestamp', 'desc'),
              limit(50)
            )
          )
        )
      );

      const collected: Post[] = [];
      postSnaps.forEach((snap, idx) => {
        const friend = friendObjs[idx];
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
            authorUid: friend.uid,
            authorUsername: friend.username,
            content: data.content ?? '',
            createdAt,
            url: data.url ?? data.link ?? data.href ?? undefined,
          });
        });
      });

      // Dedup + sort
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

  useEffect(() => {
    setLoading(true);
    loadFeed();
  }, [loadFeed]);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!posts.length) {
    return (
      <View style={styles.center}>
        <Text>No posts from your friends yet.</Text>
        <View style={{ marginTop: 12, width: '60%' }}>
          <Button title="Add Friends" onPress={() => router.push('/friends')} />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(item) => `${item.id}-${item.createdAt.getTime()}`}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.postContainer}>
          <Text style={styles.postAuthor}>{item.authorUsername}</Text>

          {item.url ? (
            <Pressable
              onPress={() =>
                Linking.openURL(
                  /^https?:\/\//i.test(item.url!) ? item.url! : `https://${item.url}`
                )
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
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  list: { padding: 16 },
  postContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  postAuthor: { fontWeight: 'bold', marginBottom: 4 },
  postLink: { color: '#2F6FED', textDecorationLine: 'underline', fontWeight: '600' },
  postContent: { marginBottom: 8 },
  postDate: { fontSize: 12, color: '#555', textAlign: 'right' },
});