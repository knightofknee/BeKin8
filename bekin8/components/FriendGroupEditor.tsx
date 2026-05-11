// components/FriendGroupEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { auth, db } from "@/firebase.config";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { colors } from "@/components/ui/colors";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { tap, press, warning, selection } from "../utils/haptics";

export type FriendGroup = {
  id?: string;
  ownerUid: string;
  name: string;
  memberUids: string[];
  createdAt?: any;
  updatedAt?: any;
};

type Props = {
  visible: boolean;
  group: FriendGroup | null; // null = create new
  onClose: () => void;
  onSaved?: (g: FriendGroup) => void;
  onDeleted?: (groupId: string) => void;
};

type Friend = { uid: string; username: string; displayName?: string; avatarColor?: string };

const edgeId = (a: string, b: string) => [a, b].sort().join("_");

// --- utils ---
const cleanAndDedupeFriends = (arr: any[]): Friend[] => {
  const out: Friend[] = [];
  const seen = new Set<string>();
  for (const f of arr || []) {
    const uid = typeof f?.uid === "string" ? f.uid : undefined;
    const username = (f?.username ?? "").toString().trim();
    if (!uid || !username) continue;
    const key = `uid:${uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const displayName = (f?.displayName ?? "").toString().trim() || undefined;
    out.push({ uid, username, displayName });
  }
  out.sort((a, b) => a.username.localeCompare(b.username));
  return out;
};

async function resolveUsernames(uids: string[]) {
  const out: Record<string, { username: string; displayName?: string; avatarColor?: string }> = {};
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const p = await getDoc(doc(db, "Profiles", uid));
        if (p.exists()) {
          const data: any = p.data();
          const uname = (data?.username || "").toString().trim();
          const dn = (data?.displayName || "").toString().trim();
          // Prefer the modern `profileColor` field, fall back to legacy `avatarColor`.
          const ac = (data?.profileColor || data?.avatarColor || "").toString().trim();
          if (uname) out[uid] = { username: uname, displayName: dn || undefined, avatarColor: ac || undefined };
        }
      } catch {
        // ignore
      }
    })
  );
  return out;
}

export default function FriendGroupEditor({
  visible,
  group,
  onClose,
  onSaved,
  onDeleted,
}: Props) {

  const { colors } = useTheme();

  // Editor state
  const [name, setName] = useState(group?.name || "");
  const [selected, setSelected] = useState<Set<string>>(new Set(group?.memberUids || []));
  const [saving, setSaving] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [friends, setFriends] = useState<Friend[]>([]);

  // live caches: uid -> { username, displayName, avatarColor }
  const cacheRef = useRef<Record<string, { username: string; displayName?: string; avatarColor?: string }>>({});

  // keep local state in sync when opening with a different group
  useEffect(() => {
    if (!visible) return;
    setName(group?.name || "");
    setSelected(new Set(group?.memberUids || []));
  }, [visible, group?.id]);

  // subscribe auth (only while visible)
  const { user, initialized } = useAuth();
const meUid = visible && initialized ? user?.uid ?? null : null;

  // --- Load & subscribe to ALL friends (subcollection, legacy, and edges) ---
  useEffect(() => {
    if (!visible || !meUid) return;

    setLoadingFriends(true);
    const cleanups: Array<() => void> = [];

    // A) Preferred subcollection
    const unsubSub = onSnapshot(
      collection(db, "users", meUid, "friends"),
      (snap) => {
        const arr = snap.docs.map((d) => d.data() as any);
        const cleaned = cleanAndDedupeFriends(arr);
        cleaned.forEach((f) => {
          cacheRef.current[f.uid] = { username: f.username, displayName: f.displayName };
        });
        mergeAndSet();
      }
    );
    cleanups.push(unsubSub);

    // B) Legacy Friends/{me}
    const unsubLegacy = onSnapshot(doc(db, "Friends", meUid), (snap) => {
      const arr: any[] = (snap.exists() && (snap.data() as any)?.friends) || [];
      const cleaned = cleanAndDedupeFriends(arr);
      cleaned.forEach((f) => {
        if (!cacheRef.current[f.uid]) {
          cacheRef.current[f.uid] = { username: f.username, displayName: f.displayName };
        }
      });
      mergeAndSet();
    });
    cleanups.push(unsubLegacy);

    // C) Canonical edges -> ensure any friend not denormalized still appears
    const unsubEdges = onSnapshot(
      query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", meUid),
        where("state", "==", "accepted")
      ),
      async (snap) => {
        const others = new Set<string>();
        snap.forEach((d) => {
          const ed = d.data() as any;
          const arr: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
          const other = arr.find((u) => u !== meUid);
          if (other) others.add(other);
        });

        const missingNames = Array.from(others).filter((uid) => !cacheRef.current[uid]);
        if (missingNames.length) {
          const map = await resolveUsernames(missingNames);
          for (const [uid, info] of Object.entries(map)) {
            cacheRef.current[uid] = info;
          }
        }
        mergeAndSet();
      }
    );
    cleanups.push(unsubEdges);

    function mergeAndSet() {
      const all = Object.entries(cacheRef.current).map(([uid, info]) => ({
        uid,
        username: info.username,
        displayName: info.displayName,
        avatarColor: info.avatarColor,
      }));
      all.sort((a, b) => a.username.localeCompare(b.username));
      setFriends(all);
      setLoadingFriends(false);
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [visible, meUid]);

  // toggle selection
  const toggleUid = useCallback((uid: string) => {
    selection();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const canSave = useMemo(() => {
    const nm = name.trim();
    return !!meUid && !!nm && selected.size > 0 && !saving;
  }, [meUid, name, selected.size, saving]);

  // Save (create or update)
  const handleSave = async () => {
    press();
    if (!meUid) return;
    const nm = name.trim();
    if (!nm) return;

    try {
      setSaving(true);
      const base = {
        ownerUid: meUid,
        name: nm,
        memberUids: Array.from(selected),
        updatedAt: new Date(),
      };

      let id = group?.id;
      if (id) {
        await updateDoc(doc(db, "FriendGroups", id), base);
      } else {
        // deterministic by name+owner to avoid dup spam; otherwise use addDoc
        // Here we use a deterministic id for UX; if you want multiple same-name groups, switch to addDoc.
        id = `${meUid}_${nm.toLowerCase().replace(/\s+/g, "-")}`;
        await setDoc(
          doc(db, "FriendGroups", id),
          { ...base, createdAt: new Date() },
          { merge: true }
        );
      }

      onSaved?.({
        id,
        ownerUid: meUid,
        name: nm,
        memberUids: Array.from(selected),
      });
      onClose();
    } catch (e) {
      if (__DEV__) console.error("Save group error", e);
      Alert.alert("Error", "Failed to save group.");
    } finally {
      setSaving(false);
    }
  };

  // Delete with confirmation
  const confirmDelete = () => {
    if (!group?.id) return;
    Alert.alert(
      "Delete group",
      `Delete “${group.name}”? This can’t be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: handleDelete,
        },
      ]
    );
  };

  const handleDelete = async () => {
    warning();
    if (!group?.id) return;
    try {
      await deleteDoc(doc(db, "FriendGroups", group.id));
      onDeleted?.(group.id);
      onClose();
    } catch (e) {
      if (__DEV__) console.error("Delete group error", e);
      Alert.alert("Error", "Failed to delete group.");
    }
  };

  // render friend row (checkbox-like)
  const renderItem = ({ item }: { item: Friend }) => {
    const checked = selected.has(item.uid);
    return (
      <Pressable
        onPress={() => toggleUid(item.uid)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.inputBg, borderColor: colors.border },
          checked ? [styles.rowChecked, { backgroundColor: colors.bubbleMine, borderColor: colors.bubbleMineBorder }] : null,
          pressed && { opacity: 0.9 },
        ]}
      >
        <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: colors.inputBg }, checked && [styles.checkboxOn, { backgroundColor: colors.primary, borderColor: colors.primary }]]}>
          {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={1}>
            {item.displayName || item.username}
          </Text>
          {item.displayName ? (
            <Text style={[styles.rowSubText, { color: colors.subtle }]} numberOfLines={1}>
              {item.username}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>{group ? "Edit Group" : "New Group"}</Text>
            <Pressable onPress={() => { tap(); onClose(); }} hitSlop={10}>
              <Text style={[styles.close, { color: colors.subtle }]}>✕</Text>
            </Pressable>
          </View>

          {/* Group name */}
          <Text style={[styles.label, { color: colors.text }]}>Group name</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text }]}
            placeholder="e.g., Housemates, Basketball Crew"
            placeholderTextColor={colors.subtle}
            value={name}
            onChangeText={setName}
            maxLength={48}
          />

          {/* Members */}
          <View style={styles.membersHeaderRow}>
            <Text style={[styles.label, { color: colors.text }]}>Members</Text>
            {group?.id ? (
              <Pressable onPress={confirmDelete} hitSlop={10} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.listWrap}>
            {loadingFriends ? (
              <View style={{ paddingVertical: 18, alignItems: "center" }}>
                <ActivityIndicator />
                <Text style={{ marginTop: 8, color: colors.subtle }}>Loading friends…</Text>
              </View>
            ) : friends.length === 0 ? (
              <Text style={{ color: colors.subtle, paddingVertical: 8 }}>
                You don’t have any friends yet. Add some first.
              </Text>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={(i) => i.uid}
                renderItem={renderItem}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>

          {/* Actions */}
          <View style={styles.btnRow}>
            <Pressable onPress={() => { tap(); onClose(); }} style={[styles.btn, styles.btnGhost, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
              <Text style={[styles.btnGhostText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary, borderColor: colors.primary }, !canSave && { opacity: 0.6 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{group ? "Save" : "Create"}</Text>
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
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "center",
    padding: 22,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  close: { fontSize: 22, paddingHorizontal: 8 },

  label: { fontSize: 14, fontWeight: "700", marginTop: 12, marginBottom: 6, color: colors.text },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },

  membersHeaderRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  listWrap: {
    marginTop: 6,
    maxHeight: 320,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    borderRadius: 12,
  },
  rowChecked: {
    backgroundColor: "#E8F0FF",
    borderColor: "#C7DAFF",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxTick: { color: "#fff", fontWeight: "900", fontSize: 14 },
  rowText: { fontWeight: "700", color: colors.text },
  rowSubText: { fontSize: 12, color: colors.subtle, marginTop: 1 },

  btnRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnGhost: { backgroundColor: "#fff" },
  btnGhostText: { color: colors.text, fontWeight: "700" },

  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  deleteText: { color: "#B91C1C", fontWeight: "800", fontSize: 12 },
});