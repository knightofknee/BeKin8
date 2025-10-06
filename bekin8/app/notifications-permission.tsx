import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { auth, db } from "../firebase.config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const colors = {
  primary: "#2F6FED",
  text: "#111827",
  subtle: "#6B7280",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  border: "#E5E7EB",
};

export default function NotificationsPermission() {
  const [busy, setBusy] = useState(false);

  const request = async () => {
    try {
      setBusy(true);
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission declined", "You can enable notifications later in Settings.");
        return;
      }
      // iOS needs projectId configured in app.json for getExpoPushTokenAsync
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      const uid = auth.currentUser?.uid;
      if (uid) {
        // Your rules allow user to manage their own doc in PushTokens/{uid}
        await setDoc(doc(db, "PushTokens", uid), { uid, token, updatedAt: serverTimestamp() });
      }
      Alert.alert("Enabled", "We’ll notify you about friends, beacons, and requests.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.h1}>Turn on notifications?</Text>
      <Text style={s.p}>
        We use notifications to let you know when friends light beacons, interact with your posts, or send requests.
        You can turn this off anytime in system settings.
      </Text>
      <Pressable style={s.btn} onPress={request} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Allow notifications</Text>}
      </Pressable>
      <Pressable onPress={() => Alert.alert("Skipped", "You can enable them later.")}>
        <Text style={s.skip}>Not now</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:{ flex:1, padding:16, backgroundColor: colors.bg, justifyContent:"center" },
  h1:{ fontSize:22, fontWeight:"800", marginBottom:12, color: colors.text },
  p:{ fontSize:16, lineHeight:22, marginBottom:16, color: colors.subtle },
  btn:{ backgroundColor: colors.primary, padding:14, borderRadius:12, alignItems:"center" },
  btnText:{ color:"#fff", fontSize:16, fontWeight:"800" },
  skip:{ marginTop:12, color: colors.subtle, textAlign:"center" }
});
