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
import { collection, addDoc, doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import BottomBar from '@/components/BottomBar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';

const BOTTOM_BAR_HEIGHT = 56;
const ACCESSORY_ID_TITLE = 'create-post-accessory-title';
const ACCESSORY_ID_LINK  = 'create-post-accessory-link';
const ACCESSORY_ID_BODY  = 'create-post-accessory-body';

// ─── Floating-label field ───────────────────────────────────────────────────
type FloatFieldProps = TextInputProps & {
  label: string;
  value: string;
  accessoryID?: string;
  fieldStyle?: object;
  themeColors?: { primary: string; subtle: string; text: string; border: string; inputBg: string };
};

function FloatField({ label, value, accessoryID, fieldStyle, themeColors, ...rest }: FloatFieldProps) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const PRIMARY = themeColors?.primary ?? '#2F6FED';
  const SUBTLE = themeColors?.subtle ?? '#9CA3AF';
  const TEXT = themeColors?.text ?? '#111827';
  const BORDER = themeColors?.border ?? '#D1D5DB';
  const INPUT_BG = themeColors?.inputBg ?? '#FAFAFA';

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
    outputRange: [SUBTLE, focused ? PRIMARY : SUBTLE],
  });
  const borderColor = focused ? PRIMARY : BORDER;

  return (
    <View style={[styles.floatWrap, { borderColor, backgroundColor: INPUT_BG }, fieldStyle]}>
      <Animated.Text
        style={[styles.floatLabel, { top: labelTop, fontSize: labelSize, color: labelColor }]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
      <TextInput
        {...rest}
        value={value}
        style={[styles.floatInput, { color: TEXT }, rest.multiline && styles.floatInputMulti]}
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
  const { colors } = useTheme();

  const [title, setTitle]           = useState('');
  const [link, setLink]             = useState('');
  const [content, setContent]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bonusPosts, setBonusPosts] = useState<number>(3);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    limited: boolean;
    availableDay: string;
  } | null>(null);
  const [checkingLimit, setCheckingLimit] = useState(true);

  const functions = getFunctions();
  const checkPostAllowed = httpsCallable<{ useBonus: boolean }, { allowed: boolean; reason?: string; availableDay?: string }>(
    functions,
    'checkPostAllowed'
  );

  const wordCount = useMemo(
    () => (content.trim().length ? content.trim().split(/\s+/).length : 0),
    [content]
  );
  const isCharLimitExceeded = content.length > 10000;

  // word-count colour: grey → amber → red
  const counterColor =
    wordCount > 950 ? colors.error :
    wordCount > 800 ? '#F59E0B' :
    colors.subtle;

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!auth.currentUser) router.replace('/');
  }, [router]);

  // ── Live bonus-post count ─────────────────────────────────────────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) {
        const val = (snap.data() as any)?.bonusPosts;
        setBonusPosts(typeof val === 'number' ? val : 3);
      }
    });
    return unsub;
  }, []);

  // ── Initial rate-limit check ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await checkPostAllowed({ useBonus: false });
        if (cancelled) return;
        const data = result.data;
        if (!data.allowed && data.reason === 'rate_limited') {
          setRateLimitInfo({ limited: true, availableDay: data.availableDay ?? 'Soon' });
        } else {
          setRateLimitInfo({ limited: false, availableDay: '' });
        }
      } catch {
        if (!cancelled) setRateLimitInfo({ limited: false, availableDay: '' });
      } finally {
        if (!cancelled) setCheckingLimit(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Field validation (shared) ─────────────────────────────────────────────
  const validateFields = (): boolean => {
    if (!title.trim() || !content.trim()) {
      Alert.alert('Missing fields', 'Title and content are required.');
      return false;
    }
    if (wordCount > 1000) {
      Alert.alert('Limit exceeded', 'Please limit your post to 1000 words.');
      return false;
    }
    if (isCharLimitExceeded) {
      Alert.alert('Character limit exceeded', 'Max ~10,000 characters.');
      return false;
    }
    return true;
  };

  // ── Write post to Firestore ───────────────────────────────────────────────
  const writePost = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to create a post.');
      router.replace('/');
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
  };

  // ── Normal submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (submitting) return;
    if (!auth.currentUser) { router.replace('/'); return; }
    if (!validateFields()) return;

    setSubmitting(true);
    try {
      const result = await checkPostAllowed({ useBonus: false });
      const data = result.data;
      if (!data.allowed) {
        if (data.reason === 'daily_cap') {
          Alert.alert('Daily limit reached', 'You can post up to 5 times per day.');
        }
        // rate_limited: UI already shows state — just return silently
        return;
      }
      await writePost();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Bonus submit ──────────────────────────────────────────────────────────
  const handleBonusSubmit = async () => {
    if (submitting) return;
    if (!auth.currentUser) { router.replace('/'); return; }
    if (!validateFields()) return;

    setSubmitting(true);
    try {
      const result = await checkPostAllowed({ useBonus: true });
      const data = result.data;
      if (!data.allowed) {
        if (data.reason === 'no_bonus') {
          Alert.alert('No bonus posts', 'You have no bonus posts remaining.');
        } else if (data.reason === 'daily_cap') {
          Alert.alert('Daily limit reached', 'You can post up to 5 times per day.');
        }
        return;
      }
      await writePost();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading states ────────────────────────────────────────────────────────
  if (!profileLoaded || checkingLimit) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isLimited = rateLimitInfo?.limited ?? false;
  const availableDay = rateLimitInfo?.availableDay ?? '';
  const bottomPadding = BOTTOM_BAR_HEIGHT + insets.bottom + 16;

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.container, { paddingBottom: bottomPadding, flexGrow: 1 }]}
          >
            {/* Header */}
            <Text style={[styles.h1, { color: colors.text }]}>New Post</Text>
            <Text style={[styles.rateNote, { color: colors.subtle }]}>
              1 post per day max · Bank up to 10 bonus posts by taking days off
            </Text>

            <View style={[styles.form, { flex: 1 }]}>
              <FloatField
                label="Title"
                value={title}
                onChangeText={setTitle}
                returnKeyType="next"
                maxLength={150}
                accessoryID={ACCESSORY_ID_TITLE}
                themeColors={{ primary: colors.primary, subtle: colors.subtle, text: colors.text, border: colors.border, inputBg: colors.inputBg }}
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
                themeColors={{ primary: colors.primary, subtle: colors.subtle, text: colors.text, border: colors.border, inputBg: colors.inputBg }}
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
                themeColors={{ primary: colors.primary, subtle: colors.subtle, text: colors.text, border: colors.border, inputBg: colors.inputBg }}
              />

              {/* word counter */}
              <View style={styles.counterRow}>
                <Text style={[styles.counterText, { color: counterColor }]}>
                  {wordCount} / 1000 words
                </Text>
                {isCharLimitExceeded && (
                  <Text style={[styles.counterExceeded, { color: colors.error }]}>Character limit exceeded</Text>
                )}
              </View>

              {/* Submit row */}
              <View style={styles.submitRow}>
                {/* Post button */}
                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting || isLimited}
                  style={({ pressed }) => [
                    styles.submitBtn,
                    styles.submitBtnFlex,
                    { backgroundColor: colors.primary, shadowColor: colors.primary },
                    (submitting || isLimited) && [styles.submitBtnDisabled, { backgroundColor: colors.border }],
                    pressed && !isLimited && { opacity: 0.88 },
                  ]}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.submitTxt}>Post</Text>
                  }
                </Pressable>

                {/* Bonus count badge */}
                <View style={styles.bonusBadge}>
                  <Text style={[styles.bonusCount, { color: colors.primary }]}>{bonusPosts}</Text>
                  <Text style={[styles.bonusLabel, { color: colors.subtle }]}>bonus</Text>
                </View>
              </View>

              {/* Available day message when rate-limited */}
              {isLimited && (
                <Text style={[styles.availableText, { color: colors.subtle }]}>
                  Next free post available: {availableDay}
                </Text>
              )}

              {/* Bonus post button — shown when rate-limited */}
              {isLimited && (
                <Pressable
                  onPress={handleBonusSubmit}
                  disabled={submitting || bonusPosts <= 0}
                  style={({ pressed }) => [
                    styles.bonusBtn,
                    { borderColor: colors.primary },
                    (submitting || bonusPosts <= 0) && { borderColor: colors.border },
                    pressed && bonusPosts > 0 && { opacity: 0.88 },
                  ]}
                >
                  {submitting
                    ? <ActivityIndicator color={colors.primary} />
                    : (
                      <Text style={[styles.bonusBtnTxt, { color: colors.primary }, bonusPosts <= 0 && { color: colors.subtle }]}>
                        Use Bonus Post
                      </Text>
                    )
                  }
                </Pressable>
              )}
            </View>
          </ScrollView>

        </KeyboardAvoidingView>

        <BottomBar />
      </SafeAreaView>

      {/* iOS Done bar — one per field */}
      {Platform.OS === 'ios' && (
        <>
          <InputAccessoryView nativeID={ACCESSORY_ID_TITLE}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={[styles.iosDone, { color: colors.primary }]}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_LINK}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={[styles.iosDone, { color: colors.primary }]}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_BODY}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                <Text style={[styles.iosDone, { color: colors.primary }]}>Done</Text>
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

  h1:          { fontSize: 26, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  rateNote:    { fontSize: 13, marginBottom: 20, textAlign: 'center' },

  form:        { gap: 16 },

  // ── floating label field ──
  floatWrap: {
    borderWidth: 1.5,
    borderRadius: 12,
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
  counterExceeded: { fontSize: 12, fontWeight: '600' },

  // ── submit row ──
  submitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  submitBtnFlex: {
    flex: 1,
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitBtnDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  submitTxt: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── bonus badge (always visible) ──
  bonusBadge: {
    alignItems: 'center',
    minWidth: 44,
  },
  bonusCount: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  bonusLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  // ── available day message ──
  availableText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: -4,
  },

  // ── bonus post button ──
  bonusBtn: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  bonusBtnTxt: {
    fontSize: 16,
    fontWeight: '600',
  },

  // ── iOS accessory ──
  iosAccessory: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  iosDone: {
    fontSize: 16,
    fontWeight: '600',
  },
});
