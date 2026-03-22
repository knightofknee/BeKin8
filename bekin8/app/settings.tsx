import React, { useState } from "react";
import { View, Text, StyleSheet, Alert, Pressable, ActivityIndicator, Switch, Platform, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import * as Notifications from "expo-notifications";
import BottomBar from "../components/BottomBar";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { syncPushTokenIfGranted } from "../lib/push";
import { tap, selection } from '../utils/haptics';

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

  const handleToggleComments = async (val: boolean) => {
    selection();
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
    selection();
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
    selection();
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
    selection();
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
    selection();
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
          <Pressable onPress={() => { tap(); router.back(); }} hitSlop={8}>
            <Text style={[s.back, { color: tc.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: tc.text }]}>Settings</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} keyboardShouldPersistTaps="handled" alwaysBounceVertical>
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

          {/* Push bottom actions down */}
          <View style={{ flexGrow: 1 }} />

          {/* Edit Profile — primary action */}
          <Pressable
            style={[s.prominentBtn, { backgroundColor: tc.primary }]}
            onPress={() => { tap(); if (profile?.username) router.push(`/profile/${profile.username}`); }}
          >
            <Text style={s.prominentBtnTxt}>Edit Profile</Text>
          </Pressable>

          {/* Dark mode — inverse color scheme */}
          <Pressable
            style={[s.prominentBtn, { backgroundColor: isDark ? '#FFFFFF' : '#111827' }]}
            onPress={() => { selection(); toggleTheme(); }}
          >
            <Text style={[s.prominentBtnTxt, { color: isDark ? '#111827' : '#FFFFFF' }]}>
              {isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </Text>
          </Pressable>

          {/* Advanced Settings */}
          <Pressable
            style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}
            onPress={() => { tap(); router.push("/advanced-settings"); }}
          >
            <Text style={[s.link, { color: tc.primary }]}>Advanced Settings</Text>
            <Text style={[s.subtle, { color: tc.subtle }]}>›</Text>
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
  back: { color: colors.primary, fontWeight: "800", fontSize: 16, width: 48 },
  title: { color: colors.text, fontWeight: "800", fontSize: 18, textAlign: "center" },

  body: { flex: 1 },
  bodyContent: { flexGrow: 1, padding: 16, paddingBottom: 120 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  link: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtle: { color: colors.subtle, fontSize: 14 },
  prominentBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  prominentBtnTxt: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});
