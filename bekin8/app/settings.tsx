import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Switch, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import BottomBar from "../components/BottomBar";
import { SCREEN_PAD } from "../components/ui/layout";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { ensureNotifyPermission } from "../lib/notifyPermission";
import { getFireSoundEnabled, setFireSoundEnabled, onFireSoundChange } from "../lib/fireSoundPref";
import { useTourTarget } from "../providers/TourProvider";
import { tap, selection } from '../utils/haptics';

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
  // Device-local "Fire sounds" preference (default ON; the read below confirms).
  const [fireSounds, setFireSounds] = useState(true);
  const router = useRouter();
  const commentsTarget = useTourTarget("settings-comments");
  const commentNotifyTarget = useTourTarget("settings-comment-notify");
  const notifSectionTarget = useTourTarget("settings-notifications");

  // Seed local state from cached profile once available
  React.useEffect(() => {
    if (profile) {
      setCommentsEnabled(profile.commentsEnabled);
    }
  }, [profileLoaded]);

  // Fire-sound preference (device-local) + keep in sync if toggled elsewhere.
  useEffect(() => {
    getFireSoundEnabled().then(setFireSounds);
    return onFireSoundChange(setFireSounds);
  }, []);
  const handleToggleFireSounds = (val: boolean) => {
    selection();
    setFireSounds(val);
    setFireSoundEnabled(val);
  };

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
          {/* Full control group, spotlighted together by the beacon onboarding tour ("You're in
              control"): the how-we-use link + the comments toggle + all notification toggles. */}
          <View ref={notifSectionTarget} collapsable={false}>
          {/* How we use notifications, transparency + enable entry point */}
          <Pressable
            style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}
            onPress={() => { tap(); router.push("/notifications-permission"); }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>How we use notifications</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>What we send, and how to turn it on</Text>
            </View>
            <Text style={[s.subtle, { color: tc.subtle }]}>›</Text>
          </Pressable>

          {/* Allow comments on my posts */}
          <View ref={commentsTarget} collapsable={false} style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
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
          <View ref={commentNotifyTarget} collapsable={false} style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
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
          </View>

          {/* Fire sounds, device-local, default off (separate from the notification group above). */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Fire sounds</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Play a soft crackle while your beacon is lit</Text>
            </View>
            <Switch
              value={fireSounds}
              onValueChange={handleToggleFireSounds}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Push bottom actions down */}
          <View style={{ flexGrow: 1 }} />

          {/* Edit Profile, primary action */}
          <Pressable
            style={[s.prominentBtn, { backgroundColor: tc.primary }]}
            onPress={() => { tap(); if (profile?.username) router.push(`/profile/${profile.username}`); }}
          >
            <Text style={s.prominentBtnTxt}>Edit Profile</Text>
          </Pressable>

          {/* Dark mode, inverse color scheme. The LABEL is the only in-flow child (so it centers
              exactly like Edit Profile's text); the sun/moon is an Ionicons vector icon (identical
              rendering on simulator and device, unlike emoji) hung off a zero-width anchor a fixed
              gap left of the label, tinted to match the text. */}
          <Pressable
            style={[s.prominentBtn, { backgroundColor: isDark ? '#FFFFFF' : '#111827' }]}
            onPress={() => { selection(); toggleTheme(); }}
          >
            <View>
              <View style={s.btnEmojiAnchor}>
                {/* Tinted like the emoji were: a golden sun, a pale-gold crescent moon. The sun is
                    drawn bigger (its thin rays read smaller than the moon's solid shape at equal
                    size), with a 1pt lift to keep it optically centered on the label. */}
                <Ionicons
                  name={isDark ? 'sunny' : 'moon'}
                  size={isDark ? 21 : 17}
                  color={isDark ? '#F6B93B' : '#F5D488'}
                  style={[s.btnModeIcon, isDark && { top: -1 }]}
                />
              </View>
              <Text style={[s.prominentBtnTxt, { color: isDark ? '#111827' : '#FFFFFF' }]}>
                {isDark ? 'Light Mode' : 'Dark Mode'}
              </Text>
            </View>
          </Pressable>

        </ScrollView>

        {/* Advanced Settings: a FIXED footer pinned between the scroll area and the BottomBar,
            OUTSIDE the ScrollView. The settings content is taller than the viewport, so anything
            rendered after the buttons inside the scroll ends up below the fold; a pinned footer is
            always visible and always centered, on every device, at every scroll position. */}
        <Pressable
          style={({ pressed }) => [s.advancedFooter, pressed && { opacity: 0.6 }]}
          onPress={() => { tap(); router.push("/advanced-settings"); }}
          hitSlop={8}
        >
          <Text style={[s.link, { color: tc.primary }]}>Advanced Settings ›</Text>
        </Pressable>
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

  // The scroll area takes only its content's height (shrinking into a scrollable region when the
  // content overflows); the Advanced Settings footer below it flexes into ALL leftover space, so
  // its centered link is truly centered in whatever room is actually available.
  body: { flexGrow: 0, flexShrink: 1 },
  // The scroll area ends ABOVE the pinned Advanced Settings footer; zero bottom padding so the
  // footer owns ALL the space below the Light Mode button (any padding here sits above the footer
  // and shoves its centered link visually low).
  bodyContent: { flexGrow: 1, padding: SCREEN_PAD, paddingBottom: 0 },
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
  // Footer strip between the scroll area and the 64pt absolute BottomBar. flexGrow absorbs all
  // leftover vertical space; minHeight keeps a usable strip when the scroll content overflows.
  advancedFooter: {
    flexGrow: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    // Biases the centered link UP a bit within the strip (per on-device eyeballing).
    paddingBottom: 16,
    marginBottom: 64,
  },
  // Zero-width anchor pinned a space-width before the label's first character; the mode icon hangs
  // off its RIGHT edge. left: -5 = the gap between the icon's right edge and the label (roughly the
  // original single-space width). The Ionicons glyph has a KNOWN width (= its size) and renders
  // identically on simulator and device (emoji tofu advances made this unverifiable), so right: 0
  // inside the anchor is exact; top: 1 optically aligns the 17pt icon with the 16pt bold label.
  btnEmojiAnchor: { position: "absolute", left: -5, top: 0, bottom: 0, width: 0 },
  btnModeIcon: { position: "absolute", right: 0, top: 1 },
});
