// components/FriendGroupEditor.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { auth, db } from "../firebase.config";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { colors } from "@/components/ui/colors";
import type { Friend } from "@/components/types";

export type FriendGroup = {
  id?: string;
  ownerUid: string;
  name: string;
  memberUids: string[]; // only UIDs stored; names are derived for display
  createdAt?: any;
  updatedAt?: any;
};

type Props = {
  visible: boolean;
  group?: FriendGroup | null; // if provided, editing; else creating
  onClose: () => void;
  onSaved?: (g: FriendGroup) => void;
  onDeleted?: (groupId: string) => void;
};

export default function FriendGroupEditor({
  visible,
  group,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const user = auth.currentUser;
  const [name, setName] = useState(group?.name ?? "");
  const [selected, setSelected] = useState<string[]>(group?.memberUids ?? []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Pull your friends for selection
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "users", user.uid, "friends"), (snap) => {
      const arr = snap.docs
        .map((d) => d.data() as any)
        .filter((f) => typeof f?.uid === "string" && typeof f?.username === "string")
        .map((f) => ({ uid: f.uid, username: f.username } as Friend))
        .sort((a, b) => a.username.localeCompare(b.username));
      setFriends(arr);
    });
    return () => unsub();
  }, [user?.uid]);

  // Reset local state when opening for a different group
  useEffect(() => {
    setName(group?.name ?? "");
    setSelected(group?.memberUids ?? []);
  }, [group?.id, visible]);

  const isEditing = !!group?.id;

  const toggleSelect = (uid: string) => {
    setSelected((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name required", "Please give your group a name.");
      return;
    }
    if (selected.length === 0) {
      Alert.alert("No members", "Add at least one friend to the group.");
      return;
    }

    try {
      setSaving(true);

      if (isEditing && group?.id) {
        await updateDoc(doc(db, "FriendGroups", group.id), {
          name: trimmed,
          memberUids: selected,
          updatedAt: serverTimestamp(),
          // ownerUid immutable by rules
        });
        onSaved?.({
          id: group.id,
          ownerUid: user.uid,
          name: trimmed,
          memberUids: selected,
        });
      } else {
        // Create with a deterministic-ish id: owner + timestamp
        const id = `${user.uid}_${Date.now()}`;
        await setDoc(doc(db, "FriendGroups", id), {
          ownerUid: user.uid,
          name: trimmed,
          memberUids: selected,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onSaved?.({
          id,
          ownerUid: user.uid,
          name: trimmed,
          memberUids: selected,
        });
      }

      onClose();
    } catch (e: any) {
      console.error("FriendGroupEditor save error", e);
      Alert.alert("Error", e?.message || "Failed to save group.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!isEditing || !group?.id) return;
    Alert.alert(
      "Delete group",
      `Are you sure you want to delete “${group.name}”? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: handleDelete,
        },
      ],
    );
  };

  const handleDelete = async () => {
    if (!isEditing || !group?.id) return;
    try {
      setDeleting(true);
      await deleteDoc(doc(db, "FriendGroups", group.id));
      onDeleted?.(group.id);
      onClose();
    } catch (e: any) {
      console.error("FriendGroupEditor delete error", e);
      Alert.alert("Error", e?.message || "Failed to delete group.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>{isEditing ? "Edit Friend Group" : "New Friend Group"}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {/* Name */}
          <Text style={styles.label}>Group name</Text>
          <TextInput
            style={styles.input}
            placeholder="Weekend Crew"
            value={name}
            onChangeText={setName}
          />

          {/* Members */}
          <Text style={[styles.label, { marginTop: 12 }]}>Members</Text>
          {friends.length === 0 ? (
            <Text style={{ color: colors.subtle, marginBottom: 8 }}>
              You don’t have any friends yet. Add friends first, then create a group.
            </Text>
          ) : null}
          <FlatList
            data={friends}
            keyExtractor={(f) => f.uid || f.username}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            style={{ maxHeight: 260, marginBottom: 8 }}
            renderItem={({ item }) => {
              const checked = !!item.uid && selected.includes(item.uid);
              return (
                <Pressable
                  onPress={() => item.uid && toggleSelect(item.uid)}
                  style={[
                    styles.friendRow,
                    checked && { borderColor: colors.primary, backgroundColor: "#F3F6FF" },
                  ]}
                >
                  <View style={styles.avatar}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>
                      {item.username?.[0]?.toUpperCase() || "?"}
                    </Text>
                  </View>
                  <Text style={styles.friendName}>{item.username}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.check, checked && { color: colors.primary }]}>
                    {checked ? "Added" : "Add"}
                  </Text>
                </Pressable>
              );
            }}
          />

          {/* Buttons */}
          <View style={styles.btnRow}>
            {isEditing ? (
              <Pressable
                onPress={confirmDelete}
                disabled={deleting || saving}
                style={[styles.btn, styles.btnDanger, (deleting || saving) && { opacity: 0.6 }]}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnDangerText}>Delete</Text>
                )}
              </Pressable>
            ) : (
              <View style={{ width: 1 }} />
            )}

            <View style={{ flex: 1 }} />

            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={saving || deleting}
              style={[styles.btn, styles.btnPrimary, (saving || deleting) && { opacity: 0.7 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{isEditing ? "Save" : "Create"}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  close: { fontSize: 22, paddingHorizontal: 8 },

  label: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },

  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.card,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  friendName: { fontWeight: "700", color: colors.text },
  check: { fontWeight: "700", color: colors.subtle },

  btnRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  btnGhost: { backgroundColor: "#fff" },
  btnGhostText: { color: colors.text, fontWeight: "700" },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnDanger: { backgroundColor: "#B00020", borderColor: "#B00020" },
  btnDangerText: { color: "#fff", fontWeight: "800" },
});