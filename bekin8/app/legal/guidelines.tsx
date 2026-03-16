import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../../providers/ThemeProvider";

export default function Guidelines() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <>
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={["top", "left", "right"]}>
        <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[s.back, { color: colors.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: colors.text }]}>Community Guidelines</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text style={[s.p, { color: colors.text }]}>
            Be kind. Don't post illegal or harmful content. Don't target individuals. If you see something
            that breaks the rules, report it. If someone is bothering you, block them.
          </Text>
          <Text style={[s.p, { color: colors.text }]}>
            Breaking these rules may lead to content removal or account suspension.
          </Text>
        </ScrollView>
      </SafeAreaView>
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
  content: { padding: 16, paddingBottom: 100 },
  p: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
});
