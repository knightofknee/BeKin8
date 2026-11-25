// components/BeaconShareSheet.tsx
// "Share" for a lit beacon: get it in front of people who are NOT on BeKin yet.
//
//   Text people   a group text from the owner's own number to "text friends" picked from their
//                 contacts (kept on this device only). The composer opens filled in; they press send.
//   Share link    the system share sheet.
//
// Both send the same thing: one line DESCRIBING the beacon (third person, like the push) and its
// link. The sheet shows that text up front, so nobody is surprised by what goes out, and it never
// reads as if the sender wrote it. The link opens the beacon on the web (see the beacon, say
// "I'm in", chat, no account) and connects them as a friend if they install.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../providers/ThemeProvider";
import { useAuth } from "../providers/AuthProvider";
import {
  beaconWhen,
  composeBeaconText,
  describeBeacon,
  getBeaconShareUrl,
  loadTextFriends,
  pickTextFriend,
  saveTextFriends,
  shareBeaconLink,
  textBeacon,
  type ShareableBeacon,
  type TextFriend,
} from "../lib/beaconShare";
import { track } from "../lib/analytics";
import { press, success, tap } from "../utils/haptics";

type Props = {
  visible: boolean;
  onClose: () => void;
  beacon: ShareableBeacon | null;
  /** Lit with nobody on BeKin to see it: say so, since sharing is the only way anyone finds out. */
  noFriendsYet?: boolean;
};

const canText = Platform.OS !== "web";

export default function BeaconShareSheet({ visible, onClose, beacon, noFriendsYet = false }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const uid = user?.uid ?? null;

  const [url, setUrl] = useState<string | null>(null);
  const [urlFailed, setUrlFailed] = useState(false);
  const [friends, setFriends] = useState<TextFriend[]>([]);
  const [busy, setBusy] = useState<"text" | "link" | "pick" | null>(null);
  // The sender's own optional words: the third part of the text, under their name.
  const [note, setNote] = useState("");

  const description = useMemo(() => (beacon ? describeBeacon(beacon) : ""), [beacon]);

  const loadUrl = useCallback(() => {
    if (!uid || !beacon) return;
    setUrlFailed(false);
    setUrl(null);
    getBeaconShareUrl(uid, beacon.id).then((u) => {
      setUrl(u);
      setUrlFailed(!u);
    });
  }, [uid, beacon?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible || !uid || !beacon) return;
    track("beacon_share_open", { no_friends: noFriendsYet });
    loadUrl();
    setNote("");
    loadTextFriends(uid).then(setFriends);
  }, [visible, uid, beacon?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: TextFriend[]) => {
    setFriends(next);
    if (uid) void saveTextFriends(uid, next);
  };

  const addFromContacts = async () => {
    if (busy) return;
    tap();
    setBusy("pick");
    const res = await pickTextFriend();
    setBusy(null);
    if (res.ok) {
      track("text_friend_added");
      update([...friends.filter((f) => f.id !== res.friend.id), res.friend]);
    } else if (res.reason === "no-phone") {
      Alert.alert("No phone number", "That contact has no phone number to text.");
    } else if (res.reason === "denied") {
      Alert.alert("Contacts are off", "Allow contacts for BeKin in Settings to pick people to text.");
    } else if (res.reason === "unavailable") {
      Alert.alert("Can't open contacts", "Use Share link instead, and pick people in your messaging app.");
    }
  };

  const selected = friends.filter((f) => f.on);

  const sendText = async () => {
    if (busy || !url || !selected.length || !beacon) return;
    press();
    setBusy("text");
    const res = await textBeacon(selected.map((f) => f.phone), composeBeaconText(beacon!, url, note));
    setBusy(null);
    if (res === "sent") {
      track("beacon_share_text", { count: selected.length });
      success();
      onClose();
    } else if (res === "unavailable") {
      Alert.alert("This device can't send texts", "Use Share link instead and pick how to send it.");
    }
  };

  const shareLink = async () => {
    if (busy || !url) return;
    press();
    setBusy("link");
    const shared = await shareBeaconLink(description, url);
    setBusy(null);
    if (shared) {
      track("beacon_share_link");
      onClose();
    }
  };

  const ready = !!url;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheet, { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={[st.grabber, { backgroundColor: colors.border }]} />
        <View style={st.headerRow}>
          <Text style={[st.title, { color: colors.text }]}>Share your beacon</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.subtle} />
          </Pressable>
        </View>
        <Text style={[st.sub, { color: colors.subtle }]}>
          {noFriendsYet
            ? "Nobody on BeKin can see it yet. Send it to the people you want there: they can open it and say they're in without the app."
            : "For people who aren't on BeKin yet. They can open it and say they're in without the app."}
        </Text>

        {/* Exactly what goes out, in its three parts: the beacon, BeKin's line, the sender's own. */}
        <View style={[st.preview, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
          <Text style={[st.previewLabel, { color: colors.subtle }]}>WHAT THEY GET</Text>
          <Text style={[st.previewText, { color: colors.text }]}>
            {beacon ? `${beacon.ownerName.trim() || "A friend"} lit a beacon on BeKin: ${beaconWhen(beacon)}.` : ""}
          </Text>
          {beacon && (beacon.message || "").trim() ? (
            <Text style={[st.previewText, { color: colors.text }]}>
              <Text style={st.previewTag}>Description: </Text>
              {(beacon.message || "").trim()}
            </Text>
          ) : null}
          <Text style={[st.previewText, { color: colors.text, marginTop: 10 }]}>
            Download the app to avoid group chat
          </Text>
          {urlFailed ? (
            <Pressable onPress={loadUrl} hitSlop={8}>
              <Text style={[st.previewLink, { color: colors.error }]}>Couldn&apos;t make the link. Tap to retry.</Text>
            </Pressable>
          ) : (
            <Text style={[st.previewLink, { color: colors.primary }]} numberOfLines={1}>
              {url ?? "Making the link…"}
            </Text>
          )}
          {canText ? (
            <View style={[st.noteRow, { borderTopColor: colors.border }]}>
              <Text style={[st.previewText, st.previewTag, { color: colors.text }]}>
                {(beacon?.ownerName.trim() || "You")}:
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add your own words (optional)"
                placeholderTextColor={colors.subtle}
                style={[st.noteInput, { color: colors.text }]}
                multiline
                maxLength={300}
                accessibilityLabel="Your own words, added to the text"
              />
            </View>
          ) : null}
        </View>

        {canText ? (
          <>
            <Text style={[st.section, { color: colors.text }]}>Text people</Text>
            <ScrollView style={st.chipsScroll} contentContainerStyle={st.chips} keyboardShouldPersistTaps="handled">
              {friends.map((f) => (
                <View key={f.id} style={st.chipWrap}>
                  <Pressable
                    onPress={() => { tap(); update(friends.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x))); }}
                    style={[
                      st.chip,
                      { borderColor: f.on ? colors.primary : colors.border, backgroundColor: f.on ? colors.primary + "22" : "transparent" },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: f.on }}
                    accessibilityLabel={f.name}
                  >
                    <Ionicons name={f.on ? "checkmark-circle" : "ellipse-outline"} size={17} color={f.on ? colors.primary : colors.subtle} />
                    <Text style={[st.chipTxt, { color: colors.text }]} numberOfLines={1}>{f.name}</Text>
                  </Pressable>
                  {/* the x on the corner takes them off the list */}
                  <Pressable
                    onPress={() => { tap(); update(friends.filter((x) => x.id !== f.id)); }}
                    hitSlop={6}
                    style={[st.chipX, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${f.name} from your text list`}
                  >
                    <Ionicons name="close" size={12} color={colors.subtle} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={addFromContacts}
                style={[st.chip, { borderColor: colors.border, borderStyle: "dashed" }]}
                accessibilityRole="button"
                accessibilityLabel="Add someone from your contacts"
              >
                {busy === "pick" ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="add" size={18} color={colors.primary} />
                )}
                <Text style={[st.chipTxt, { color: colors.primary }]}>From contacts</Text>
              </Pressable>
            </ScrollView>
            <Text style={[st.fine, { color: colors.subtle }]}>
              People you add stay here for next time, on this phone only. The text opens in Messages for you to send.
            </Text>
            <Pressable
              onPress={sendText}
              disabled={!ready || !selected.length || !!busy}
              style={({ pressed }) => [
                st.primary,
                { backgroundColor: colors.primary },
                (!ready || !selected.length) && { opacity: 0.45 },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
            >
              {busy === "text" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                  <Text style={st.primaryTxt}>
                    {selected.length ? `Text ${selected.length === 1 ? selected[0].name : `${selected.length} people`}` : "Pick someone to text"}
                  </Text>
                </>
              )}
            </Pressable>
          </>
        ) : null}

        <Pressable
          onPress={shareLink}
          disabled={!ready || !!busy}
          style={({ pressed }) => [
            canText ? st.secondary : st.primary,
            canText ? { borderColor: colors.border } : { backgroundColor: colors.primary },
            !ready && { opacity: 0.45 },
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
        >
          {busy === "link" ? (
            <ActivityIndicator color={canText ? colors.primary : "#fff"} />
          ) : (
            <>
              <Ionicons name="share-outline" size={18} color={canText ? colors.primary : "#fff"} />
              <Text style={canText ? [st.secondaryTxt, { color: colors.primary }] : st.primaryTxt}>Share link</Text>
            </>
          )}
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  preview: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14 },
  previewLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },
  previewText: { fontSize: 15, lineHeight: 21 },
  previewLink: { fontSize: 13, marginTop: 2 },
  previewTag: { fontWeight: "800" },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  noteInput: { flex: 1, fontSize: 15, lineHeight: 21, padding: 0, minHeight: 21 },
  section: { fontSize: 15, fontWeight: "800", marginTop: 16, marginBottom: 8 },
  chipsScroll: { maxHeight: 148 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 7, paddingRight: 7 },
  chipWrap: { position: "relative" },
  chipX: { position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 38,
    maxWidth: 220,
  },
  chipTxt: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  fine: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    minHeight: 50,
    marginTop: 12,
  },
  primaryTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    marginTop: 10,
  },
  secondaryTxt: { fontSize: 16, fontWeight: "700" },
});
