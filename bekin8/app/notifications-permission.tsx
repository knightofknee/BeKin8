import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { auth, db } from "../firebase.config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ensurePushPermissionsAndToken } from "../lib/push";
import { useTheme } from "../providers/ThemeProvider";

export default function NotificationsPermission() {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const request = async () => {
    try {
      setBusy(true);
      const { granted, token } = await ensurePushPermissionsAndToken();
      if (!granted) {
        Alert.alert("Permission declined", "You can enable notifications later in Settings.");
        return;
      }
      Alert.alert("Enabled", "We'll notify you about friends, beacons, and requests.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.wrap, { backgroundColor: colors.bg }]}>
      <Text style={[s.h1, { color: colors.text }]}>Turn on notifications?</Text>
      <Text style={[s.p, { color: colors.subtle }]}>
        We use notifications to let you know when friends light beacons, interact with your posts, or send requests.
        You can turn this off anytime in system settings.
      </Text>
      <Pressable style={[s.btn, { backgroundColor: colors.primary }]} onPress={request} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Allow notifications</Text>}
      </Pressable>
      <Pressable onPress={() => Alert.alert("Skipped", "You can enable them later.")}>
        <Text style={[s.skip, { color: colors.subtle }]}>Not now</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, justifyContent: "center" },
  h1: { fontSize: 22, fontWeight: "800", marginBottom: 12 },
  p: { fontSize: 16, lineHeight: 22, marginBottom: 16 },
  btn: { padding: 14, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  skip: { marginTop: 12, textAlign: "center" },
});
