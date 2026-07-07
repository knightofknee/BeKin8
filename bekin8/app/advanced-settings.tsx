import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Switch,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import BottomBar from "../components/BottomBar";
import { SCREEN_PAD } from "../components/ui/layout";
import { useTheme } from "../providers/ThemeProvider";
import { selection } from "../utils/haptics";

const FEEDBACK_URL = "https://forms.gle/7Lyih79emL37g2ke8";

export default function AdvancedSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const functions = getFunctions();

  // Friends-of-friends posts opt-in (symmetric; lives on Profiles/{uid}.friendsOfFriendsPosts)
  const [fofEnabled, setFofEnabled] = useState(false);
  const [fofBusy, setFofBusy] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, "Profiles", uid), (snap) => {
      if (snap.exists()) setFofEnabled(!!(snap.data() as any)?.friendsOfFriendsPosts);
    });
    return unsub;
  }, []);

  const handleToggleFriendsOfFriends = async (val: boolean) => {
    selection();
    const uid = auth.currentUser?.uid;
    if (!uid || fofBusy) return;
    setFofEnabled(val);
    setFofBusy(true);
    try {
      await setDoc(doc(db, "Profiles", uid), { friendsOfFriendsPosts: val, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setFofEnabled(!val);
    } finally {
      setFofBusy(false);
    }
  };

  // Delete account
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  return (
    <>
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={["top", "left", "right"]}>
        <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[s.back, { color: colors.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: colors.text }]}>Advanced</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} keyboardShouldPersistTaps="handled">
          <Text style={[s.h2, { color: colors.text }]}>Friends of friends</Text>
          <View style={[s.row, s.rowBetween, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.link, { color: colors.primary }]}>See friends-of-friends posts</Text>
              <Text style={[s.rowSub, { color: colors.subtle }]}>
                Adds posts from friends of your friends to your feed. Only applies to people who turn this on too, and they will see your posts as well.
              </Text>
            </View>
            <Switch
              value={fofEnabled}
              onValueChange={handleToggleFriendsOfFriends}
              disabled={fofBusy}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>

          <View style={[s.divider, { backgroundColor: colors.border }]} />

          <Text style={[s.h2, { color: colors.text }]}>Contact</Text>
          <Pressable style={[s.row, { borderBottomColor: colors.border }]} onPress={() => Linking.openURL(FEEDBACK_URL).catch(() => {})}>
            <Text style={[s.link, { color: colors.primary }]}>Send feedback</Text>
          </Pressable>

          <View style={[s.divider, { backgroundColor: colors.border }]} />

          <Text style={[s.h2, { color: colors.text }]}>Legal</Text>
          <Pressable style={[s.row, { borderBottomColor: colors.border }]} onPress={() => router.push("/legal/privacy")}>
            <Text style={[s.link, { color: colors.primary }]}>Privacy Policy</Text>
          </Pressable>
          <Pressable style={[s.row, { borderBottomColor: colors.border }]} onPress={() => router.push("/legal/terms")}>
            <Text style={[s.link, { color: colors.primary }]}>Terms of Service</Text>
          </Pressable>
          <Pressable style={[s.row, { borderBottomColor: colors.border }]} onPress={() => router.push("/legal/guidelines")}>
            <Text style={[s.link, { color: colors.primary }]}>Community Guidelines</Text>
          </Pressable>

          <View style={[s.divider, { backgroundColor: colors.border }]} />

          <Text style={[s.h2, { color: colors.text }]}>Danger zone</Text>
          <Pressable style={[s.button, { backgroundColor: colors.danger }]} onPress={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Delete Account</Text>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <BottomBar />
    </>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: 52, paddingHorizontal: 12, borderBottomWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  back: { fontWeight: "800", fontSize: 16, width: 48 },
  title: { fontWeight: "800", fontSize: 18, textAlign: "center" },
  body: { flex: 1 },
  // paddingTop 20 gives the FIRST section heading the same breathing room below the header's
  // border that later sections get below their dividers (divider marginVertical is 20).
  bodyContent: { padding: SCREEN_PAD, paddingTop: 20, paddingBottom: 120 },
  h2: { fontSize: 18, fontWeight: "800", marginBottom: 6 },
  row: { paddingVertical: 14, borderBottomWidth: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowSub: { fontSize: 14 },
  link: { fontSize: 16, fontWeight: "700" },
  divider: { height: 1, marginVertical: 20 },
  button: { padding: 14, borderRadius: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
