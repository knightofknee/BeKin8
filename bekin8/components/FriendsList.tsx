// components/FriendsList.tsx
import React, { useRef } from "react";
import { Pressable, StyleSheet, Text, View, Switch } from "react-native";
import { colors } from "./ui/colors";
import { Friend } from "./types";

type RowProps = {
  item: Friend;
  busy: boolean;
  onRemove: () => void;
  onBlock: () => void;
  notify?: boolean;
  onToggleNotify?: (value: boolean) => void;
  onPressName?: () => void;
  onDoubleTap?: () => void;
};

function Row({ item, busy, onRemove, onBlock, notify = false, onToggleNotify, onPressName, onDoubleTap }: RowProps) {
  const disabled = busy || !item.uid;
  const lastTap = useRef<number>(0);

  const handleRowPress = () => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      onDoubleTap();
    } else {
      lastTap.current = now;
    }
  };

  return (
    <Pressable onPress={handleRowPress} style={styles.row}>
      {/* Avatar — tappable to view profile */}
      <Pressable
        onPress={onPressName}
        disabled={!onPressName}
        hitSlop={4}
        style={[styles.avatar, item.avatarColor ? { backgroundColor: item.avatarColor } : null, onPressName && styles.avatarTappable]}
      >
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {item.username?.[0]?.toUpperCase() || "?"}
        </Text>
      </Pressable>

      {/* Name */}
      <View style={{ flex: 1 }}>
        {item.displayName ? (
          <>
            <Text style={styles.rowTitle}>{item.displayName}</Text>
            <Text style={styles.rowSubtitle}>{item.username}</Text>
          </>
        ) : (
          <Text style={styles.rowTitle}>{item.username}</Text>
        )}
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
    </Pressable>
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
  rowSubtitle: { fontSize: 12, color: colors.subtle, marginTop: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTappable: {
    opacity: 1, // keeps full color; slight scale effect comes from Pressable's pressed state
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
