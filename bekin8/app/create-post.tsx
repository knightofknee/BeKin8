// app/create-post.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  Animated,
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
} from 'firebase/firestore';
import BottomBar from '@/components/BottomBar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';

const BOTTOM_BAR_HEIGHT = 56;
const ACCESSORY_ID_TITLE = 'create-post-accessory-title';
const ACCESSORY_ID_LINK  = 'create-post-accessory-link';
const ACCESSORY_ID_BODY  = 'create-post-accessory-body';

const BLUE = '#2F6FED';

// ─── Floating-label field ───────────────────────────────────────────────────
type FloatFieldProps = TextInputProps & {
  label: string;
  value: string;
  accessoryID?: string;
  fieldStyle?: object;
};

function FloatField({ label, value, accessoryID, fieldStyle, ...rest }: FloatFieldProps) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  const floated = focused || !!value;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: floated ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [floated]);

  const labelTop  = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 6] });
  const labelSize = anim.interpolate({ inputRange: [0, 1], outputRange: [16, 11] });
  const labelColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#9CA3AF', focused ? BLUE : '#6B7280'],
  });
  const borderColor = focused ? BLUE : '#D1D5DB';

  return (
    <View style={[styles.floatWrap, { borderColor }, fieldStyle]}>
      <Animated.Text
        style={[styles.floatLabel, { top: labelTop, fontSize: labelSize, color: labelColor }]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
      <TextInput
        {...rest}
        value={value}
        style={[styles.floatInput, rest.multiline && styles.floatInputMulti]}
        placeholderTextColor="transparent"
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e)  => { setFocused(false); rest.onBlur?.(e); }}
      />
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, profileLoaded } = useAuth();

  const [title, setTitle]         = useState('');
  const [link, setLink]           = useState('');
  const [content, setContent]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const wordCount = useMemo(
    () => (content.trim().length ? content.trim().split(/\s+/).length : 0),
    [content]
  );
  const isCharLimitExceeded = content.length > 10000;

  // word-count colour: grey → amber → red
  const counterColor =
    wordCount > 950 ? '#EF4444' :
    wordCount > 800 ? '#F59E0B' :
    '#9CA3AF';

  useEffect(() => {
    if (!auth.currentUser) router.replace('/');
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
        Alert.alert('Posting limit reached', 'You can submit 2 posts per week.');
        return;
      }
      const tags = (content.match(/#\w+/g) || []).map((t) => t.slice(0, 50));
      await addDoc(collection(db, 'Posts'), {
        title: title.trim(),
        link: link.trim() || null,
        content,
        author: user.uid,
        authorName: profile?.username || null,
        timestamp: Date.now(),
        tags,
      });
      Alert.alert('Posted!', 'Your post is live.');
      router.push('/feed');
    } catch (e: any) {
      console.error('Error adding post:', e);
      Alert.alert('Error', e?.message ?? 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!profileLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BLUE} />
      </View>
    );
  }

  const bottomPadding = BOTTOM_BAR_HEIGHT + insets.bottom + 16;

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.container, { paddingBottom: bottomPadding, flexGrow: 1 }]}
          >
            {/* Header */}
            <Text style={styles.h1}>New Post</Text>
            <Text style={styles.rateNote}>You are limited to 1 post every other day max. Share what you care about.</Text>

            <View style={[styles.form, { flex: 1 }]}>
              <FloatField
                label="Title"
                value={title}
                onChangeText={setTitle}
                returnKeyType="next"
                maxLength={150}
                accessoryID={ACCESSORY_ID_TITLE}
              />

              <FloatField
                label="Link  (optional)"
                value={link}
                onChangeText={setLink}
                autoCapitalize="none"
                keyboardType="url"
                returnKeyType="next"
                maxLength={500}
                accessoryID={ACCESSORY_ID_LINK}
              />

              <FloatField
                label="Content"
                value={content}
                onChangeText={setContent}
                multiline
                textAlignVertical="top"
                autoCorrect
                autoCapitalize="sentences"
                returnKeyType="done"
                blurOnSubmit={false}
                accessoryID={ACCESSORY_ID_BODY}
                fieldStyle={{ flex: 1, minHeight: 260 }}
              />

              {/* word counter */}
              <View style={styles.counterRow}>
                <Text style={[styles.counterText, { color: counterColor }]}>
                  {wordCount} / 1000 words
                </Text>
                {isCharLimitExceeded && (
                  <Text style={styles.counterExceeded}>Character limit exceeded</Text>
                )}
              </View>

              {/* Submit */}
              <Pressable
                onPress={handleSubmit}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && { opacity: 0.88 },
                  submitting && { opacity: 0.6 },
                ]}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.submitTxt}>Post</Text>
                }
              </Pressable>
            </View>
          </ScrollView>

          <BottomBar />
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* iOS Done bar — one per field */}
      {Platform.OS === 'ios' && (
        <>
          <InputAccessoryView nativeID={ACCESSORY_ID_TITLE}>
            <View style={styles.iosAccessory}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={styles.iosDone}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_LINK}>
            <View style={styles.iosAccessory}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={styles.iosDone}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_BODY}>
            <View style={styles.iosAccessory}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={styles.iosDone}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container:   { padding: 20 },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  h1:          { fontSize: 26, fontWeight: '700', color: '#111827', marginBottom: 4, textAlign: 'center' },
  rateNote:    { fontSize: 13, color: '#9CA3AF', marginBottom: 20, textAlign: 'center' },

  form:        { gap: 16 },

  // ── floating label field ──
  floatWrap: {
    borderWidth: 1.5,
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 14,
    paddingTop: 22,
    paddingBottom: 10,
    position: 'relative',
  },
  floatLabel: {
    position: 'absolute',
    left: 14,
    fontWeight: '500',
  },
  floatInput: {
    fontSize: 16,
    color: '#111827',
    padding: 0,
    margin: 0,
  },
  floatInputMulti: {
    minHeight: 200,
    textAlignVertical: 'top',
  },

  // ── counter ──
  counterRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counterText:     { fontSize: 12, fontWeight: '500' },
  counterExceeded: { fontSize: 12, color: '#EF4444', fontWeight: '600' },

  // ── submit ──
  submitBtn: {
    backgroundColor: BLUE,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: BLUE,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitTxt: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── iOS accessory ──
  iosAccessory: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  iosDone: {
    fontSize: 16,
    fontWeight: '600',
    color: BLUE,
  },
});
