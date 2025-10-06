// components/FriendsList.tsx
import React from "react";
import { Pressable, StyleSheet, Text, View, Switch } from "react-native";
import { colors } from "./ui/colors";
import { Friend } from "./types";

type RowProps = {
  item: Friend;
  busy: boolean;
  onRemove: () => void;
  // NEW: block handler
  onBlock: () => void;
  // per-friend notification preference
  notify?: boolean;
  onToggleNotify?: (value: boolean) => void;
};

function Row({ item, busy, onRemove, onBlock, notify = false, onToggleNotify }: RowProps) {
  const disabled = busy || !item.uid;

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {item.username?.[0]?.toUpperCase() || "?"}
        </Text>
      </View>

      {/* Name */}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.username}</Text>
      </View>

      {/* Notifications toggle (minimal, inline) */}
      <View style={styles.notifyWrap}>
        <Text style={styles.notifyLabel}>Notifications?</Text>
        <Switch
          value={!!notify}
          onValueChange={(v) => onToggleNotify && onToggleNotify(v)}
          disabled={disabled}
        />
      </View>

      {/* Block button */}
      <Pressable
        disabled={disabled}
        onPress={onBlock}
        hitSlop={10}
        style={[styles.iconBtn, { opacity: disabled ? 0.5 : 1 }]}
      >
        <Text style={styles.iconTxt}>⛔</Text>
      </Pressable>

      {/* Remove (unfriend) button */}
      <Pressable
        disabled={disabled}
        onPress={onRemove}
        hitSlop={10}
        style={[styles.iconBtn, { opacity: disabled ? 0.5 : 1 }]}
      >
        <Text style={styles.iconTxt}>🗑️</Text>
      </Pressable>
    </View>
  );
}

const FriendsList = { Row };
export default FriendsList;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.card,
  },
  rowTitle: { fontWeight: "700", color: colors.text },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  // circular icon button
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconTxt: {
    fontSize: 18,
    lineHeight: 22,
  },
  notifyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  notifyLabel: {
    fontSize: 11,
    color: colors.subtle,
    marginBottom: 4,
  },
});
