import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth } from "../firebase.config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import BottomBar from "../components/BottomBar";

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  danger: "#B00020",
};

export default function SettingsScreen() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const functions = getFunctions();

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
      setBusy(true);
      const call = httpsCallable(functions, "deleteAccountData");
      await call({});
      try { await signOut(auth); } catch {}
      Alert.alert("Account deleted", "Your account and data have been removed.");
      router.replace("/");
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message ?? "Try again.");
    } finally {
      setBusy(false);
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
          <Text style={s.title}>Settings</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={s.body}>
          {/* Legal links */}
          <Pressable style={s.row} onPress={() => router.push("/legal/privacy")}>
            <Text style={s.link}>Privacy Policy</Text>
          </Pressable>
          <Pressable style={s.row} onPress={() => router.push("/legal/terms")}>
            <Text style={s.link}>Terms of Service</Text>
          </Pressable>
          <Pressable style={s.row} onPress={() => router.push("/legal/guidelines")}>
            <Text style={s.link}>Community Guidelines</Text>
          </Pressable>

          <View style={s.divider} />

          <Text style={s.h2}>Danger zone</Text>
          <Pressable style={[s.button, s.danger]} onPress={confirmDelete} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Delete Account</Text>}
          </Pressable>
        </View>
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
  back: { color: colors.primary, fontWeight: "800", fontSize: 16, width: 48 },
  title: { color: colors.text, fontWeight: "800", fontSize: 18, textAlign: "center" },

  body: { flex: 1, padding: 16, paddingBottom: 100 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  link: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  h2: { fontSize: 18, fontWeight: "800", marginBottom: 10, color: colors.text },
  button: { padding: 14, borderRadius: 12, alignItems: "center" },
  danger: { backgroundColor: colors.danger },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
