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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { statusCodes } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import { signInWithGoogle } from "../lib/googleAuth";
import { signInWithApple } from "../lib/appleAuth";
import GoogleLogo from "../components/GoogleLogo";
import { useTheme } from "../providers/ThemeProvider";

const TOP_OFFSET = 64; // match login offset
const PW_ACCESSORY_ID = "signup-password-accessory";
const CONFIRM_ACCESSORY_ID = "signup-confirm-accessory";

export default function SignUp() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

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
        return "There's already an account with that email.";
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
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirmPassword) return setError("Passwords don't match.");

    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email: trimmedEmail,
        username: null,
        hasUsername: false,
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
      await signInWithGoogle();
      router.replace("/home");
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) return;
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

  // *** Hard block suggestions & autofill for BOTH password fields ***
  // iOS: oneTimeCode hack kills QuickType/strong password banner for secure text fields
  const noSuggestTextContentType = Platform.select({
    ios: "oneTimeCode",
    default: "none",
  }) as any;

  const noSuggestAutoComplete = Platform.select({
    ios: "off",
    android: "off",
    default: "off",
  }) as any;

  const pwKeyboardType = Platform.select({
    ios: "default",
    android: "visible-password", // avoids Android autofill "lock" UI
    default: "default",
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
                  <TextInput
                    ref={passwordRef}
                    style={{ flex: 1, color: colors.text }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.subtle}
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    keyboardType={pwKeyboardType}
                    textContentType={noSuggestTextContentType}
                    autoComplete={noSuggestAutoComplete}
                    inputAccessoryViewID={Platform.OS === "ios" ? PW_ACCESSORY_ID : undefined}
                    // Android autofill protections:
                    importantForAutofill={Platform.OS === "android" ? "no" : "auto"}
                    disableFullscreenUI={Platform.OS === "android"}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => { setPwFocused(true); scrollToEndSoon(); }}
                    onBlur={() => setPwFocused(false)}
                    returnKeyType="next"
                    onSubmitEditing={() => requestAnimationFrame(() => confirmRef.current?.focus())}
                    editable={!anyLoading}
                  />
                  <Pressable onPress={() => setShowPw((s) => !s)} hitSlop={10}>
                    <Text style={[styles.togglePw, { color: colors.primary }]}>{showPw ? "Hide" : "Show"}</Text>
                  </Pressable>
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
                  <TextInput
                    ref={confirmRef}
                    style={{ flex: 1, color: colors.text }}
                    placeholder="••••••••"
                    placeholderTextColor={colors.subtle}
                    secureTextEntry={!showPw2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    keyboardType={pwKeyboardType}
                    textContentType={noSuggestTextContentType}
                    autoComplete={noSuggestAutoComplete}
                    inputAccessoryViewID={Platform.OS === "ios" ? CONFIRM_ACCESSORY_ID : undefined}
                    // Android autofill protections:
                    importantForAutofill={Platform.OS === "android" ? "no" : "auto"}
                    disableFullscreenUI={Platform.OS === "android"}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => { setPw2Focused(true); scrollToEndSoon(); }}
                    onBlur={() => setPw2Focused(false)}
                    returnKeyType="go"
                    onSubmitEditing={handleSignUp}
                    editable={!anyLoading}
                  />
                  <Pressable onPress={() => setShowPw2((s) => !s)} hitSlop={10}>
                    <Text style={[styles.togglePw, { color: colors.primary }]}>{showPw2 ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
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

  togglePw: { fontWeight: "700" },

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
