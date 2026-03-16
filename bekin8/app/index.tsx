// app/index.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Dimensions,
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
import { Link, Stack, useRouter } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase.config";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { initNotifications, syncPushTokenIfGranted } from "../lib/push";
import { statusCodes } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import { signInWithGoogle } from "../lib/googleAuth";
import { signInWithApple } from "../lib/appleAuth";
import GoogleLogo from "../components/GoogleLogo";
import { useTheme } from "../providers/ThemeProvider";

const TOP_OFFSET = 64; // consistent "reach-friendly" offset
const BOTTOM_GAP = 28; // desired minimal space between keyboard and card

export default function Index() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const shift = useRef(new Animated.Value(0)).current;
  const cardRef = useRef<View>(null);
  const kbHeightRef = useRef(0);
  const keyboardVisibleRef = useRef(false);      // <-- lock while keyboard is up

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  useEffect(() => {
    initNotifications();
  }, []);

  const recomputeShift = (kbHeight: number, duration?: number) => {
    const winH = Dimensions.get("window").height;
    const keyboardTop = winH - kbHeight;

    if (cardRef.current && "measureInWindow" in cardRef.current) {
      // @ts-ignore measureInWindow exists at runtime
      cardRef.current.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        const bottom = y + h;
        const needed = Math.max(0, bottom - keyboardTop + BOTTOM_GAP);
        Animated.timing(shift, {
          toValue: -needed,
          duration: duration ?? 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    }
  };

  useEffect(() => {
    const onShow = (e: any) => {
      const kb = e?.endCoordinates?.height ?? 0;
      kbHeightRef.current = kb;

      // If the keyboard is already visible, DO NOTHING (prevents bob on field switch)
      if (keyboardVisibleRef.current) return;

      keyboardVisibleRef.current = true;
      // First appearance only: animate to the correct offset
      recomputeShift(kb, e?.duration);
    };

    // While keyboard is up, iOS may emit tiny frame changes; ignore them entirely
    const onChangeFrame = (e: any) => {
      kbHeightRef.current = e?.endCoordinates?.height ?? 0;
      // intentionally no recompute while visible
    };

    const onHide = (e: any) => {
      keyboardVisibleRef.current = false;
      kbHeightRef.current = 0;
      Animated.timing(shift, {
        toValue: 0,
        duration: e?.duration ?? 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    const subs = [
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardWillShow", onShow)
        : Keyboard.addListener("keyboardDidShow", onShow),
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardWillChangeFrame", onChangeFrame)
        : Keyboard.addListener("keyboardDidChangeFrame", onChangeFrame),
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardWillHide", onHide)
        : Keyboard.addListener("keyboardDidHide", onHide),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [recomputeShift, shift]);

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

  const anyLoading = submitting || googleLoading || appleLoading;

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
        behavior={undefined}
      >
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <SafeAreaView style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <Animated.View
              style={[
                styles.container,
                { paddingTop: insets.top + TOP_OFFSET, transform: [{ translateY: shift }] },
              ]}
            >
              {/* decorative soft circles */}
              <View style={[styles.blobA, { backgroundColor: isDark ? "#1E2A4A" : "#e2ebff" }]} />
              <View style={[styles.blobB, { backgroundColor: isDark ? "#1A2744" : "#d7e4ff" }]} />

              {/* header / logo */}
              <View style={styles.header}>
                <Image
                  source={require("../assets/images/adaptive-icon.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
                <Text style={[styles.subtitle, { color: colors.subtle }]}>Sign in to BeKin</Text>
              </View>

              {/* card */}
              <View ref={cardRef} style={[styles.card, { backgroundColor: colors.card }]}>
                <View style={styles.topRow}>
                  <Text style={{ color: colors.subtle }}>New here?</Text>
                  <Link href="/signup" style={[styles.link, { color: colors.primary }]}>
                    Create an account
                  </Link>
                </View>

                {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                  <TextInput
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
                    autoComplete="email"
                    value={email}
                    editable={!anyLoading}
                    onChangeText={setEmail}
                    onFocus={() => { setEmailFocused(true); /* no recompute on focus */ }}
                    onBlur={() => setEmailFocused(false)}
                    returnKeyType="next"
                    blurOnSubmit
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                </View>

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
                      style={{ flex: 1, color: colors.text }}
                      placeholder="••••••••"
                      placeholderTextColor={colors.subtle}
                      secureTextEntry={!showPassword}
                      value={password}
                      editable={!anyLoading}
                      onChangeText={setPassword}
                      onFocus={() => { setPwFocused(true); /* no recompute on focus */ }}
                      onBlur={() => setPwFocused(false)}
                      textContentType="password"
                      autoComplete="password"
                      returnKeyType="go"
                      onSubmitEditing={handleLogin}
                    />
                    <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10}>
                      <Text style={[styles.togglePw, { color: colors.primary }]}>{showPassword ? "Hide" : "Show"}</Text>
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={handleLogin}
                  disabled={anyLoading}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.9 },
                    anyLoading && { opacity: 0.7 },
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

                <View style={{ alignItems: "center", marginTop: 10 }}>
                  <Link href="/forgot-password" style={[styles.link, { color: colors.primary }]}>
                    Forgot password?
                  </Link>
                </View>

                {/* SSO divider */}
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  <Text style={[styles.dividerText, { color: colors.subtle }]}>or sign in with</Text>
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
                    accessibilityLabel="Sign in with Google"
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
                    accessibilityLabel="Sign in with Apple"
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
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
          {anyLoading && (
            <View style={[styles.blocker, { backgroundColor: isDark ? "rgba(15,17,23,0.98)" : "rgba(255,255,255,0.98)" }]} pointerEvents="auto">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ marginTop: 8, color: colors.subtle }}>
                {googleLoading ? "Signing in with Google…" : appleLoading ? "Signing in with Apple…" : "Signing you in…"}
              </Text>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
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

  // Soft decorative blobs
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
  blocker: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
