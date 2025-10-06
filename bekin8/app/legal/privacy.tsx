// app/legal/privacy.tsx
import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
};

// TODO: replace with your real canonical URL
const PRIVACY_URL = "https://waldgrave.com/bekinPrivacy";

export default function Privacy() {
  const router = useRouter();

  const openWeb = () => {
    Linking.openURL(PRIVACY_URL).catch(() => {
      // no-op; optionally toast
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={s.back}>{`← Back`}</Text>
        </Pressable>
        <Text style={s.title}>Privacy Policy</Text>
        <Pressable onPress={openWeb} hitSlop={8} style={s.webBtn}>
          <Text style={s.webTxt}>View on web ↗</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* Inline link near top as well (optional but handy) */}
        <Pressable onPress={openWeb} hitSlop={8} style={s.inlineWeb}>
          <Text style={s.inlineWebTxt}>{PRIVACY_URL.replace(/^https?:\/\//, "")} ↗</Text>
        </Pressable>

        <Text style={s.p}>
          We collect account information (email/UID), profile data (username, display name),
          user-generated content (posts, comments, beacons), social graph (friends/blocks),
          and device push tokens. Data is stored in Firebase Authentication, Firestore, and
          (if you upload media) Firebase Storage. We use this data to enable core app features
          (accounts, feeds, notifications) and to keep the community safe (reporting, blocking, moderation).
        </Text>
        <Text style={s.p}>
          You can delete your account in Settings → Delete Account; this removes your authentication
          record and deletes your personal data from our systems. Some content may be anonymized or removed
          where required to protect other users.
        </Text>
        <Text style={s.p}>
          For any questions or requests, contact support at support@yourdomain.com.
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  title: { color: colors.text, fontWeight: "800", fontSize: 18, textAlign: "center" },
  webBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  webTxt: { color: colors.primary, fontWeight: "800", fontSize: 13 },

  content: { padding: 16, paddingBottom: 100 },
  inlineWeb: { marginBottom: 8, alignSelf: "flex-start" },
  inlineWebTxt: { color: colors.primary, fontWeight: "700" },

  p: { fontSize: 16, lineHeight: 22, color: colors.text, marginBottom: 12 },
});
