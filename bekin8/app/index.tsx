// app/index.tsx
import React, { useEffect, useState } from "react";
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
} from "react-native";
import { Link, Stack } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase.config";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { initNotifications, syncPushTokenIfGranted } from "../lib/push";

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

export default function Index() {
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  useEffect(() => {
  initNotifications();
}, []);

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    try {
      Keyboard.dismiss();
      setSubmitting(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // Let the gate redirect to /home. Do optional post-login work:
      await syncPushTokenIfGranted();
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
      >
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={[styles.container, { paddingTop: insets.top + TOP_OFFSET }]}>
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
                    onSubmitEditing={() => Keyboard.dismiss()}
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
                      style={{ flex: 1 }}
                      placeholder="••••••••"
                      placeholderTextColor={colors.subtle}
                      secureTextEntry={!showPassword}
                      value={password}
                      editable={!submitting}
                      onChangeText={setPassword}
                      onFocus={() => setPwFocused(true)}
                      onBlur={() => setPwFocused(false)}
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

                {/* Forgot password link (moved below Enter) */}
                <View style={{ alignItems: "center", marginTop: 10 }}>
                  <Link href="/forgot-password" style={styles.link}>
                    Forgot password?
                  </Link>
                </View>

                <View style={styles.bottomRow}>
                  <Text style={{ color: colors.subtle }}>New here?</Text>
                  {/* This now works because /signup is a PUBLIC_ROUTE in the gate */}
                  <Link href="/signup" style={styles.link}>
                    Create an account
                  </Link>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
          {submitting && (
            <View style={styles.blocker} pointerEvents="auto">
              <ActivityIndicator size="large" />
              <Text style={{ marginTop: 8, color: colors.subtle }}>Signing you in…</Text>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },

  container: { flex: 1, paddingHorizontal: 20 },
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
  blocker: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.98)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});