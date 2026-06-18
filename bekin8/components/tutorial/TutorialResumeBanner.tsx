// components/tutorial/TutorialResumeBanner.tsx
// A slim top banner that persists until the user finishes base setup (username + friend +
// notifications). It shows progress and, when tapped, jumps the tour to the earliest incomplete
// step. Driven by useOnboarding() via its host screen — not by whether the tour was watched.
import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { tap } from "../../utils/haptics";

type Props = {
  visible: boolean;
  onPress: () => void;
  doneCount: number;
  total: number;
  /** Label of the earliest incomplete step, e.g. "Add a friend". */
  nextLabel?: string;
};

export default function TutorialResumeBanner({ visible, onPress, doneCount, total, nextLabel }: Props) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.banner, { backgroundColor: colors.primary }]}
      accessibilityRole="button"
      accessibilityLabel={`Finish setting up BeKin, ${doneCount} of ${total} done.${nextLabel ? ` Next: ${nextLabel}.` : ""}`}
    >
      <Ionicons name="rocket-outline" size={20} color="#fff" />
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          Finish setting up BeKin
        </Text>
        {nextLabel ? (
          <Text style={styles.sub} numberOfLines={1}>
            {`Next: ${nextLabel}`}
          </Text>
        ) : null}
      </View>
      {/* Progress pips — filled for completed steps. */}
      <View style={styles.pips}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[styles.pip, { backgroundColor: i < doneCount ? "#fff" : "rgba(255,255,255,0.35)" }]} />
        ))}
      </View>
      <Text style={styles.cta}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 12,
  },
  textWrap: { flex: 1 },
  title: { color: "#fff", fontSize: 14, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600", marginTop: 1 },
  pips: { flexDirection: "row", gap: 4 },
  pip: { width: 7, height: 7, borderRadius: 4 },
  cta: { color: "#fff", fontSize: 18, fontWeight: "800" },
});
