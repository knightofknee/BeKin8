// app/legal/privacy.tsx
import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../../providers/ThemeProvider";

const PRIVACY_URL = "https://waldgrave.com/bekinPrivacy";

export default function Privacy() {
  const { colors } = useTheme();
  const router = useRouter();

  const openWeb = () => {
    Linking.openURL(PRIVACY_URL).catch(() => {});
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={["top", "left", "right"]}>
      <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[s.back, { color: colors.primary }]}>{`← Back`}</Text>
        </Pressable>
        <Text style={[s.title, { color: colors.text }]}>Privacy Policy</Text>
        <Pressable onPress={openWeb} hitSlop={8} style={s.webBtn}>
          <Text style={[s.webTxt, { color: colors.primary }]}>View on web ↗</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={openWeb} hitSlop={8} style={s.inlineWeb}>
          <Text style={[s.inlineWebTxt, { color: colors.primary }]}>{PRIVACY_URL.replace(/^https?:\/\//, "")} ↗</Text>
        </Pressable>

        <Text style={[s.p, { color: colors.text }]}>
          We collect account information (email/UID), profile data (username, display name),
          user-generated content (posts, comments, beacons), social graph (friends/blocks),
          and device push tokens. Data is stored in Firebase Authentication, Firestore, and
          (if you upload media) Firebase Storage. We use this data to enable core app features
          (accounts, feeds, notifications) and to keep the community safe (reporting, blocking, moderation).
        </Text>
        <Text style={[s.p, { color: colors.text }]}>
          You can delete your account in Settings → Delete Account; this removes your authentication
          record and deletes your personal data from our systems. Some content may be anonymized or removed
          where required to protect other users.
        </Text>
        <Text style={[s.p, { color: colors.text }]}>
          For any questions or requests, contact support at support@yourdomain.com.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: 52, paddingHorizontal: 12, borderBottomWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  back: { fontWeight: "800", fontSize: 16 },
  title: { fontWeight: "800", fontSize: 18, textAlign: "center" },
  webBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  webTxt: { fontWeight: "800", fontSize: 13 },
  content: { padding: 16, paddingBottom: 100 },
  inlineWeb: { marginBottom: 8, alignSelf: "flex-start" },
  inlineWebTxt: { fontWeight: "700" },
  p: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
});
