// components/tutorial/TutorialButton.tsx
// A small "?" affordance screens drop in to re-open a tutorial on demand.
// Re-opening does NOT reset the seen flag; the flag only governs the automatic first-run.
import React from "react";
import { Pressable, Text, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { tap } from "../../utils/haptics";

type Props = {
  onPress: () => void;
  label?: string;
  size?: number;
  color?: string;
  style?: ViewStyle;
};

export default function TutorialButton({ onPress, label, size = 22, color, style }: Props) {
  const { colors } = useTheme();
  const tint = color ?? colors.subtle;
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.btn, style]}
      accessibilityRole="button"
      accessibilityLabel={label ?? "Replay tutorial"}
    >
      <Ionicons name="help-circle-outline" size={size} color={tint} />
      {label ? <Text style={[styles.label, { color: tint }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 14, fontWeight: "600" },
});
