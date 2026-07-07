// app/signup.tsx
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  InputAccessoryView,
} from "react-native";
import { useRouter, Link } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../firebase.config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { statusCodes } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import { signInWithGoogle } from "../lib/googleAuth";
import { signInWithApple } from "../lib/appleAuth";
import GoogleLogo from "../components/GoogleLogo";
import PasswordInput, { type PasswordInputHandle } from "../components/PasswordInput";
import { useTheme } from "../providers/ThemeProvider";
import { stashPendingInvite, coerceInviteCode, getPendingInvite } from "../lib/inviteLink";
import { sendInitialVerification } from "../lib/emailVerification";

const TOP_OFFSET = 64; // match login offset
const PW_ACCESSORY_ID = "signup-password-accessory";
const CONFIRM_ACCESSORY_ID = "signup-confirm-accessory";

// One-account-per-email collisions: Google sign-in against an existing same-email
// account is auto-resolved by Firebase to the SAME account (project-level
// one-account-per-email default), so success paths need no change. These catches
// cover the combinations Firebase refuses to auto-link (e.g. Apple vs password).
const CROSS_PROVIDER_COLLISION_MSG =
  "You already have an account with this email. Sign in with the method you first signed up with.";
const isCrossProviderCollision = (code?: string) =>
  code === "auth/account-exists-with-different-credential" ||
  code === "auth/credential-already-in-use";

export default function SignUp() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<PasswordInputHandle>(null);
  const confirmRef = useRef<PasswordInputHandle>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");

  // Persist a typed invite code before account creation so the Gate redeems it once signed in.
  // This is the guaranteed fallback when a smart-link / clipboard capture didn't carry the code.
  const stashInviteIfPresent = () => stashPendingInvite(inviteCodeInput);

  // Deferred attribution: a brand-new install opened from a smart link leaves the code on the
  // clipboard (set by the waldgrave.com landing page). We read the clipboard LAZILY (only when the
  // user focuses the invite field) so the iOS "Allow Paste" system alert never fires unprompted on
  // mount. Gated by a per-install flag so we don't repeatedly trigger paste prompts.
  const clipboardChecked = useRef(false);
  const maybeReadClipboardInvite = async () => {
    if (clipboardChecked.current) return;
    clipboardChecked.current = true;
    const CHECK_KEY = "@bekin_clipboard_invite_checked";
    try {
      // Skip entirely if a deep-link already stashed a code, or the field is already filled:
      // no reason to touch the clipboard (and no paste prompt) in either case. These paths do NOT
      // burn the one-shot, so a real clipboard check can still happen later.
      if (await AsyncStorage.getItem(CHECK_KEY)) return;
      if (inviteCodeInput.trim()) return;
      if (await getPendingInvite()) return;
      const text = await Clipboard.getStringAsync();
      const code = coerceInviteCode(text);
      if (code) setInviteCodeInput(code);
      // Burn the one-shot only AFTER an actual clipboard read (or denial), so a declined paste
      // prompt isn't re-shown, but a skip-because-deep-link path leaves it available.
      AsyncStorage.setItem(CHECK_KEY, "1").catch(() => {});
    } catch {
      AsyncStorage.setItem(CHECK_KEY, "1").catch(() => {}); // a denied read still burns the one-shot
    }
  };


  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [pw2Focused, setPw2Focused] = useState(false);

  const friendlyError = (code?: string, fallback?: string) => {
    switch (code) {
      case "auth/invalid-email":
        return "That email address looks invalid.";
      case "auth/email-already-in-use":
        return "You already have an account with this email. Sign in instead, and use Google or Apple if that is how you first signed up.";
      case "auth/weak-password":
        return "Password must be at least 6 characters.";
      case "auth/operation-not-allowed":
        return "Email/password sign-in isn't enabled for this project.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      default:
        return fallback || "Something went wrong. Please try again.";
    }
  };

  const handleSignUp = async () => {
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setError("Please enter an email.");
    // Reject all-whitespace passwords (e.g. 6 spaces): require at least 6
    // non-whitespace characters of substance.
    if (password.trim().length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirmPassword) return setError("Passwords don't match.");

    try {
      setLoading(true);
      await stashInviteIfPresent();
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      // Deferred email verification: fire-and-forget the initial verification
      // email so it never blocks signup or navigation. Failures are fine here;
      // the in-app nag banner offers a resend.
      sendInitialVerification(cred.user).catch(() => {});

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email: trimmedEmail,
        username: null,
        hasUsername: false,
        bonusPosts: 3,
        createdAt: serverTimestamp(),
      });

      router.replace("/home");
    } catch (e: any) {
      setError(friendlyError(e?.code, e?.message));
    } finally {
      setLoading(false);
    }
  };

  const anyLoading = loading || googleLoading || appleLoading;

  const handleGoogleSignIn = async () => {
    setError(null);
    try {
      Keyboard.dismiss();
      setGoogleLoading(true);
      await stashInviteIfPresent();
      await signInWithGoogle();
      router.replace("/home");
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (isCrossProviderCollision(e?.code)) {
        setError(CROSS_PROVIDER_COLLISION_MSG);
        return;
      }
      setError("Google sign-in failed. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    try {
      Keyboard.dismiss();
      setAppleLoading(true);
      await stashInviteIfPresent();
      const { isRelayEmail } = await signInWithApple();
      if (isRelayEmail) {
        Alert.alert(
          "Hidden Email Detected",
          "You signed in with Apple's \"Hide My Email.\" If you also have an email/password account, you can link them in Settings → Advanced.",
          [{ text: "Got it", onPress: () => router.replace("/home") }]
        );
      } else {
        router.replace("/home");
      }
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return;
      if (isCrossProviderCollision(e?.code)) {
        setError(CROSS_PROVIDER_COLLISION_MSG);
        return;
      }
      setError("Apple sign-in failed. Please try again.");
    } finally {
      setAppleLoading(false);
    }
  };

  // Email behaves normally (can suggest user's addresses)
  const emailAutoComplete = Platform.select({
    ios: "email",
    android: "email",
    default: "email",
  }) as any;

  // Keep bottom elements visible: give extra bottom padding and gently scroll on focus for lower fields
  const scrollToEndSoon = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.container,
              {
                paddingTop: insets.top + TOP_OFFSET,
                // Enough bottom space so Confirm + Sign Up button never sit under the keyboard
                paddingBottom: 48 + insets.bottom,
                backgroundColor: colors.bg,
              },
            ]}
          >
            {/* decorative soft circles (match login) */}
            <View style={[styles.blobA, { backgroundColor: isDark ? "#1E2A4A" : "#e2ebff" }]} />
            <View style={[styles.blobB, { backgroundColor: isDark ? "#1A2744" : "#d7e4ff" }]} />

            {/* header / logo */}
            <View style={styles.header}>
              <Image
                source={require("../assets/images/adaptive-icon.png")}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>
              <Text style={[styles.subtitle, { color: colors.subtle }]}>Join BeKin</Text>
            </View>

            {/* card */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.topRow}>
                <Text style={{ color: colors.subtle }}>Already have an account?</Text>
                <Link href="/" style={[styles.link, { color: colors.primary }]}>
                  Sign in
                </Link>
              </View>

              {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                <TextInput
                  ref={emailRef}
                  style={[
                    styles.input,
                    {
                      borderColor: emailFocused ? colors.primary : colors.border,
                      backgroundColor: colors.inputBg,
                      color: colors.text,
                    },
                  ]}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete={emailAutoComplete}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  returnKeyType="next"
                  onSubmitEditing={() => requestAnimationFrame(() => passwordRef.current?.focus())}
                  editable={!anyLoading}
                />
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Password</Text>
                <View
                  style={[
                    styles.input,
                    styles.inputRow,
                    {
                      borderColor: pwFocused ? colors.primary : colors.border,
                      backgroundColor: colors.inputBg,
                    },
                  ]}
                >
                  <PasswordInput
                    ref={passwordRef}
                    style={{ color: colors.text }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.subtle}
                    inputAccessoryViewID={Platform.OS === "ios" ? PW_ACCESSORY_ID : undefined}
                    disableFullscreenUI={Platform.OS === "android"}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => { setPwFocused(true); scrollToEndSoon(); }}
                    onBlur={() => setPwFocused(false)}
                    returnKeyType="next"
                    onSubmitEditing={() => requestAnimationFrame(() => confirmRef.current?.focus())}
                    editable={!anyLoading}
                    toggleColor={colors.primary}
                  />
                </View>
              </View>

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Confirm Password</Text>
                <View
                  style={[
                    styles.input,
                    styles.inputRow,
                    {
                      borderColor: pw2Focused ? colors.primary : colors.border,
                      backgroundColor: colors.inputBg,
                    },
                  ]}
                >
                  <PasswordInput
                    ref={confirmRef}
                    style={{ color: colors.text }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.subtle}
                    inputAccessoryViewID={Platform.OS === "ios" ? CONFIRM_ACCESSORY_ID : undefined}
                    disableFullscreenUI={Platform.OS === "android"}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => { setPw2Focused(true); scrollToEndSoon(); }}
                    onBlur={() => setPw2Focused(false)}
                    returnKeyType="go"
                    onSubmitEditing={handleSignUp}
                    editable={!anyLoading}
                    toggleColor={colors.primary}
                  />
                </View>
              </View>

              {/* Invite code (optional) */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Invite code (optional)</Text>
                <TextInput
                  style={[
                    styles.input,
                    { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text },
                  ]}
                  placeholder="From a friend's link"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  value={inviteCodeInput}
                  onChangeText={(v) => setInviteCodeInput(v.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6))}
                  onFocus={maybeReadClipboardInvite}
                  editable={!anyLoading}
                />
              </View>

              {/* Sign Up */}
              <Pressable
                onPress={handleSignUp}
                disabled={anyLoading}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.9 },
                  anyLoading && { opacity: 0.7 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Sign Up</Text>
                )}
              </Pressable>

              {/* SSO divider */}
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.subtle }]}>or sign up with</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              <View style={styles.ssoRow}>
                <Pressable
                  onPress={handleGoogleSignIn}
                  disabled={anyLoading}
                  style={({ pressed }) => [
                    styles.googleBtn,
                    { borderColor: colors.border, backgroundColor: colors.inputBg },
                    pressed && { opacity: 0.85 },
                    anyLoading && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                >
                  {googleLoading ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <View style={styles.ssoBtnInner}>
                      <GoogleLogo size={22} />
                      <Text style={[styles.googleBtnText, { color: colors.text }]}>Google</Text>
                    </View>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleAppleSignIn}
                  disabled={anyLoading}
                  style={({ pressed }) => [
                    styles.appleBtn,
                    { backgroundColor: isDark ? "#FFFFFF" : "#000" },
                    pressed && { opacity: 0.85 },
                    anyLoading && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Apple"
                >
                  {appleLoading ? (
                    <ActivityIndicator color={isDark ? "#000" : "#FFF"} />
                  ) : (
                    <View style={styles.ssoBtnInner}>
                      <Ionicons name="logo-apple" size={22} color={isDark ? "#000" : "#FFF"} />
                      <Text style={[styles.appleBtnText, { color: isDark ? "#000" : "#FFF" }]}>Apple</Text>
                    </View>
                  )}
                </Pressable>
              </View>

              {/* Terms / Privacy notice */}
              <View style={styles.termsRow}>
                <Text style={[styles.termsText, { color: colors.subtle }]}>By signing up you agree to our </Text>
                <Link href="/legal/terms" style={[styles.link, { color: colors.primary }]}>Terms</Link>
                <Text style={[styles.termsText, { color: colors.subtle }]}> and </Text>
                <Link href="/legal/privacy" style={[styles.link, { color: colors.primary }]}>Privacy Policy</Link>
                <Text style={[styles.termsText, { color: colors.subtle }]}>.</Text>
              </View>

            </View>
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* iOS-only: tiny accessories to remove predictive bar/strong password UI */}
        {Platform.OS === "ios" && (
          <>
            <InputAccessoryView nativeID={PW_ACCESSORY_ID}>
              <View style={{ height: 1, backgroundColor: "transparent" }} />
            </InputAccessoryView>
            <InputAccessoryView nativeID={CONFIRM_ACCESSORY_ID}>
              <View style={{ height: 1, backgroundColor: "transparent" }} />
            </InputAccessoryView>
          </>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 20 },
  header: { alignItems: "center", marginBottom: 18 },
  logo: { width: 84, height: 84, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 6, fontSize: 16 },

  card: {
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  inputGroup: { marginBottom: 14 },
  label: { fontWeight: "600", marginBottom: 8 },
  input: {
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },


  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  termsRow: {
    marginTop: 10,
    marginBottom: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  termsText: { fontSize: 12 },

  topRow: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 14 },
  link: { fontWeight: "700" },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 14,
    fontWeight: "600",
  },

  ssoRow: {
    flexDirection: "row",
    gap: 10,
  },
  googleBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  appleBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ssoBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  appleBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },

  error: {
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "600",
  },

  // soft decorative blobs (same vibe as login)
  blobA: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    top: -60,
    right: -40,
  },
  blobB: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 999,
    bottom: -40,
    left: -30,
  },
});
