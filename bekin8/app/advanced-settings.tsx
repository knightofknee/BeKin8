import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { signOut, EmailAuthProvider, linkWithCredential } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";
import BottomBar from "../components/BottomBar";
import { useAuth } from "../providers/AuthProvider";
import GoogleLogo from "../components/GoogleLogo";

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  danger: "#B00020",
  success: "#059669",
};

export default function AdvancedSettingsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const functions = getFunctions();

  // Provider detection
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    // Reload to get fresh providerData (the cached user object can be stale)
    currentUser.reload().then(() => {
      setProviders(currentUser.providerData.map((p) => p.providerId));
    }).catch(() => {
      // Fallback to cached data
      setProviders(currentUser.providerData.map((p) => p.providerId));
    });
  }, [user]);

  const hasPassword = providers.includes("password");
  const showLinkSection = !hasPassword && providers.length > 0;

  // Account linking form
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Delete account
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handlePortAccount = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const trimmed = linkEmail.trim();
    if (!trimmed) {
      setLinkError("Please enter an email.");
      return;
    }
    if (linkPassword.length < 6) {
      setLinkError("Password must be at least 6 characters.");
      return;
    }

    try {
      setLinkBusy(true);
      setLinkError(null);

      // 1) Call Cloud Function to port data from old account
      const apiKey = auth.app.options.apiKey;
      const portCall = httpsCallable(functions, "portAccountData");
      const result = await portCall({ oldEmail: trimmed, oldPassword: linkPassword, apiKey });
      const data = result.data as any;

      if (!data?.ok) {
        const msg =
          data?.error === "INVALID_CREDENTIALS"
            ? "Could not verify the old account. Check email and password."
            : data?.error === "SAME_ACCOUNT"
            ? "That is the same account you are signed into."
            : data?.message || "Port failed. Please try again.";
        setLinkError(msg);
        return;
      }

      // 2) Link the old email/password as a sign-in method on this account
      try {
        const credential = EmailAuthProvider.credential(trimmed, linkPassword);
        await linkWithCredential(currentUser, credential);
      } catch (linkErr: any) {
        // Non-fatal: data was ported even if linking fails
        console.warn("linkWithCredential failed after port:", linkErr?.message);
      }

      await currentUser.reload();
      setProviders(currentUser.providerData.map((p) => p.providerId));
      setLinkEmail("");
      setLinkPassword("");
      Alert.alert(
        "Account Ported",
        "Your friends and posts have been moved to this account. You can now also sign in with your old email and password."
      );
    } catch (e: any) {
      setLinkError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setLinkBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete Account",
      "This permanently removes your account and personal data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]
    );
  };

  const doDelete = async () => {
    try {
      setDeleteBusy(true);
      const call = httpsCallable(functions, "deleteAccountData");
      await call({});
      try {
        await signOut(auth);
      } catch {}
      Alert.alert("Account deleted", "Your account and data have been removed.");
      router.replace("/");
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message ?? "Try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const providerLabel = (id: string) => {
    switch (id) {
      case "password":
        return "Email / Password";
      case "apple.com":
        return "Apple";
      case "google.com":
        return "Google";
      default:
        return id;
    }
  };

  const providerIcon = (id: string) => {
    switch (id) {
      case "password":
        return <Ionicons name="mail-outline" size={20} color={colors.text} />;
      case "apple.com":
        return <Ionicons name="logo-apple" size={20} color={colors.text} />;
      case "google.com":
        return <GoogleLogo size={20} />;
      default:
        return null;
    }
  };

  return (
    <>
      <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={s.back}>{`← Back`}</Text>
          </Pressable>
          <Text style={s.title}>Advanced</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView
          style={s.body}
          contentContainerStyle={s.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Linked Accounts */}
          <Text style={s.h2}>Linked Accounts</Text>
          <Text style={s.subtleText}>
            Sign-in methods connected to your account.
          </Text>

          {providers.map((id) => (
            <View key={id} style={[s.row, s.rowBetween]}>
              <View style={s.providerRow}>
                {providerIcon(id)}
                <Text style={s.providerLabel}>{providerLabel(id)}</Text>
              </View>
              <View style={s.badge}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.success}
                />
                <Text style={s.badgeText}>Connected</Text>
              </View>
            </View>
          ))}

          {showLinkSection && (
            <View style={s.infoCard}>
              <Text style={s.infoText}>
                If you have an older email/password account, enter its
                credentials below to port your friends and posts to this
                account.
              </Text>
              <TextInput
                style={s.input}
                placeholder="Email address"
                placeholderTextColor={colors.subtle}
                value={linkEmail}
                onChangeText={setLinkEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!linkBusy}
              />
              <TextInput
                style={[s.input, { marginTop: 10 }]}
                placeholder="Password (min 6 characters)"
                placeholderTextColor={colors.subtle}
                value={linkPassword}
                onChangeText={setLinkPassword}
                secureTextEntry
                autoCapitalize="none"
                editable={!linkBusy}
              />
              {linkError && <Text style={s.err}>{linkError}</Text>}
              <Pressable
                style={[s.button, s.primaryBtn, linkBusy && { opacity: 0.7 }]}
                onPress={handlePortAccount}
                disabled={linkBusy}
              >
                {linkBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.buttonText}>Port Account Data</Text>
                )}
              </Pressable>
            </View>
          )}

          <View style={s.divider} />

          {/* Legal */}
          <Text style={s.h2}>Legal</Text>
          <Pressable
            style={s.row}
            onPress={() => router.push("/legal/privacy")}
          >
            <Text style={s.link}>Privacy Policy</Text>
          </Pressable>
          <Pressable style={s.row} onPress={() => router.push("/legal/terms")}>
            <Text style={s.link}>Terms of Service</Text>
          </Pressable>
          <Pressable
            style={s.row}
            onPress={() => router.push("/legal/guidelines")}
          >
            <Text style={s.link}>Community Guidelines</Text>
          </Pressable>

          <View style={s.divider} />

          {/* Danger Zone */}
          <Text style={s.h2}>Danger zone</Text>
          <Pressable
            style={[s.button, s.dangerBtn]}
            onPress={confirmDelete}
            disabled={deleteBusy}
          >
            {deleteBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Delete Account</Text>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <BottomBar />
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 52,
    paddingHorizontal: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 16,
    width: 48,
  },
  title: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
  },

  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 120 },

  h2: { fontSize: 18, fontWeight: "800", marginBottom: 6, color: colors.text },
  subtleText: { color: colors.subtle, fontSize: 14, marginBottom: 8 },

  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  link: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },

  providerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  providerLabel: { fontSize: 16, fontWeight: "600", color: colors.text },
  badge: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeText: { fontSize: 14, color: colors.success, fontWeight: "600" },

  infoCard: {
    backgroundColor: "#EBF2FF",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 12,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    borderRadius: 10,
    fontSize: 16,
    color: colors.text,
  },
  err: { color: colors.danger, fontSize: 13, marginTop: 6 },

  button: { padding: 14, borderRadius: 12, alignItems: "center" },
  primaryBtn: { backgroundColor: colors.primary, marginTop: 12 },
  dangerBtn: { backgroundColor: colors.danger },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
