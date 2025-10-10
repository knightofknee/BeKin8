// app/signup.tsx
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
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

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  error: "#B00020",
};

const TOP_OFFSET = 64; // match login offset
const PW_ACCESSORY_ID = "signup-password-accessory";
const CONFIRM_ACCESSORY_ID = "signup-confirm-accessory";

export default function SignUp() {
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
  const [error, setError] = useState<string | null>(null);

  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [pw2Focused, setPw2Focused] = useState(false);

  const friendlyError = (code?: string, fallback?: string) => {
    switch (code) {
      case "auth/invalid-email":
        return "That email address looks invalid.";
      case "auth/email-already-in-use":
        return "There’s already an account with that email.";
      case "auth/weak-password":
        return "Password must be at least 6 characters.";
      case "auth/operation-not-allowed":
        return "Email/password sign-in isn’t enabled for this project.";
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
    if (password !== confirmPassword) return setError("Passwords don’t match.");

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

      router.replace("/notifications-permission");
    } catch (e: any) {
      setError(friendlyError(e?.code, e?.message));
    } finally {
      setLoading(false);
    }
  };

  // Email behaves normally (can suggest user’s addresses)
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
    android: "visible-password", // avoids Android autofill “lock” UI
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
              },
            ]}
          >
            {/* decorative soft circles (match login) */}
            <View style={styles.blobA} />
            <View style={styles.blobB} />

            {/* header / logo */}
            <View style={styles.header}>
              <Image
                source={require("../assets/images/adaptive-icon.png")}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Join BeKin</Text>
            </View>

            {/* card */}
            <View style={styles.card}>
              {error ? <Text style={styles.error}>{error}</Text> : null}

              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  ref={emailRef}
                  style={[
                    styles.input,
                    { borderColor: emailFocused ? colors.primary : colors.border },
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
                  editable={!loading}
                />
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View
                  style={[
                    styles.input,
                    styles.inputRow,
                    { borderColor: pwFocused ? colors.primary : colors.border },
                  ]}
                >
                  <TextInput
                    ref={passwordRef}
                    style={{ flex: 1 }}
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
                    editable={!loading}
                  />
                  <Pressable onPress={() => setShowPw((s) => !s)} hitSlop={10}>
                    <Text style={styles.togglePw}>{showPw ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
              </View>

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <View
                  style={[
                    styles.input,
                    styles.inputRow,
                    { borderColor: pw2Focused ? colors.primary : colors.border },
                  ]}
                >
                  <TextInput
                    ref={confirmRef}
                    style={{ flex: 1 }}
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
                    editable={!loading}
                  />
                  <Pressable onPress={() => setShowPw2((s) => !s)} hitSlop={10}>
                    <Text style={styles.togglePw}>{showPw2 ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
              </View>

              {/* Sign Up */}
              <Pressable
                onPress={handleSignUp}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.9 },
                  loading && { opacity: 0.7 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Sign Up</Text>
                )}
              </Pressable>

              {/* Terms / Privacy notice */}
              <View style={styles.termsRow}>
                <Text style={styles.termsText}>By signing up you agree to our </Text>
                <Link href="/legal/terms" style={styles.link}>Terms</Link>
                <Text style={styles.termsText}> and </Text>
                <Link href="/legal/privacy" style={styles.link}>Privacy Policy</Link>
                <Text style={styles.termsText}>.</Text>
              </View>

              {/* Already have an account */}
              <View style={styles.bottomRow}>
                <Text style={{ color: colors.subtle }}>Already have an account?</Text>
                <Link href="/" style={styles.link}>
                  Sign in
                </Link>
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
  container: { flexGrow: 1, paddingHorizontal: 20, backgroundColor: colors.bg },
  header: { alignItems: "center", marginBottom: 18 },
  logo: { width: 84, height: 84, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text },
  subtitle: { marginTop: 6, fontSize: 16, color: colors.subtle },

  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },

  inputGroup: { marginBottom: 14 },
  label: { fontWeight: "600", marginBottom: 8, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#FFF",
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  togglePw: { fontWeight: "700", color: colors.primary },

  primaryBtn: {
    backgroundColor: colors.primary,
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
  termsText: { color: colors.subtle, fontSize: 12 },

  bottomRow: { flexDirection: "row", gap: 6, justifyContent: "center", marginTop: 16 },
  link: { color: colors.primary, fontWeight: "700" },

  error: {
    color: colors.error,
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
    backgroundColor: "#e2ebff",
    top: -60,
    right: -40,
  },
  blobB: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "#d7e4ff",
    bottom: -40,
    left: -30,
  },
});