import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../../providers/ThemeProvider";

export default function Terms() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <>
      <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]} edges={["top", "left", "right"]}>
        <View style={[s.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={[s.back, { color: colors.primary }]}>{`← Back`}</Text>
          </Pressable>
          <Text style={[s.title, { color: colors.text }]}>Terms of Service</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Text style={[s.p, { color: colors.text }]}>
            By using the app, you agree to follow our Community Guidelines and applicable laws.
            You are responsible for the content you post. We may remove content or suspend
            accounts that violate these terms.
          </Text>
          <Text style={[s.h2, { color: colors.text }]}>Community Guidelines (UGC)</Text>
          <Text style={[s.p, { color: colors.text }]}>
            No hate speech, harassment, threats, doxxing, sexual exploitation, or illegal content.
            Respect others. Use the built-in Report and Block tools to keep your experience safe.
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
  h2: { fontSize: 18, fontWeight: "800", marginTop: 8, marginBottom: 6 },
  p: { fontSize: 16, lineHeight: 22, marginBottom: 12 },
});
