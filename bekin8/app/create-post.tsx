// app/create-post.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  getDoc,
  doc,
} from 'firebase/firestore';

export default function CreatePostScreen() {
  const router = useRouter();

  const [username, setUsername] = useState<string>('');
  const [loadingUser, setLoadingUser] = useState(true);

  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const wordCount = useMemo(
    () => (content.trim().length ? content.trim().split(/\s+/).length : 0),
    [content]
  );
  const isCharLimitExceeded = content.length > 10000;

  const [contentHeight, setContentHeight] = useState(160);
  const onContentSizeChange = (e: any) => {
    const h = Math.min(Math.max(e.nativeEvent.contentSize.height, 160), 600);
    setContentHeight(h);
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.replace('/'); // kick to login/home if not signed in
      return;
    }
    const fetchProfile = async () => {
      try {
        const profileRef = doc(db, 'Profiles', user.uid);
        const snap = await getDoc(profileRef);
        if (snap.exists()) {
          const data = snap.data() as any;
          setUsername(data.username ?? '');
        }
      } catch (e) {
        console.error('Error fetching profile:', e);
      } finally {
        setLoadingUser(false);
      }
    };
    fetchProfile();
  }, [router]);

  const handleSubmit = async () => {
    if (submitting) return;

    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to create a post.');
      router.replace('/');
      return;
    }

    // only title + content required
    if (!title.trim() || !content.trim()) {
      Alert.alert('Missing fields', 'Title and content are required.');
      return;
    }

    if (wordCount > 1000) {
      Alert.alert('Limit exceeded', 'Please limit your post to 1000 words.');
      return;
    }

    if (isCharLimitExceeded) {
      Alert.alert('Character limit exceeded', 'Max ~10,000 characters.');
      return;
    }

    setSubmitting(true);

    try {
      // enforce 2 posts per week
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const qRef = query(
        collection(db, 'Posts'),
        where('author', '==', user.uid),
        where('timestamp', '>=', oneWeekAgo),
        orderBy('timestamp', 'asc')
      );
      const snap = await getDocs(qRef);
      if (snap.size > 1) {
        Alert.alert(
          'Posting limit reached',
          'You have already submitted 2 posts in the past week.'
        );
        return;
      }

      const tags = (content.match(/#\w+/g) || []).map((t) => t.slice(0, 50));
      const newPost = {
        title: title.trim(),
        link: link.trim() || null, // optional now
        content,
        author: user.uid,
        authorName: username || null,
        timestamp: Date.now(),
        tags,
      };

      await addDoc(collection(db, 'Posts'), newPost);

      Alert.alert('Success', 'Your post has been created.');
      router.push('/feed');
    } catch (e: any) {
      console.error('Error adding post:', e);
      Alert.alert('Error', e?.message ?? 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingUser) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Create Post</Text>
        <Text style={styles.subtleCenter}>
          You are limited to 2 posts in the past week.
        </Text>

        <View style={styles.form}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            style={styles.input}
          />
          <TextInput
            value={link}
            onChangeText={setLink}
            placeholder="Link (optional)"
            style={styles.input}
            autoCapitalize="none"
          />
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="Content"
            style={[styles.textarea, { height: contentHeight }]}
            multiline
            textAlignVertical="top"
            onContentSizeChange={onContentSizeChange}
          />
          <View style={styles.counterRow}>
            <Text style={styles.counterText}>{wordCount}/1000 words</Text>
            {isCharLimitExceeded && (
              <Text style={styles.counterExceeded}>Character limit exceeded!</Text>
            )}
          </View>
          <View style={styles.submitButton}>
            <Button
              title={submitting ? 'Submitting…' : 'Submit'}
              onPress={handleSubmit}
              disabled={submitting}
            />
          </View>
        </View>

        {/* Only your 2 nav links */}
        <View style={styles.linksRow}>
          <View style={styles.feedButton}>
            <Button title="Go to Feed" onPress={() => router.push('/feed')} />
          </View>
          <View style={styles.feedButton}>
            <Button title="Friends" onPress={() => router.push('/friends')} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  subtleCenter: { textAlign: 'center', opacity: 0.8, marginBottom: 16 },
  form: { gap: 12, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  textarea: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  counterText: { fontSize: 12, opacity: 0.7 },
  counterExceeded: { fontSize: 12, color: 'red' },
  submitButton: { marginTop: 8 },
  linksRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  feedButton: { minWidth: 140 },
});
