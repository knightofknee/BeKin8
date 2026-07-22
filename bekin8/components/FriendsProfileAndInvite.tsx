// components/FriendsProfileAndInvite.tsx
import React, { useState } from "react";
import { ActivityIndicator, Dimensions, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { colors } from "./ui/colors";
import { MessageState } from "./types";
import { useTheme } from "../providers/ThemeProvider";
import { useTourTarget } from "../providers/TourProvider";
import { buildInviteUrl } from "../lib/inviteLink";
import { press, tap } from "../utils/haptics";

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
  // In-person friending: the friend link rendered as a QR. A small tile sits beside the Share
  // button; tapping it opens the full-size code (see the Modal at the bottom).
  const [qrOpen, setQrOpen] = useState(false);
  const inviteUrl = inviteCode ? buildInviteUrl(inviteCode) : null;
  // Tour targets: step "Pick your username" spotlights ONLY the username block; step "Your name &
  // invite link" spotlights the WHOLE profile block below (username + display name + invite) so the
  // display name its copy mentions is highlighted and tappable, not just the invite.
  const usernameTarget = useTourTarget("friends-username");
  const profileTarget = useTourTarget("friends-profile");
  // Anchor only: the username/profile tour steps sit their callout JUST BELOW this "send a friend
  // request" field (so it stays barely visible) rather than below their own spotlighted block.
  const addFieldTarget = useTourTarget("friends-add");
  // The whole card (username + invite link + add-by-username): the speed tour's "add a friend" step (2a).
  const addCardTarget = useTourTarget("friends-add-card");
  return (
    <View ref={addCardTarget} collapsable={false} style={[styles.card, { backgroundColor: colors.card }]}>
      {/* Profile + invite area: one spotlight target for the "Your name & invite link" step, so the
          username, display name, AND invite are all highlighted + tappable (per the step's copy). */}
      <View ref={profileTarget} collapsable={false}>
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
              placeholder="choose a username"
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
          {/* Render the save message HERE, inside the username block, when no username is set yet.
              The copy at the bottom of the card sits under the tour's "friends-add" callout, so a
              "username taken" error would be invisible during onboarding. This copy stays visible. */}
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
      )}

      {/* Invite a friend, share your smart link / code. Hidden until a username exists, since the
          invite code is only minted once a username is set. */}
      {onShareInvite &&
        (currentUsername ? (
          <View collapsable={false} style={[styles.cardInner, { marginTop: 14 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Invite friends</Text>
            <Text style={[styles.subtle, { color: colors.subtle, marginBottom: 8 }]}>
              Share your link. When a friend taps it, you’re instantly connected. No accept needed. Works for new signups too.
            </Text>
            {/* Share button + a small QR tile (the SAME link, drawn as a code for in-person adds:
                a friend points their camera at it and the universal link does the rest). QR stays
                on a white card in both themes: scanners want dark modules on light, always. */}
            <View style={styles.inputRow}>
              <Pressable
                disabled={!inviteCode}
                onPress={() => { press(); onShareInvite(); }}
                style={[styles.btn, { flex: 1, opacity: inviteCode ? 1 : 0.5, backgroundColor: colors.primary }]}
              >
                <Text style={styles.btnText}>Share friend link</Text>
              </Pressable>
              {inviteUrl ? (
                <Pressable
                  onPress={() => { tap(); setQrOpen(true); }}
                  style={({ pressed }) => [styles.qrTile, { borderColor: colors.border }, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Show my friend QR code"
                  hitSlop={6}
                >
                  <QRCode value={inviteUrl} size={38} backgroundColor="#FFFFFF" color="#111827" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <View collapsable={false} style={[styles.cardInner, { marginTop: 14 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Invite friends</Text>
            <Text style={[styles.subtle, { color: colors.subtle }]}>
              Pick a username above to unlock your shareable invite link.
            </Text>
          </View>
        ))}
      </View>

      {/* Add Friend */}
      <View style={[styles.cardInner, { marginTop: 14 }]}>
        <Text style={[styles.label, { color: colors.text }]}>Send a Friend Request (by username)</Text>
        {!hasProfileUsername && (
          <Text style={[styles.subtle, { marginBottom: 8, color: colors.subtle }]}>You need a username first.</Text>
        )}
        <View ref={addFieldTarget} collapsable={false} style={styles.inputRow}>
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

        {/* Once a username exists, the username block above is gone, so this is the only place the
            message renders. Before that, the copy inside the username block handles it (this one
            sits under the tour callout during onboarding), so skip it here to avoid a duplicate. */}
        {message.type && currentUsername && (
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

      {/* Full-size friend QR. White card in both themes (scan contrast), quiet zone via the
          card's padding, high error correction so the center logo never breaks scanning. */}
      {inviteUrl ? (
        <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
          <Pressable
            style={[styles.qrBackdrop, { backgroundColor: colors.backdrop }]}
            onPress={() => setQrOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close QR code"
          >
            <View style={styles.qrCard}>
              <QRCode
                value={inviteUrl}
                size={QR_SIZE}
                ecl="H"
                backgroundColor="#FFFFFF"
                color="#111827"
                logo={require("../assets/icon.png")}
                logoSize={Math.round(QR_SIZE * 0.18)}
                logoBackgroundColor="#FFFFFF"
                logoMargin={4}
                logoBorderRadius={8}
              />
              {currentUsername ? <Text style={styles.qrName}>@{currentUsername}</Text> : null}
              <Text style={styles.qrHint}>
                Have a friend point their camera here. One tap and you&apos;re connected.
              </Text>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

// Sized for an arm's-length scan: most of the screen width, capped for tablets.
const QR_SIZE = Math.min(Math.round(Dimensions.get("window").width * 0.66), 300);

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
  // Small QR tile beside the Share button. Always white: QR contrast is non-negotiable.
  qrTile: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderRadius: 10,
    padding: 5,
  },
  qrBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  // The big code's card doubles as its quiet zone (the light margin scanners need).
  qrCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    maxWidth: 380,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  qrName: { marginTop: 14, fontSize: 18, fontWeight: "800", color: "#111827" },
  qrHint: { marginTop: 6, fontSize: 13, color: "#6B7280", textAlign: "center", lineHeight: 18 },
  usernameRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  displayNameLink: { fontWeight: "700", textDecorationLine: "underline" },
  rowTitle: { fontWeight: "700", color: colors.text },
  subtle: { color: colors.subtle },
});