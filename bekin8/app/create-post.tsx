// app/create-post.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../firebase.config';
import { collection, addDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import BottomBar from '@/components/BottomBar';
import { SCREEN_PAD } from '@/components/ui/layout';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { tap, press } from '../utils/haptics';
import TutorialButton from '../components/tutorial/TutorialButton';
import { buildPostTour } from '../components/tutorial/tourSteps';
import { useTour, useTourTarget } from '../providers/TourProvider';
import { getSeen, setSeen } from '../lib/tutorialFlags';

// BottomBar's row is 64pt; its bottom padding (max(insets.bottom, 8)) is added at the call site.
const BOTTOM_BAR_HEIGHT = 64;
const ACCESSORY_ID_TITLE = 'create-post-accessory-title';
const ACCESSORY_ID_LINK  = 'create-post-accessory-link';
const ACCESSORY_ID_BODY  = 'create-post-accessory-body';
const DRAFT_KEY = '@bekin_post_draft';

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
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bonusPosts, setBonusPosts] = useState<number>(3);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    limited: boolean;
    availableDay: string;
  } | null>(null);
  const [checkingLimit, setCheckingLimit] = useState(true);
  const { startTour } = useTour();
  const limitTarget = useTourTarget('post-limit');
  const bonusTarget = useTourTarget('post-bonus');

  const startPostTour = () => {
    startTour(
      buildPostTour({
        goSettings: () => router.navigate('/settings'),
        goPost: () => router.navigate('/create-post'),
      })
    );
  };

  // Auto-show the post tour the first time this screen is focused (once). BottomBar exposes no
  // tab-press event, so focus is the right trigger.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const seen = await getSeen('post');
        if (active && !seen) {
          setSeen('post');
          startPostTour();
        }
      })();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

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

  // ── Load draft from disk ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.title) setTitle(d.title);
          if (d.link) setLink(d.link);
          if (d.content) setContent(d.content);
        }
      } catch {}
      setDraftLoaded(true);
    })();
  }, []);

  // ── Auto-save draft on every change ─────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftLoaded) return;                // don't save before we've loaded
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ title, link, content })).catch(() => {});
    }, 400);                                  // debounce 400ms
  }, [title, link, content, draftLoaded]);

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

  // Minimal URL plausibility check: must look like "something.tld[…]" with no
  // whitespace, where the TLD-ish part is at least 2 chars. Doesn't require a
  // protocol, a user can type "example.com" or "https://example.com/path".
  const PLAUSIBLE_URL = /^[^\s]+\.[^\s]{2,}$/;

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
    const trimmedLink = link.trim();
    if (trimmedLink && !PLAUSIBLE_URL.test(trimmedLink)) {
      Alert.alert('Invalid link', 'That doesn’t look like a URL. Try something like example.com or https://example.com.');
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
    // Trim content so whitespace-only padding doesn't end up persisted.
    const trimmedContent = content.trim();
    const tags = (trimmedContent.match(/#\w+/g) || []).map((t) => t.slice(0, 50));
    const ref = await addDoc(collection(db, 'Posts'), {
      title: title.trim(),
      link: link.trim() || null,
      content: trimmedContent,
      author: user.uid,
      authorName: profile?.username || null,
      // Client clock can be skewed, which hides or misorders posts in the feed.
      // timestampServer is authoritative, numeric timestamp stays as a fallback for
      // old docs and for optimistic ordering before the server value resolves.
      timestamp: Date.now(),
      timestampServer: serverTimestamp(),
      tags,
    });
    await AsyncStorage.removeItem(DRAFT_KEY);
    setTitle('');
    setLink('');
    setContent('');
    Alert.alert('Posted!', 'Your post is live.');
    // Land on the feed scrolled to the just-created post. The feed reads scrollToPostId
    // and forces "show mine" on, so the user's own post isn't hidden by the default filter.
    router.push({ pathname: '/feed', params: { scrollToPostId: ref.id } });
  };

  // ── Normal submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    press();
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
        // rate_limited: UI already shows state, just return silently
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
    press();
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
        } else if (data.reason === 'rate_limited') {
          Alert.alert('Not available yet', 'Your next free post isn’t available yet.');
        } else {
          Alert.alert('Could not post', 'Please try again in a moment.');
        }
        return;
      }
      // The bonus is consumed server-side by the check above. If the write now fails,
      // do NOT fall through silently, tell the user their draft was kept so they can retry.
      await writePost();
    } catch (e: any) {
      Alert.alert('Post not saved', (e?.message ?? 'Could not create post.') + ' Your draft is still here, please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state, only wait for profile, not rate-limit check ──────────
  if (!profileLoaded) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isLimited = rateLimitInfo?.limited ?? false;
  const availableDay = rateLimitInfo?.availableDay ?? '';
  // Clear the REAL BottomBar height (64 + its inset-aware padding) plus a visible gap, so the
  // Post button never sits flush against the tab bar.
  const bottomPadding = BOTTOM_BAR_HEIGHT + Math.max(insets.bottom, 8) + 16;

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
            <View style={styles.headerRow}>
              <Text style={[styles.h1, { color: colors.text }]}>New Post</Text>
              <TutorialButton onPress={startPostTour} style={styles.headerHelp} />
            </View>
            <View ref={limitTarget} collapsable={false}>
            <Text style={[styles.rateNote, { color: colors.subtle }]}>
              1 post every other day · Bank up to 3 bonus posts by taking days off
            </Text>
            </View>

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

              {/* Metadata row: quiet counters above the CTA (word count left, bonus inventory
                  right), so the primary button below stays full-width and centered. */}
              <View style={styles.counterRow}>
                <View>
                  <Text style={[styles.counterText, { color: counterColor }]}>
                    {wordCount} / 1000 words
                  </Text>
                  {isCharLimitExceeded && (
                    <Text style={[styles.counterExceeded, { color: colors.error }]}>Character limit exceeded</Text>
                  )}
                </View>
                <View ref={bonusTarget} collapsable={false} style={[styles.bonusPill, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
                  <Text style={[styles.bonusCount, { color: colors.primary }]}>{bonusPosts}</Text>
                  <Text style={[styles.bonusLabel, { color: colors.subtle }]}>
                    {bonusPosts === 1 ? 'bonus post' : 'bonus posts'}
                  </Text>
                </View>
              </View>

              {/* Primary action: full-width, centered, nothing riding beside it. */}
              <Pressable
                onPress={handleSubmit}
                disabled={submitting || isLimited || checkingLimit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  { backgroundColor: colors.primary, shadowColor: colors.primary },
                  (submitting || isLimited || checkingLimit) && [styles.submitBtnDisabled, { backgroundColor: colors.border }],
                  pressed && !isLimited && !checkingLimit && { opacity: 0.88 },
                ]}
              >
                {submitting || checkingLimit
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.submitTxt}>Post</Text>
                }
              </Pressable>

              {/* Available day message when rate-limited */}
              {isLimited && (
                <Text style={[styles.availableText, { color: colors.subtle }]}>
                  Next free post available: {availableDay}
                </Text>
              )}

              {/* Bonus post button, shown when rate-limited */}
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

      {/* iOS Done bar, one per field */}
      {Platform.OS === 'ios' && (
        <>
          <InputAccessoryView nativeID={ACCESSORY_ID_TITLE}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => { tap(); Keyboard.dismiss(); }} hitSlop={10}>
                <Text style={[styles.iosDone, { color: colors.primary }]}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_LINK}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => { tap(); Keyboard.dismiss(); }} hitSlop={10}>
                <Text style={[styles.iosDone, { color: colors.primary }]}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={ACCESSORY_ID_BODY}>
            <View style={[styles.iosAccessory, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <Pressable onPress={() => { tap(); Keyboard.dismiss(); }} hitSlop={10}>
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
  container:   { padding: SCREEN_PAD },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  h1:          { fontSize: 26, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  headerRow:   { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  headerHelp:  { position: 'absolute', right: 0, top: 2 },
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

  // ── submit ──
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
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

  // ── bonus pill (always visible, in the metadata row; also the post-tour's spotlight target) ──
  bonusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bonusCount: {
    fontSize: 15,
    fontWeight: '800',
  },
  bonusLabel: {
    fontSize: 12,
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
