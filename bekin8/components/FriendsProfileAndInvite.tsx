// components/FriendsProfileAndInvite.tsx
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "./ui/colors";
import { MessageState } from "./types";
import { useTheme } from "../providers/ThemeProvider";
import { press } from "../utils/haptics";

type Props = {
  currentUsername: string | null;
  usernameInput: string;
  onChangeUsername: (v: string) => void;
  onSaveUsername: () => void;
  busyUsername: boolean;

  nameInput: string;
  onChangeName: (v: string) => void;
  hasProfileUsername: boolean;
  onSendRequest: () => void;
  busySend: boolean;

  message: MessageState;
};

export default function FriendsProfileAndInvite({
  currentUsername,
  usernameInput,
  onChangeUsername,
  onSaveUsername,
  busyUsername,
  nameInput,
  onChangeName,
  hasProfileUsername,
  onSendRequest,
  busySend,
  message,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {/* Username */}
      {currentUsername ? (
        <>
          <Text style={[styles.label, { color: colors.text }]}>Your username</Text>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{currentUsername}</Text>
        </>
      ) : (
        <>
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
        </>
      )}

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
  rowTitle: { fontWeight: "700", color: colors.text },
  subtle: { color: colors.subtle },
});