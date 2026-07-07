import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../providers/ThemeProvider";
import { ensureNotifyPermission } from "../lib/notifyPermission";
import { auth, db } from "../firebase.config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { tap, press } from "../utils/haptics";

export default function NotificationsPermission() {
  const { colors } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (busy) return;
    press();
    try {
      setBusy(true);
      const granted = await ensureNotifyPermission(
        "We use notifications to let you know when friends light beacons, RSVP or chat on yours, and send requests."
      );
      if (granted) {
        // Opt into friend-beacon pushes so the promised "a friend lit a beacon" alert actually
        // arrives. This is the flag the server's recipientWantsNotify checks. Non-fatal on failure:
        // permission is granted and the master toggle can still be set in Friends/Settings.
        const uid = auth.currentUser?.uid;
        if (uid) {
          try {
            await setDoc(
              doc(db, "Profiles", uid),
              { notifyAllBeacons: true, updatedAt: serverTimestamp() },
              { merge: true }
            );
          } catch {
            /* ignore */
          }
        }
        Alert.alert("You're all set", "We'll let you know the moment a friend lights a beacon.");
        if (router.canGoBack()) router.back();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[s.wrap, { backgroundColor: colors.bg }]} edges={["top", "left", "right"]}>
      <Pressable onPress={() => { tap(); if (router.canGoBack()) router.back(); }} hitSlop={8} style={s.back}>
        <Text style={[s.backTxt, { color: colors.primary }]}>{`← Back`}</Text>
      </Pressable>

      <View style={s.content}>
        <Text style={[s.h1, { color: colors.text }]}>Notifications</Text>
        <Text style={[s.p, { color: colors.subtle }]}>
          BeKin only notifies you about things that matter. Never spam. We send a notification
          when:
        </Text>

        <View style={s.bullets}>
          <Text style={[s.bullet, { color: colors.text }]}>🔥  A friend lights a beacon</Text>
          <Text style={[s.bullet, { color: colors.text }]}>🙋  Someone RSVPs or chats on your beacon</Text>
          <Text style={[s.bullet, { color: colors.text }]}>💬  A friend comments on your post</Text>
          <Text style={[s.bullet, { color: colors.text }]}>👋  You get a friend request</Text>
        </View>

        <Text style={[s.p, { color: colors.subtle }]}>
          You’re always in control. Turn any of these on or off any time below.
        </Text>

        <Pressable style={[s.btn, { backgroundColor: colors.primary }]} onPress={request} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Allow notifications</Text>}
        </Pressable>

        <Pressable onPress={() => { tap(); router.push("/settings"); }} style={s.manageBtn}>
          <Text style={[s.manage, { color: colors.primary }]}>Choose individual notifications</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  back: { paddingHorizontal: 16, paddingVertical: 12 },
  backTxt: { fontWeight: "800", fontSize: 16 },
  content: { flex: 1, padding: 16, justifyContent: "center" },
  h1: { fontSize: 26, fontWeight: "800", marginBottom: 12 },
  p: { fontSize: 16, lineHeight: 23, marginBottom: 14 },
  bullets: { marginBottom: 14, gap: 10 },
  bullet: { fontSize: 16, lineHeight: 22 },
  btn: { padding: 15, borderRadius: 12, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  manageBtn: { marginTop: 16, alignItems: "center" },
  manage: { fontSize: 15, fontWeight: "600" },
});
