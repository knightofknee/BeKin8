// app/signup.tsx
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useRouter, Link, Stack } from "expo-router";
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

export default function SignUp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

      // Minimal user doc so other screens can gate on username later
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      

      <SafeAreaView style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={[styles.container, { paddingTop: insets.top + TOP_OFFSET }]}>
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
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>

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
                    textContentType="newPassword"
                    autoComplete="password-new"
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setPwFocused(true)}
                    onBlur={() => setPwFocused(false)}
                    returnKeyType="next"
                    onSubmitEditing={() => confirmRef.current?.focus()}
                  />
                  <Pressable onPress={() => setShowPw((s) => !s)} hitSlop={10}>
                    <Text style={styles.togglePw}>{showPw ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
              </View>

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
                    textContentType="newPassword"
                    autoComplete="password-new"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onFocus={() => setPw2Focused(true)}
                    onBlur={() => setPw2Focused(false)}
                    returnKeyType="go"
                    onSubmitEditing={handleSignUp}
                  />
                  <Pressable onPress={() => setShowPw2((s) => !s)} hitSlop={10}>
                    <Text style={styles.togglePw}>{showPw2 ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
              </View>

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

              <View style={styles.bottomRow}>
                <Text style={{ color: colors.subtle }}>Already have an account?</Text>
                <Link href="/" style={styles.link}>
                  Sign in
                </Link>
              </View>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, backgroundColor: colors.bg /* top set inline */ },
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