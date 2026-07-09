// components/tutorial/FriendsSetupCard.tsx
// A NON-BLOCKING setup help card pinned to the top of the Friends screen. Unlike the coach-mark
// tour it locks nothing: the user can freely use the username field + invite share below it. Shown
// when the resume banner's "Add a friend" step is tapped. "Next" hands off to the final tour step
// (the checklist / celebration); the X just dismisses the card.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { tap } from "../../utils/haptics";

type Props = { onNext: () => void; onDismiss: () => void };

export default function FriendsSetupCard({ onNext, onDismiss }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="people-outline" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.text }]}>Add your first friend</Text>
        </View>
        <Pressable onPress={() => { tap(); onDismiss(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={20} color={colors.subtle} />
        </Pressable>
      </View>

      <Text style={[styles.body, { color: colors.subtle }]}>Two ways to connect:</Text>
      <View style={styles.stepRow}>
        <Text style={[styles.num, { color: colors.primary }]}>1.</Text>
        <Text style={[styles.stepText, { color: colors.text }]}>
          Type a friend&apos;s username in the field below and send them a request. They connect once they accept.
        </Text>
      </View>
      <View style={styles.stepRow}>
        <Text style={[styles.num, { color: colors.primary }]}>2.</Text>
        <Text style={[styles.stepText, { color: colors.text }]}>
          Or tap Share to send your invite link. Anyone who joins through it is added automatically.
        </Text>
      </View>

      <Pressable
        onPress={() => { tap(); onNext(); }}
        style={({ pressed }) => [styles.nextBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel="Next, go to the final setup step"
      >
        <Text style={styles.nextText}>Next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 10,
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 13, fontWeight: "600", marginTop: 10 },
  stepRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  num: { fontSize: 13.5, fontWeight: "800", width: 16 },
  stepText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  nextBtn: {
    marginTop: 14,
    alignSelf: "flex-end",
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 999,
  },
  nextText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
