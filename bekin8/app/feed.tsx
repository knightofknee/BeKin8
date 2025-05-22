// app/feed.tsx

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { auth, db } from '../firebase.config';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  Timestamp,
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
        setLoading(false);
        return;
      }

      // 1) Fetch friends list (array of { uid, username })
      const friendsRef = doc(db, 'Friends', user.uid);
      let friendObjs: { uid: string; username: string }[] = [];
      try {
        const docSnap = await getDoc(friendsRef);
        if (docSnap.exists()) {
          const data = docSnap.data().friends;
          if (Array.isArray(data)) {
            friendObjs = data.filter(
              (f: any) => f.uid && f.username
            ) as { uid: string; username: string }[];
          }
        }
      } catch (err) {
        console.error('Error fetching friends list:', err);
      }

      const friendUids = friendObjs.map((f) => f.uid);
      if (friendUids.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }

      // 2) Query posts by authorUid in friendUids
      const postsRef = collection(db, 'Posts');
      let aggregated: Post[] = [];

      // Firestore 'in' supports up to 10 values
      const chunks: string[][] = [];
      for (let i = 0; i < friendUids.length; i += 10) {
        chunks.push(friendUids.slice(i, i + 10));
      }

      try {
        for (const chunk of chunks) {
          const q = query(
            postsRef,
            where('authorUid', 'in', chunk),
            orderBy('createdAt', 'desc'),
            limit(50)
          );
          const snap = await getDocs(q);
          snap.docs.forEach((doc) => {
            const data = doc.data();
            // Prefer stored authorUsername, fallback to lookup
            let username = data.authorUsername;
            if (!username) {
              const match = friendObjs.find((f) => f.uid === data.authorUid);
              username = match?.username || 'Unknown';
            }
            aggregated.push({
              id: doc.id,
              authorUid: data.authorUid,
              authorUsername: username,
              content: data.content,
              createdAt: data.createdAt.toDate(),
            });
          });
        }

        // sort aggregated posts by date desc
        aggregated.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setPosts(aggregated);
      } catch (err) {
        console.error('Error loading feed posts:', err);
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

  if (posts.length === 0) {
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
          <Text style={styles.postDate}>{item.createdAt.toLocaleString()}</Text>
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