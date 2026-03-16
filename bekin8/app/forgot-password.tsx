// app/forgot-password.tsx
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase.config";
import { useTheme } from "../providers/ThemeProvider";

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert("Missing email", "Please enter the email for your account.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      Alert.alert("Invalid email", "That doesn't look like a valid email address.");
      return;
    }

    try {
      setBusy(true);
      await sendPasswordResetEmail(auth, trimmed);
      Alert.alert(
        "Check your email",
        "We sent a password reset link if an account exists for that address.",
        [{ text: "OK", onPress: () => router.replace("/") }]
      );
    } catch (e: any) {
      const msg =
        e?.code === "auth/user-not-found"
          ? "If an account exists for that email, you'll receive a reset email shortly."
          : "Could not send reset email. Please try again.";
      Alert.alert("Oops", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Forgot password</Text>
        <Text style={[styles.subtitle, { color: colors.subtle }]}>
          Enter the email you used to sign up and we'll send you a reset link.
        </Text>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.subtle}
          value={email}
          onChangeText={setEmail}
          style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text }]}
          editable={!busy}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
        />

        <TouchableOpacity
          onPress={onSubmit}
          disabled={busy}
          style={[styles.primaryBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]}
        >
          <Text style={styles.primaryBtnText}>{busy ? "Sending…" : "Send reset link"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/")} style={styles.linkBtn} disabled={busy}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Back to log in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  subtitle: { marginBottom: 16 },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 16,
  },
  primaryBtn: {
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "800" },
  linkBtn: { marginTop: 12, alignItems: "center" },
  linkText: { fontWeight: "700" },
});
