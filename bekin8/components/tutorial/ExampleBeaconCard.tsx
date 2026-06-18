// components/tutorial/ExampleBeaconCard.tsx
// A purely illustrative "what a friend's beacon looks like" card for new users with
// zero friends. It is LOCAL-ONLY — never written to Firestore — so it can't leak into
// real queries or notifications, and the real list naturally replaces it once a friend
// beacon arrives. Visibly marked as an example (dashed border, dimmed, "Example" pill).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../providers/ThemeProvider";

type Props = {
  /** Caption under the card. Pass null to hide it (e.g. when surrounding copy already explains). */
  caption?: string | null;
};

const DEFAULT_CAPTION = "Example — this is how a friend's lit beacon will appear here.";

export default function ExampleBeaconCard({ caption = DEFAULT_CAPTION }: Props) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarTxt}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.owner, { color: colors.text }]} numberOfLines={1}>
              Alex
            </Text>
            <Text style={[styles.when, { color: colors.subtle }]} numberOfLines={1}>
              Today
            </Text>
            <Text style={[styles.msg, { color: colors.text }]} numberOfLines={2}>
              Coffee at the park? ☕
            </Text>
          </View>
        </View>
      </View>
      {caption ? <Text style={[styles.caption, { color: colors.subtle }]}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    flexDirection: "row",
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
    opacity: 0.75,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  avatarTxt: { color: "#fff", fontWeight: "900" },
  owner: { fontSize: 15, fontWeight: "800" },
  when: { fontSize: 13, marginTop: 2 },
  msg: { fontSize: 14, marginTop: 4 },
  caption: { fontSize: 12, marginTop: 8, textAlign: "center", fontStyle: "italic" },
});
