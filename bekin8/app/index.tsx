// app/index.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  ScrollView,
} from "react-native";
import { Link, useRouter, Stack } from "expo-router";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase.config";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { registerAndSaveExpoToken } from "./lib/push";

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  error: "#B00020",
};

const TOP_OFFSET = 64; // consistent “reach-friendly” offset
const BUTTON_HEIGHT = 56;

export default function Index() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView>(null);
  const pwRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bootChecking, setBootChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace("/home");
      } else {
        setBootChecking(false);
      }
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await registerAndSaveExpoToken();
        router.replace("/home");
      } else {
        setBootChecking(false);
      }
    });
    return unsub;
  }, [router]);

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    try {
      setSubmitting(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await registerAndSaveExpoToken();
      router.replace("/home");
    } catch (e: any) {
      const code = e?.code || "";
      let msg = "Login failed. Please try again.";
      if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password"))
        msg = "Invalid email or password.";
      if (code.includes("auth/user-not-found")) msg = "No account found for that email.";
      if (code.includes("auth/too-many-requests")) msg = "Too many attempts. Try again later.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (bootChecking) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: colors.subtle }}>Checking session…</Text>
      </View>
    );
  }

  // Enough bottom space so the Enter button sits fully above the keyboard on small devices
  const bottomPadding = BUTTON_HEIGHT + 20 + insets.bottom;

  const scrollToEndSoon = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          gestureEnabled: false,
          animation: "fade",
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // If you add a native header, set its height here
        keyboardVerticalOffset={0}
      >
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.container,
                { paddingTop: insets.top + TOP_OFFSET, paddingBottom: bottomPadding, flexGrow: 1 },
              ]}
            >
              {/* decorative soft circles */}
              <View style={styles.blobA} />
              <View style={styles.blobB} />

              {/* header / logo */}
              <View style={styles.header}>
                <Image
                  source={require("../assets/images/adaptive-icon.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Sign in to BeKin</Text>
              </View>

              {/* card */}
              <View style={styles.card}>
                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Email</Text>
                  <TextInput
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
                    editable={!submitting}
                    onChangeText={setEmail}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    returnKeyType="next"
                    blurOnSubmit
                    onSubmitEditing={() => pwRef.current?.focus()}
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
                      ref={pwRef}
                      style={{ flex: 1 }}
                      placeholder="••••••••"
                      placeholderTextColor={colors.subtle}
                      secureTextEntry={!showPassword}
                      value={password}
                      editable={!submitting}
                      onChangeText={setPassword}
                      onFocus={() => {
                        setPwFocused(true);
                        scrollToEndSoon();
                      }}
                      onBlur={() => setPwFocused(false)}
                      // Keep Keychain suggestions for login (users expect it)
                      textContentType="password"
                      autoComplete="password"
                      returnKeyType="go"
                      onSubmitEditing={handleLogin}
                    />
                    <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10}>
                      <Text style={styles.togglePw}>{showPassword ? "Hide" : "Show"}</Text>
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={handleLogin}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.9 },
                    submitting && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Enter</Text>
                  )}
                </Pressable>

                <View style={styles.bottomRow}>
                  <Text style={{ color: colors.subtle }}>New here?</Text>
                  <Link href="/signup" style={styles.link}>
                    Create an account
                  </Link>
                </View>
              </View>
            </ScrollView>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },

  container: { flexGrow: 1, paddingHorizontal: 20 /* top padding set inline with safe-area */ },
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
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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

  // Soft decorative blobs
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