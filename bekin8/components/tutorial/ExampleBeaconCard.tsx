// components/tutorial/ExampleBeaconCard.tsx
// A purely illustrative "what a friend's beacon looks like" card for new users with
// zero friends. It is LOCAL-ONLY, never written to Firestore, so it can't leak into
// real queries or notifications, and the real list naturally replaces it once a friend
// beacon arrives. Visibly marked as an example (dashed border, dimmed, "Example" pill).
// Tapping it opens a full LOCAL demo chat room (RSVP + composer, notifies no one), so a
// brand-new user can feel the whole loop before they have a single friend.
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
import { tap } from "../../utils/haptics";
import DemoChatRoom from "./DemoChatRoom";

type Props = {
  /** Caption under the card. Pass null to hide it (e.g. when surrounding copy already explains). */
  caption?: string | null;
};

const DEFAULT_CAPTION = "Example: a friend's lit beacon will appear here. Tap it to try the chat.";

export default function ExampleBeaconCard({ caption = DEFAULT_CAPTION }: Props) {
  const { colors } = useTheme();
  const [demoOpen, setDemoOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => { tap(); setDemoOpen(true); }}
        style={({ pressed }) => [
          styles.card,
          { borderColor: colors.border, backgroundColor: colors.inputBg },
          pressed && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Example beacon. Tap to try a demo chat."
      >
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
      </Pressable>
      {caption ? <Text style={[styles.caption, { color: colors.subtle }]}>{caption}</Text> : null}
      <DemoChatRoom visible={demoOpen} onClose={() => setDemoOpen(false)} />
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
