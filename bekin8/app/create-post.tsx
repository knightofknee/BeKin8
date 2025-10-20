// app/create-post.tsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
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
  InputAccessoryView,
  Keyboard,
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
import BottomBar from '@/components/BottomBar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const BOTTOM_BAR_HEIGHT = 56;
const ACCESSORY_ID = 'create-post-accessory';

export default function CreatePostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [loadingUser, setLoadingUser] = useState(true);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const visibilityTimeout = useRef<NodeJS.Timeout | null>(null);

  const wordCount = useMemo(
    () => (content.trim().length ? content.trim().split(/\s+/).length : 0),
    [content]
  );
  const isCharLimitExceeded = content.length > 10000;

  // keyboard visibility tracking (prevents Done bar when keyboard isn't actually shown)
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      if (visibilityTimeout.current) clearTimeout(visibilityTimeout.current);
      visibilityTimeout.current = setTimeout(() => setKeyboardVisible(true), 40);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      if (visibilityTimeout.current) clearTimeout(visibilityTimeout.current);
      visibilityTimeout.current = setTimeout(() => setKeyboardVisible(false), 40);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      if (visibilityTimeout.current) clearTimeout(visibilityTimeout.current);
    };
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.replace('/');
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'Profiles', user.uid));
        if (snap.exists()) setUsername((snap.data() as any).username ?? '');
      } catch (e) {
        console.error('Error fetching profile:', e);
      } finally {
        setLoadingUser(false);
      }
    })();
  }, [router]);

  const handleSubmit = async () => {
    if (submitting) return;

    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to create a post.');
      router.replace('/');
      return;
    }

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
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const qRef = query(
        collection(db, 'Posts'),
        where('author', '==', user.uid),
        where('timestamp', '>=', oneWeekAgo),
        orderBy('timestamp', 'asc')
      );
      const snap = await getDocs(qRef);
      if (snap.size > 1) {
        Alert.alert('Posting limit reached', 'You have already submitted 2 posts in the past week.');
        return;
      }

      const tags = (content.match(/#\w+/g) || []).map((t) => t.slice(0, 50));
      await addDoc(collection(db, 'Posts'), {
        title: title.trim(),
        link: link.trim() || null,
        content,
        author: user.uid,
        authorName: username || null,
        timestamp: Date.now(),
        tags,
      });

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

  // Keep this a touch bigger than the bar + safe inset so the button never gets overlapped
  const bottomPadding = BOTTOM_BAR_HEIGHT + insets.bottom + 16;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.container, { paddingBottom: bottomPadding, flexGrow: 1 }]}
        >
          <Text style={styles.h1}>Create Post</Text>
          <Text style={styles.subtleCenter}>You are limited to 2 posts in the past week.</Text>

          <View style={[styles.form, { flex: 1 }]}>
            {/* TITLE */}
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor="#6B7280"
              style={styles.input}
              returnKeyType="next"
              onFocus={() => setKeyboardVisible(true)}
              onBlur={() => setKeyboardVisible(false)}
              inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
            />

            {/* LINK */}
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Link (optional)"
              placeholderTextColor="#6B7280"
              style={styles.input}
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="next"
              onFocus={() => setKeyboardVisible(true)}
              onBlur={() => setKeyboardVisible(false)}
              inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
            />

            {/* CONTENT */}
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="Content"
              placeholderTextColor="#6B7280"
              numberOfLines={12}
              style={styles.textarea}
              multiline
              textAlignVertical="top"
              autoCorrect
              autoCapitalize="sentences"
              returnKeyType="done"
              blurOnSubmit={false}
              onFocus={() => setKeyboardVisible(true)}
              onBlur={() => setKeyboardVisible(false)}
              inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
            />

            <View style={styles.counterRow}>
              <Text style={styles.counterText}>{wordCount}/1000 words</Text>
              {isCharLimitExceeded && (
                <Text style={styles.counterExceeded}>Character limit exceeded!</Text>
              )}
            </View>

            <View style={[styles.submitButton, { marginBottom: 12 }]}>
              <Button
                title={submitting ? 'Submitting…' : 'Submit'}
                onPress={handleSubmit}
                disabled={submitting}
              />
            </View>
          </View>
        </ScrollView>

        <BottomBar />
      </KeyboardAvoidingView>

      {/* iOS Done bar for ALL fields — only when keyboard is visible */}
      {Platform.OS === 'ios' && keyboardVisible && (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
          <View style={styles.iosAccessory}>
            <Button title="Done" color="#007AFF" onPress={() => Keyboard.dismiss()} />
          </View>
        </InputAccessoryView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  h1: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  subtleCenter: { textAlign: 'center', opacity: 0.8, marginBottom: 12 },

  form: { gap: 12, marginBottom: 0 },

  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    paddingTop: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },

  textarea: {
    flex: 1,
    minHeight: 320,
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

  // iOS accessory (right-aligned Done)
  iosAccessory: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
});