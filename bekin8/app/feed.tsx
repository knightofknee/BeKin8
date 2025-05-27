// app/feed.tsx

import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
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

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
}

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadFeed = async () => {
      const user = auth.currentUser;
      if (!user) {
        console.log('No authenticated user');
        setLoading(false);
        return;
      }

      // 1) Fetch friends list
      const friendsRef = doc(db, 'Friends', user.uid);
      let friendObjs: { uid: string; username: string }[] = [];
      try {
        const friendsSnap = await getDoc(friendsRef);
        if (friendsSnap.exists()) {
          const data = friendsSnap.data().friends;
          if (Array.isArray(data)) {
            friendObjs = data.filter(
              (f: any) => f.uid && f.username
            ) as { uid: string; username: string }[];
          }
        }
        console.log('Loaded friends:', friendObjs);
      } catch (err) {
        console.error('Error fetching friends list:', err);
      }

      if (!friendObjs.length) {
        console.log('No friends to load posts for');
        setPosts([]);
        setLoading(false);
        return;
      }

      // 2) Fetch and aggregate posts
      try {
        const snapshots = await Promise.all(
          friendObjs.map((friend) =>
            getDocs(
              query(
                collection(db, 'Posts'),
                where('author', '==', friend.uid),
                orderBy('timestamp', 'desc'),
                limit(50)
              )
            )
          )
        );

        const allPosts: Post[] = snapshots.flatMap((snap) =>
          snap.docs.map((d) => {
            const data = d.data();
            const authorUid = data.author ?? data.authorUid;
            const authorUsername =
              data.authorUsername ||
              friendObjs.find((f) => f.uid === authorUid)?.username ||
              'Unknown';

            // Normalize timestamp
            const rawTs = data.timestamp ?? data.createdAt;
            let createdAt: Date;
            if (rawTs && typeof rawTs.toDate === 'function') {
              createdAt = rawTs.toDate();
            } else if (rawTs instanceof Date) {
              createdAt = rawTs;
            } else if (typeof rawTs === 'number') {
              createdAt = new Date(rawTs);
            } else {
              createdAt = new Date();
            }

            return {
              id: d.id,
              authorUid,
              authorUsername,
              content: data.content,
              createdAt,
            };
          })
        );

        // 3) Sort by date desc
        allPosts.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );
        console.log('Aggregated posts count:', allPosts.length);
        setPosts(allPosts);
      } catch (err) {
        console.error('Error loading friend posts:', err);
      } finally {
        setLoading(false);
      }
    };

    loadFeed();
  }, []);

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
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.postContainer}>
          <Text style={styles.postAuthor}>{item.authorUsername}</Text>
          <Text style={styles.postContent}>{item.content}</Text>
          <Text style={styles.postDate}>
            {item.createdAt.toLocaleString()}
          </Text>
        </View>
      )}
    />
  );
}

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
  postContent: {
    marginBottom: 8,
  },
  postDate: {
    fontSize: 12,
    color: '#555',
    textAlign: 'right',
  },
});
