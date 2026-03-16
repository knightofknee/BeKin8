import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, Pressable, ActivityIndicator, TextInput, Switch, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { doc, onSnapshot, setDoc, serverTimestamp, deleteField } from "firebase/firestore";
import * as Notifications from "expo-notifications";
import BottomBar from "../components/BottomBar";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { syncPushTokenIfGranted } from "../lib/push";

/** Returns true if notifications are (or become) granted. Shows OS prompt if needed. */
async function ensureNotifyPermission(): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  if (perm.granted) return true;

  if (perm.canAskAgain) {
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert(
        "Enable notifications?",
        "Turn on notifications to receive alerts for comments.",
        [
          { text: "Not now", style: "cancel", onPress: () => resolve(false) },
          { text: "Allow", onPress: () => resolve(true) },
        ]
      )
    );
    if (!ok) return false;
    const req = await Notifications.requestPermissionsAsync();
    if (!req.granted) {
      Alert.alert("Notifications Off", "You can enable them later from Settings.");
      return false;
    }
    try { await syncPushTokenIfGranted(); } catch {}
    return true;
  }

  // Already permanently denied — direct to OS settings
  await new Promise<void>((resolve) =>
    Alert.alert(
      "Notifications Off",
      Platform.OS === "ios"
        ? "Open Settings → BeKin → Notifications and turn on Allow Notifications."
        : "Open Settings → Apps → BeKin → Notifications and turn them on.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve() },
        { text: "Open Settings", onPress: async () => { try { await Linking.openSettings(); } catch {} resolve(); } },
      ]
    )
  );
  return false;
}

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
  const { colors: tc, isDark, toggleTheme } = useTheme();
  const { profile, profileLoaded, updateProfile } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [initialDisplayName, setInitialDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [commentsEnabled, setCommentsEnabled] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);
  // Notification toggles
  const [commentNotify, setCommentNotify] = useState(false);
  const [commentNotifyBusy, setCommentNotifyBusy] = useState(false);
  const [postCommentNotify, setPostCommentNotify] = useState(false);
  const [postCommentNotifyBusy, setPostCommentNotifyBusy] = useState(false);
  const [commentOnCommentNotify, setCommentOnCommentNotify] = useState(false);
  const [commentOnCommentNotifyBusy, setCommentOnCommentNotifyBusy] = useState(false);
  const [newPostNotify, setNewPostNotify] = useState(false);
  const [newPostNotifyBusy, setNewPostNotifyBusy] = useState(false);
  const router = useRouter();

  // Seed local state from cached profile once available
  React.useEffect(() => {
    if (profile) {
      setCommentsEnabled(profile.commentsEnabled);
    }
  }, [profileLoaded]);

  // Live listeners for notification prefs
  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // RSVP comment notify lives on users/{uid}.commentNotify
    const unsubUser = onSnapshot(doc(db, "users", uid), (snap) => {
      if (snap.exists()) setCommentNotify(!!(snap.data() as any)?.commentNotify);
    });
    // Post-comment prefs live on Profiles/{uid}
    const unsubProfile = onSnapshot(doc(db, "Profiles", uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        setPostCommentNotify(!!d?.postCommentNotify);
        setCommentOnCommentNotify(!!d?.commentOnCommentNotify);
        setNewPostNotify(!!d?.newPostNotify);
      }
    });
    return () => { unsubUser(); unsubProfile(); };
  }, []);

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

  const handleToggleCommentNotify = async (val: boolean) => {
    const uid = auth.currentUser?.uid;
    if (!uid || commentNotifyBusy) return;
    if (val) {
      const granted = await ensureNotifyPermission();
      if (!granted) return; // don't flip the switch if they declined
    }
    setCommentNotify(val);
    setCommentNotifyBusy(true);
    try {
      await setDoc(doc(db, "users", uid), { commentNotify: val }, { merge: true });
    } catch {
      setCommentNotify(!val);
    } finally {
      setCommentNotifyBusy(false);
    }
  };

  const handleTogglePostCommentNotify = async (val: boolean) => {
    const uid = auth.currentUser?.uid;
    if (!uid || postCommentNotifyBusy) return;
    if (val) {
      const granted = await ensureNotifyPermission();
      if (!granted) return; // don't flip the switch if they declined
    }
    setPostCommentNotify(val);
    setPostCommentNotifyBusy(true);
    try {
      await setDoc(doc(db, "Profiles", uid), { postCommentNotify: val, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setPostCommentNotify(!val);
    } finally {
      setPostCommentNotifyBusy(false);
    }
  };

  const handleToggleCommentOnCommentNotify = async (val: boolean) => {
    const uid = auth.currentUser?.uid;
    if (!uid || commentOnCommentNotifyBusy) return;
    if (val) {
      const granted = await ensureNotifyPermission();
      if (!granted) return;
    }
    setCommentOnCommentNotify(val);
    setCommentOnCommentNotifyBusy(true);
    try {
      await setDoc(doc(db, "Profiles", uid), { commentOnCommentNotify: val, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setCommentOnCommentNotify(!val);
    } finally {
      setCommentOnCommentNotifyBusy(false);
    }
  };

  const handleToggleNewPostNotify = async (val: boolean) => {
    const uid = auth.currentUser?.uid;
    if (!uid || newPostNotifyBusy) return;
    if (val) {
      const granted = await ensureNotifyPermission();
      if (!granted) return;
    }
    setNewPostNotify(val);
    setNewPostNotifyBusy(true);
    try {
      await setDoc(doc(db, "Profiles", uid), { newPostNotify: val, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setNewPostNotify(!val);
    } finally {
      setNewPostNotifyBusy(false);
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

  if (!profileLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tc.bg }}>
        <ActivityIndicator color={tc.primary} />
      </View>
    );
  }

  return (
    <>
      <SafeAreaView style={[s.safe, { backgroundColor: tc.bg }]} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: tc.card, borderBottomColor: tc.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[s.back, { color: tc.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: tc.text }]}>Settings</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={s.body}>
          {/* Profile */}
          <Pressable style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]} onPress={startEditDisplayName}>
            <Text style={[s.link, { color: tc.primary }]}>Edit Display Name</Text>
            <Text style={[s.subtle, { color: tc.subtle }]}>{currentDisplayName || "— uses username —"}</Text>
          </Pressable>

          {/* Inline editor panel */}
          {editingName && (
            <View style={s.editor}>
              <Text style={[s.h2, { color: tc.text }]}>Edit Display Name</Text>
              <TextInput
                style={[s.input, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                placeholder="Your display name"
                placeholderTextColor={tc.subtle}
                value={displayName}
                onChangeText={(t) => { setDisplayName(t); if (attemptedSave) validateName(t); }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40}
              />
              {attemptedSave && !!nameError && <Text style={[s.err, { color: tc.error }]}>{nameError}</Text>}
              <View style={s.rowBtns}>
                <Pressable
                  style={[s.button, s.ghostBtn, { borderColor: tc.border }]}
                  onPress={() => { setEditingName(false); setDisplayName(initialDisplayName); setNameError(null); }}
                  disabled={savingName}
                >
                  <Text style={[s.ghostTxt, { color: tc.text }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.button, nameError ? s.disabledBtn : { backgroundColor: tc.primary }]}
                  onPress={saveDisplayName}
                  disabled={!!nameError || savingName}
                >
                  {savingName ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Save</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {/* Allow comments on my posts */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.link, { color: tc.primary }]}>Allow comments on my posts</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Let friends comment on your posts</Text>
            </View>
            <Switch
              value={commentsEnabled}
              onValueChange={handleToggleComments}
              disabled={commentsBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Notify: comments on RSVP'd beacons */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>RSVP beacon comment notifications</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when someone comments on a beacon you've RSVP'd to</Text>
            </View>
            <Switch
              value={commentNotify}
              onValueChange={handleToggleCommentNotify}
              disabled={commentNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Notify: comments on my own posts */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Post comment notifications</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when someone comments on your post</Text>
            </View>
            <Switch
              value={postCommentNotify}
              onValueChange={handleTogglePostCommentNotify}
              disabled={postCommentNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Notify: new comments on posts I've commented on */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Comments on comments</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when someone comments on a post you've commented on</Text>
            </View>
            <Switch
              value={commentOnCommentNotify}
              onValueChange={handleToggleCommentOnCommentNotify}
              disabled={commentOnCommentNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Notify: new posts from friends with notifications on */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>New post notifications</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when a friend who you have notifications turned on for posts</Text>
            </View>
            <Switch
              value={newPostNotify}
              onValueChange={handleToggleNewPostNotify}
              disabled={newPostNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Dark mode */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Dark mode</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Switch to a darker color scheme</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          <View style={s.spacer} />

          <Pressable
            style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}
            onPress={() => router.push("/advanced-settings")}
          >
            <Text style={[s.link, { color: tc.primary }]}>Advanced Settings</Text>
            <Text style={[s.subtle, { color: tc.subtle }]}>{"→"}</Text>
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
  h2: { fontSize: 18, fontWeight: "800", marginBottom: 10, color: colors.text },
  button: { padding: 14, borderRadius: 12, alignItems: "center" },
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
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtle: { color: colors.subtle, fontSize: 14 },
});
