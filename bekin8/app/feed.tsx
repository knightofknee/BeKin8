// app/feed.tsx

import React, { useState, useEffect } from 'react';
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
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from 'firebase/firestore';
import { useRouter } from 'expo-router';

/**
 * Post structure returned from Firestore
 */
interface Post {
  id: string; // Firestore document id (unique per post)
  authorUid: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  url?: string; // <-- added
}

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  useEffect(() => {
    /**
     * Loads the authenticated user’s feed once on mount.
     *
     * Steps:
     * 1. Grab friend UIDs
     * 2. Fetch latest posts per friend (batched promises)
     * 3. Flatten + deduplicate by post.id (and timestamp as fallback)
     * 4. Sort descending by createdAt
     */
    const loadFeed = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      // === 1. Resolve friend list ===
      const friendsRef = doc(db, 'Friends', user.uid);
      let friendObjs: { uid: string; username: string }[] = [];
      try {
        const friendsSnap = await getDoc(friendsRef);
        if (friendsSnap.exists()) {
          const rawFriends = friendsSnap.data().friends ?? [];
          // Keep {uid, username} pairs; filter out malformed entries
          friendObjs = (rawFriends as any[])
            .filter((f) => f?.uid && f?.username)
            // Unique by uid
            .reduce((acc, f) => {
              if (!acc.find((x: { uid: any }) => x.uid === f.uid))
                acc.push({ uid: f.uid, username: f.username });
              return acc;
            }, [] as { uid: string; username: string }[]);
        }
      } catch (err) {
        console.error('Error fetching friends list:', err);
      }

      if (!friendObjs.length) {
        setPosts([]);
        setLoading(false);
        return;
      }

      // === 2. Fetch posts for each friend ===
      try {
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
              url: data.url ?? data.link ?? data.href ?? undefined, // <-- added
            });
          });
        });

        // === 3. Deduplicate ===
        const seen = new Map<string, Post>();
        collected.forEach((p) => {
          // Keep the newest version of a post id (if duplicates slipped through)
          const existing = seen.get(p.id);
          if (!existing || existing.createdAt < p.createdAt) seen.set(p.id, p);
        });
        const uniquePosts = Array.from(seen.values());

        // === 4. Sort ===
        uniquePosts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setPosts(uniquePosts);
      } catch (err) {
        console.error('Error loading posts:', err);
      } finally {
        setLoading(false);
      }
    };

    loadFeed();
  }, []);

  // === RENDER STATES ===
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!posts.length) {
    return (
      <>
        <View style={styles.center}>
          <Text>No posts from your friends yet.</Text>
        </View>
        <View style={styles.feedButton}>
          <Button title="Add Friends" onPress={() => router.push('/friends')} />
        </View>
      </>
    );
  }

  return (
    <FlatList
      data={posts}
      // Combines Firestore id (guaranteed unique) with createdAt in case the same id appears twice in different timelines
      keyExtractor={(item) => `${item.id}-${item.createdAt.getTime()}`}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.postContainer}>
          <Text style={styles.postAuthor}>{item.authorUsername}</Text>

          {/* URL (above text, below name). No validation; adds https:// if missing. */}
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

// === STYLES ===
const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 16,
  },
  postContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  postAuthor: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  postLink: {
    color: '#2F6FED',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  postContent: {
    marginBottom: 8,
  },
  postDate: {
    fontSize: 12,
    color: '#555',
    textAlign: 'right',
  },
  feedButton: {
    marginTop: 24,
    width: '60%',
  },
});