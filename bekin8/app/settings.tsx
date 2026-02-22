import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, Pressable, ActivityIndicator, TextInput, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc, serverTimestamp, deleteField } from "firebase/firestore";
import { signOut } from "firebase/auth";
import BottomBar from "../components/BottomBar";
import { useAuth } from "../providers/AuthProvider";

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
  const { profile, profileLoaded, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [initialDisplayName, setInitialDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [commentsEnabled, setCommentsEnabled] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const router = useRouter();
  const functions = getFunctions();

  // Seed local state from cached profile once available
  React.useEffect(() => {
    if (profile) {
      setCommentsEnabled(profile.commentsEnabled);
    }
  }, [profileLoaded]);

  const currentDisplayName = profile
    ? (profile.displayName || profile.username)
    : "";

  const startEditDisplayName = () => {
    setEditingName(true);
    setSavingName(false);
    setNameError(null);
    const effective = profile ? (profile.displayName || profile.username) : "";
    setDisplayName(effective);
    setInitialDisplayName(effective);
  };

  const handleToggleComments = async (val: boolean) => {
    const uid = auth.currentUser?.uid;
    if (!uid || commentsBusy) return;
    setCommentsEnabled(val);
    updateProfile({ commentsEnabled: val });
    setCommentsBusy(true);
    try {
      await setDoc(doc(db, "Profiles", uid), { commentsEnabled: val, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setCommentsEnabled(!val);
      updateProfile({ commentsEnabled: !val });
    } finally {
      setCommentsBusy(false);
    }
  };

  const validateName = (val: string) => {
    const t = (val ?? "").trim();
    if (t.length === 0) { setNameError(null); return true; } // empty allowed -> fallback to username
    if (t.length < 3)   { setNameError("Must be at least 3 characters."); return false; }
    if (t.length > 40)  { setNameError("Keep it under 40 characters."); return false; }
    setNameError(null);
    return true;
  };

  const saveDisplayName = async () => {
    const t = (displayName ?? "").trim().replace(/\s+/g, " ");
    setAttemptedSave(true);
    if (!validateName(t)) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setNameError("You must be signed in."); return; }
    try {
      setSavingName(true);
      const payload = t.length === 0
        ? { displayName: deleteField(), updatedAt: serverTimestamp() }
        : { displayName: t, updatedAt: serverTimestamp() };
      await setDoc(doc(db, "Profiles", uid), payload, { merge: true });
      updateProfile({ displayName: t });
      setInitialDisplayName(t);
      setEditingName(false);
      Alert.alert("Saved", t.length === 0 ? "Display name cleared. We'll show your username." : "Your display name was updated.");
    } catch (e: any) {
      setNameError(e?.message ?? "Failed to save name.");
    } finally {
      setSavingName(false);
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

  if (!profileLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <Stack.Screen options={{ animation: 'fade' }} />
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
          {/* Profile */}
          <Pressable style={[s.row, s.rowBetween]} onPress={startEditDisplayName}>
            <Text style={s.link}>Edit Display Name</Text>
            <Text style={s.subtle}>{currentDisplayName || "— uses username —"}</Text>
          </Pressable>

          {/* Inline editor panel */}
          {editingName && (
            <View style={s.editor}>
              <Text style={s.h2}>Edit Display Name</Text>
              <TextInput
                style={s.input}
                placeholder="Your display name"
                value={displayName}
                onChangeText={(t) => { setDisplayName(t); if (attemptedSave) validateName(t); }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40}
              />
              {attemptedSave && !!nameError && <Text style={s.err}>{nameError}</Text>}
              <View style={s.rowBtns}>
                <Pressable
                  style={[s.button, s.ghostBtn]}
                  onPress={() => { setEditingName(false); setDisplayName(initialDisplayName); setNameError(null); }}
                  disabled={savingName}
                >
                  <Text style={s.ghostTxt}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.button, nameError ? s.disabledBtn : s.primary]}
                  onPress={saveDisplayName}
                  disabled={!!nameError || savingName}
                >
                  {savingName ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Save</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {/* Allow comments on my posts */}
          <View style={[s.row, s.rowBetween]}>
            <View style={{ flex: 1 }}>
              <Text style={s.link}>Allow comments on my posts</Text>
              <Text style={s.subtle}>Let friends comment on your posts</Text>
            </View>
            <Switch
              value={commentsEnabled}
              onValueChange={handleToggleComments}
              disabled={commentsBusy}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          <View style={s.spacer} />
          {/* Bottom section */}
          <View style={s.bottom}>
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
  editor: { paddingVertical: 12, gap: 8 },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    padding: 12, borderRadius: 10, fontSize: 16, color: colors.text
  },
  err: { color: colors.danger, fontSize: 13 },
  rowBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 4, marginBottom: 12 },
  ghostBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  ghostTxt: { color: colors.text, fontSize: 16, fontWeight: "800" },
  primary: { backgroundColor: colors.primary },
  disabledBtn: { backgroundColor: "#9CA3AF" },
  spacer: { flex: 1 },
  bottom: { paddingTop: 8, paddingBottom: 24 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtle: { color: colors.subtle, fontSize: 14 },
});
