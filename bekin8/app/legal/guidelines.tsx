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

export default function Guidelines() {
  const router = useRouter();

  return (
    <>
      <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={s.back}>{`← Back`}</Text>
          </Pressable>
          <Text style={s.title}>Community Guidelines</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.p}>
            Be kind. Don’t post illegal or harmful content. Don’t target individuals. If you see something
            that breaks the rules, report it. If someone is bothering you, block them.
          </Text>
          <Text style={s.p}>
            Breaking these rules may lead to content removal or account suspension.
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
  p: { fontSize: 16, lineHeight: 22, color: colors.text, marginBottom: 12 },
});
