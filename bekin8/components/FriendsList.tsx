// components/FriendsList.tsx
import React, { useRef, useCallback } from "react";
import { Pressable, StyleSheet, Text, View, Switch, GestureResponderEvent } from "react-native";
import { colors } from "./ui/colors";
import { Friend } from "./types";
import { useTheme } from "../providers/ThemeProvider";
import { tap, warning, selection } from "../utils/haptics";

type RowProps = {
  item: Friend;
  busy: boolean;
  onRemove: () => void;
  onBlock: () => void;
  notify?: boolean;
  onToggleNotify?: (value: boolean) => void;
  onPressName?: () => void;
  onDoubleTap?: () => void;
  showUsername?: boolean; // show @username disambiguator when displayNames collide
  notifyDisabled?: boolean; // master "notify all" is ON — show as on but grayed out
};

function Row({ item, busy, onRemove, onBlock, notify = false, onToggleNotify, onPressName, onDoubleTap, showUsername, notifyDisabled }: RowProps) {
  const { colors } = useTheme();
  const disabled = busy || !item.uid;
  const lastTapRef = useRef(0);

  const handleRowPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      onDoubleTap?.();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [onDoubleTap]);

  return (
    <Pressable onPress={handleRowPress} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Avatar — tappable to view profile */}
      <Pressable
        onPress={() => { tap(); onPressName?.(); }}
        disabled={!onPressName}
        hitSlop={4}
        style={[styles.avatar, { backgroundColor: item.profileColor || colors.primary }, onPressName && styles.avatarTappable]}
      >
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {(item.displayName || item.username)?.[0]?.toUpperCase() || "?"}
        </Text>
      </Pressable>

      {/* Name */}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{item.displayName || item.username}</Text>
        {showUsername && item.displayName && (
          <Text style={[styles.rowSubtitle, { color: colors.subtle }]}>@{item.username}</Text>
        )}
      </View>

      {/* Notifications toggle (minimal, inline) */}
      <View style={[styles.notifyWrap, notifyDisabled && { opacity: 0.4 }]}>
        <Text style={[styles.notifyLabel, { color: colors.subtle }]}>Notifications?</Text>
        <Switch
          value={notifyDisabled ? true : !!notify}
          onValueChange={(v) => { selection(); onToggleNotify && onToggleNotify(v); }}
          disabled={disabled || notifyDisabled}
        />
      </View>

      {/* Block button */}
      <Pressable
        disabled={disabled}
        onPress={() => { warning(); onBlock(); }}
        hitSlop={10}
        style={[styles.iconBtn, { opacity: disabled ? 0.5 : 1, backgroundColor: colors.inputBg, borderColor: colors.border }]}
      >
        <Text style={styles.iconTxt}>⛔</Text>
      </Pressable>

      {/* Remove (unfriend) button */}
      <Pressable
        disabled={disabled}
        onPress={() => { warning(); onRemove(); }}
        hitSlop={10}
        style={[styles.iconBtn, { opacity: disabled ? 0.5 : 1, backgroundColor: colors.inputBg, borderColor: colors.border }]}
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
  rowSubtitle: { fontSize: 12, marginTop: 1 },
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
