// components/FriendRequestsSection.tsx
import React from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui/colors";
import { FriendRequest } from "./types";
import { useTheme } from "../providers/ThemeProvider";

type Props = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  busy: boolean;
  onAccept: (r: FriendRequest) => void;
  onReject: (r: FriendRequest) => void;
  onCancel: (r: FriendRequest) => void;
};

export default function FriendRequestsSection({
  incoming,
  outgoing,
  busy,
  onAccept,
  onReject,
  onCancel,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Requests</Text>
      {incoming.length === 0 && outgoing.length === 0 ? (
        <Text style={[styles.subtle, { color: colors.subtle }]}>No active requests.</Text>
      ) : (
        <>
          {incoming.length > 0 && (
            <>
              <Text style={[styles.subtle, { marginBottom: 8, color: colors.subtle }]}>Incoming</Text>
              <FlatList
                data={incoming}
                keyExtractor={(i) => `in_${i.id}`}
                renderItem={({ item }) => (
                  <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>
                        {(item.senderUsername?.[0] || "?").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.senderUsername || item.senderUid}</Text>
                      <Text style={[styles.subtle, { color: colors.subtle }]}>wants to be friends</Text>
                    </View>
                    <Pressable
                      onPress={() => onAccept(item)}
                      disabled={busy}
                      style={[styles.smallBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}
                    >
                      <Text style={styles.smallBtnText}>Accept</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onReject(item)}
                      disabled={busy}
                      style={[styles.smallBtn, { backgroundColor: colors.error, opacity: busy ? 0.5 : 1 }]}
                    >
                      <Text style={styles.smallBtnText}>Reject</Text>
                    </Pressable>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                scrollEnabled={false}
              />
            </>
          )}
          {outgoing.length > 0 && (
            <>
              <Text style={[styles.subtle, { marginTop: 12, marginBottom: 8, color: colors.subtle }]}>Outgoing</Text>
              <FlatList
                data={outgoing}
                keyExtractor={(i) => `out_${i.id}`}
                renderItem={({ item }) => (
                  <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>
                        {(item.receiverUsername?.[0] || "?").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{item.receiverUsername || item.receiverUid}</Text>
                      <Text style={[styles.subtle, { color: colors.subtle }]}>pending…</Text>
                    </View>
                    <Pressable
                      onPress={() => onCancel(item)}
                      disabled={busy}
                      style={[styles.smallBtn, { backgroundColor: colors.subtle, opacity: busy ? 0.5 : 1 }]}
                    >
                      <Text style={styles.smallBtnText}>Cancel</Text>
                    </Pressable>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                scrollEnabled={false}
              />
            </>
          )}
        </>
      )}
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
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8, color: colors.text },
  subtle: { color: colors.subtle },
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
  smallBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  smallBtnText: { color: "#fff", fontWeight: "800" },
});