// components/FriendsProfileAndInvite.tsx
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "./ui/colors";
import { MessageState } from "./types";
import { useTheme } from "../providers/ThemeProvider";
import { useTourTarget } from "../providers/TourProvider";
import { press } from "../utils/haptics";

type Props = {
  currentUsername: string | null;
  usernameInput: string;
  onChangeUsername: (v: string) => void;
  onSaveUsername: () => void;
  busyUsername: boolean;

  displayName: string | null;
  onPressDisplayName: () => void;

  nameInput: string;
  onChangeName: (v: string) => void;
  hasProfileUsername: boolean;
  onSendRequest: () => void;
  busySend: boolean;

  inviteCode?: string | null;
  onShareInvite?: () => void;

  message: MessageState;
};

export default function FriendsProfileAndInvite({
  currentUsername,
  usernameInput,
  onChangeUsername,
  onSaveUsername,
  busyUsername,
  displayName,
  onPressDisplayName,
  nameInput,
  onChangeName,
  hasProfileUsername,
  onSendRequest,
  busySend,
  inviteCode,
  onShareInvite,
  message,
}: Props) {
  const { colors } = useTheme();
  // Tour targets: step "Pick your username" spotlights ONLY the username block; the next step
  // ("Your name & invite link") spotlights the invite block (and mentions the display name above).
  const usernameTarget = useTourTarget("friends-username");
  const inviteTarget = useTourTarget("friends-invite");
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {/* Username + display name */}
      {currentUsername ? (
        <>
          <View style={styles.usernameRow}>
            <View ref={usernameTarget} collapsable={false}>
              <Text style={[styles.label, { color: colors.text, marginBottom: 4 }]}>Your username</Text>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{currentUsername}</Text>
            </View>
            <Pressable onPress={() => { press(); onPressDisplayName(); }} hitSlop={8}>
              <Text style={[styles.label, { color: colors.text, marginBottom: 4 }]}>Display name</Text>
              <Text style={[styles.displayNameLink, { color: colors.primary }]} numberOfLines={1} ellipsizeMode="tail">
                {displayName || 'Set display name'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View ref={usernameTarget} collapsable={false}>
          <Text style={[styles.label, { color: colors.text }]}>Set your username</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={usernameInput}
              onChangeText={onChangeUsername}
              placeholder="choose_a_username"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text }]}
              returnKeyType="done"
              onSubmitEditing={onSaveUsername}
            />
            <Pressable
              disabled={busyUsername}
              onPress={() => { press(); onSaveUsername(); }}
              style={[styles.btn, { paddingHorizontal: 16, opacity: busyUsername ? 0.6 : 1, backgroundColor: colors.primary }]}
            >
              {busyUsername ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {/* Invite a friend — share your smart link / code. Hidden until a username exists, since the
          invite code is only minted once a username is set. */}
      {onShareInvite &&
        (currentUsername ? (
          <View ref={inviteTarget} collapsable={false} style={[styles.cardInner, { marginTop: 14 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Invite friends</Text>
            <Text style={[styles.subtle, { color: colors.subtle, marginBottom: 8 }]}>
              Share your link — when a friend joins (or already has BeKin), you’re instantly connected.
            </Text>
            <View style={styles.inputRow}>
              <View style={[styles.codeBox, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
                <Text style={[styles.codeTxt, { color: colors.text }]}>{inviteCode ?? "······"}</Text>
              </View>
              <Pressable
                disabled={!inviteCode}
                onPress={() => { press(); onShareInvite(); }}
                style={[styles.btn, { paddingHorizontal: 16, opacity: inviteCode ? 1 : 0.5, backgroundColor: colors.primary }]}
              >
                <Text style={styles.btnText}>Share</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View ref={inviteTarget} collapsable={false} style={[styles.cardInner, { marginTop: 14 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Invite friends</Text>
            <Text style={[styles.subtle, { color: colors.subtle }]}>
              Pick a username above to unlock your shareable invite link.
            </Text>
          </View>
        ))}

      {/* Add Friend */}
      <View style={[styles.cardInner, { marginTop: 14 }]}>
        <Text style={[styles.label, { color: colors.text }]}>Send a Friend Request (by username)</Text>
        {!hasProfileUsername && (
          <Text style={[styles.subtle, { marginBottom: 8, color: colors.subtle }]}>You need a username first.</Text>
        )}
        <View style={styles.inputRow}>
          <TextInput
            value={nameInput}
            onChangeText={onChangeName}
            placeholder="friend_username"
            placeholderTextColor={colors.subtle}
            autoCapitalize="none"
            style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text }, !hasProfileUsername && { backgroundColor: colors.skeleton }]}
            editable={hasProfileUsername}
            returnKeyType="done"
            onSubmitEditing={hasProfileUsername ? onSendRequest : undefined}
          />
          <Pressable
            disabled={busySend || !hasProfileUsername}
            onPress={() => { press(); onSendRequest(); }}
            style={[styles.btn, { paddingHorizontal: 16, opacity: busySend || !hasProfileUsername ? 0.5 : 1, backgroundColor: colors.primary }]}
          >
            {busySend ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send</Text>}
          </Pressable>
        </View>

        {message.type && (
          <Text
            style={[
              styles.message,
              message.type === "error" ? { color: colors.error } : { color: colors.success },
            ]}
          >
            {message.text}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    marginBottom: 14,
  },
  cardInner: { },
  label: { fontWeight: "700", marginBottom: 10, color: colors.text },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  inputDisabled: {
    backgroundColor: "#F3F4F6",
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "800" },
  message: { marginTop: 10, fontWeight: "600" },
  codeBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
  },
  codeTxt: { fontSize: 20, fontWeight: "800", letterSpacing: 4 },
  usernameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  displayNameLink: { fontWeight: "700", textDecorationLine: "underline" },
  rowTitle: { fontWeight: "700", color: colors.text },
  subtle: { color: colors.subtle },
});