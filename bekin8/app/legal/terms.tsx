import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
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

export default function Terms() {
  const router = useRouter();

  return (
    <>
      <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={s.back}>{`← Back`}</Text>
          </Pressable>
          <Text style={s.title}>Terms of Service</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.p}>
            By using the app, you agree to follow our Community Guidelines and applicable laws.
            You are responsible for the content you post. We may remove content or suspend
            accounts that violate these terms.
          </Text>
          <Text style={s.h2}>Community Guidelines (UGC)</Text>
          <Text style={s.p}>
            No hate speech, harassment, threats, doxxing, sexual exploitation, or illegal content.
            Respect others. Use the built-in Report and Block tools to keep your experience safe.
          </Text>
        </ScrollView>
      </SafeAreaView>
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

  content: { padding: 16, paddingBottom: 100 },
  h2: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 8, marginBottom: 6 },
  p: { fontSize: 16, lineHeight: 22, color: colors.text, marginBottom: 12 },
});
