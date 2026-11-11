import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Switch, ScrollView, Share, Platform } from "react-native";
import { WEB_WHITE_KNOB } from "@/components/ui/webSwitch";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import BottomBar from "../components/BottomBar";
import { SCREEN_PAD } from "../components/ui/layout";
import { useAuth } from "../providers/AuthProvider";
import { useTheme, type ThemePref } from "../providers/ThemeProvider";
import { ensureNotifyPermission } from "../lib/notifyPermission";
import { useTourTarget } from "../providers/TourProvider";
import { tap, selection } from '../utils/haptics';
import { logout } from '../lib/logout';
import { buildInviteUrl, prefetchMyInviteCode } from '../lib/inviteLink';

const APP_STORE_URL = 'https://apps.apple.com/app/id6746952014';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.waldgrave.bekin';

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
  const { colors: tc, pref, setPref } = useTheme();

  const shareApp = async () => {
    tap();
    const uid = auth.currentUser?.uid;
    const code = uid ? await prefetchMyInviteCode(uid) : null;
    try {
      if (code) {
        const url = buildInviteUrl(code);
        // iOS shares a URL as a rich link; Android ignores `url`, so the link is the message.
        await (Platform.OS === "ios" ? Share.share({ url }) : Share.share({ message: url }));
      } else {
        await Share.share({ message: `BeKin\niPhone: ${APP_STORE_URL}\nAndroid: ${PLAY_STORE_URL}` });
      }
    } catch {
      // cancelled or share sheet failed: nothing to do
    }
  };
  const insets = useSafeAreaInsets();
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
  const commentsTarget = useTourTarget("settings-comments");
  const commentNotifyTarget = useTourTarget("settings-comment-notify");

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
        {/* Header: Back on the LEFT, Settings title centered, Log out on the RIGHT. Left/right
            slots are equal-width so the title stays optically centered. */}
        <View style={[s.header, { backgroundColor: tc.card, borderBottomColor: tc.border }]}>
          <Pressable onPress={() => { tap(); router.back(); }} hitSlop={8} style={s.headerSlotLeft}>
            <Text style={[s.back, { color: tc.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: tc.text }]}>Settings</Text>
          <Pressable
            onPress={async () => { tap(); await logout(); }}
            hitSlop={8}
            style={s.headerSlotRight}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Ionicons name="log-out-outline" size={22} color={tc.danger} />
            <Text style={[s.logoutTxt, { color: tc.danger }]}>Log out</Text>
          </Pressable>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} keyboardShouldPersistTaps="handled" alwaysBounceVertical>
          {/* Full control group, spotlighted together by the beacon onboarding tour ("You're in
              control"): the how-we-use link + the comments toggle + all notification toggles. */}
          <View>
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
              {...WEB_WHITE_KNOB}
            />
          </View>

          {/* Notify: comments on RSVP'd beacons */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>RSVP beacon comment notifications</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when someone comments on a beacon you&apos;ve RSVP&apos;d to</Text>
            </View>
            <Switch
              value={commentNotify}
              onValueChange={handleToggleCommentNotify}
              disabled={commentNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
              {...WEB_WHITE_KNOB}
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
              {...WEB_WHITE_KNOB}
            />
          </View>

          {/* Notify: new comments on posts I've commented on */}
          <View style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Comments on comments</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Get notified when someone comments on a post you&apos;ve commented on</Text>
            </View>
            <Switch
              value={commentOnCommentNotify}
              onValueChange={handleToggleCommentOnCommentNotify}
              disabled={commentOnCommentNotifyBusy}
              trackColor={{ false: tc.border, true: tc.primary }}
              thumbColor="#fff"
              {...WEB_WHITE_KNOB}
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
              {...WEB_WHITE_KNOB}
            />
          </View>
          </View>

          {/* Share BeKin: shares YOUR friend link, so whoever installs through it lands on the right
              store for their phone AND is connected to you automatically. The bare link only (same
              rule as the Friends page share). No username yet = no link, so plain store links. */}
          <Pressable
            style={[s.row, s.rowBetween, { borderBottomColor: tc.border }]}
            onPress={shareApp}
            accessibilityRole="button"
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: tc.primary }]}>Share BeKin</Text>
              <Text style={[s.subtle, { color: tc.subtle }]}>Friends who join through your link connect with you automatically</Text>
            </View>
            <Ionicons name="share-outline" size={20} color={tc.primary} />
          </Pressable>

          {/* Fire sounds live on the beacon page itself (the little volume button), not here. */}
        </ScrollView>

        {/* Leftover space sits BETWEEN the rows and the bottom action group, so the buttons anchor
            just above Advanced Settings at the bottom instead of dangling under the last row. On
            small screens this collapses to 0 and the rows above become scrollable. */}
        <View style={{ flex: 1 }} />

        {/* Bottom action group: Edit Profile + theme toggle + Advanced Settings, always visible
            above the BottomBar on every device, at every scroll position. */}
        <View style={[s.bottomGroup, { marginBottom: 64 + Math.max(insets.bottom, 8) }]}>
          {/* Edit Profile, primary action */}
          <Pressable
            style={[s.prominentBtn, { backgroundColor: tc.primary }]}
            onPress={() => { tap(); if (profile?.username) router.push(`/profile/${profile.username}`); }}
          >
            <Text style={s.prominentBtnTxt}>Edit Profile</Text>
          </Pressable>

          {/* Theme: System (follow the phone's light/dark setting), Light, or Dark. Same footprint as
              the button it replaced. */}
          <View
            style={[s.themeRow, { backgroundColor: tc.inputBg, borderColor: tc.border }]}
            accessibilityRole="radiogroup"
          >
            {THEME_OPTIONS.map((o) => {
              const on = pref === o.key;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => { selection(); setPref(o.key); }}
                  style={[s.themeSeg, on && { backgroundColor: tc.primary }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${o.label} theme`}
                >
                  <Ionicons name={o.icon} size={16} color={on ? '#FFFFFF' : tc.subtle} />
                  <Text style={[s.themeSegTxt, { color: on ? '#FFFFFF' : tc.text }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [s.advancedLink, pressed && { opacity: 0.6 }]}
            onPress={() => { tap(); router.push("/advanced-settings"); }}
            hitSlop={8}
          >
            <Text style={[s.link, { color: tc.primary }]}>Advanced Settings ›</Text>
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
  back: { color: colors.primary, fontWeight: "800", fontSize: 16 },
  title: { flex: 1, color: colors.text, fontWeight: "800", fontSize: 18, textAlign: "center" },
  // Equal-width left/right slots keep the centered title optically centered. The right slot's
  // logout control (icon + label) sets the width both slots share.
  headerSlotLeft: { width: 92, alignItems: "flex-start" },
  headerSlotRight: { width: 92, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  logoutTxt: { color: colors.danger, fontWeight: "800", fontSize: 16, marginLeft: 4 },

  // The scroll area takes only its content's height, shrinking into a scrollable region when the
  // rows don't fit (small phones); the flexible spacer + bottom action group below it stay put.
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { padding: SCREEN_PAD, paddingBottom: 8 },
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
  // Bottom action group: Edit Profile + theme toggle + the Advanced Settings link, pinned above
  // the BottomBar (marginBottom applied inline, insets-aware).
  bottomGroup: {
    paddingHorizontal: SCREEN_PAD,
    paddingTop: 8,
  },
  // Equal padding above and below the text, and the Light Mode button above contributes no
  // margin, so the link sits dead-center between that button and the BottomBar.
  advancedLink: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
  // Zero-width anchor pinned a space-width before the label's first character; the mode icon hangs
  // off its RIGHT edge. left: -5 = the gap between the icon's right edge and the label (roughly the
  // original single-space width). The Ionicons glyph has a KNOWN width (= its size) and renders
  // identically on simulator and device (emoji tofu advances made this unverifiable), so right: 0
  // inside the anchor is exact; top: 1 optically aligns the 17pt icon with the 16pt bold label.
  // Theme row: three equal segments in the old toggle button's footprint.
  themeRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  themeSeg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  themeSegTxt: { fontSize: 15, fontWeight: "700" },
});

const THEME_OPTIONS: { key: ThemePref; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "system", label: "System", icon: "phone-portrait-outline" },
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
];
