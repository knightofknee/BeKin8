// components/ProfileListEditor.tsx
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { db } from "@/firebase.config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { colors } from "@/components/ui/colors";
import { useTheme } from "../providers/ThemeProvider";

export type ListItem = { text: string; link?: string };

export type ProfileList = {
  id?: string;
  title: string;
  items: ListItem[];
  order: number;
  createdAt?: any;
  updatedAt?: any;
};

type Props = {
  visible: boolean;
  list: ProfileList | null; // null = create new
  ownerUid: string;
  isFirstList?: boolean; // true → pre-fill "Top Recommendations" placeholder
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
};

export default function ProfileListEditor({
  visible,
  list,
  ownerUid,
  isFirstList,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const { colors } = useTheme();
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<ListItem[]>([{ text: "", link: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (list) {
      setTitle(list.title);
      setItems(list.items.length ? list.items.map((i) => ({ ...i })) : [{ text: "", link: "" }]);
    } else {
      setTitle("");
      setItems([{ text: "", link: "" }]);
    }
  }, [visible, list?.id]);

  const updateItem = (idx: number, field: "text" | "link", value: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { text: "", link: "" }]);
  };

  const canSave = title.trim().length > 0 && items.some((i) => i.text.trim().length > 0) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const cleanItems = items
        .filter((i) => i.text.trim())
        .map((i) => ({ text: i.text.trim(), ...(i.link?.trim() ? { link: i.link.trim() } : {}) }));

      const payload = {
        title: title.trim(),
        items: cleanItems,
        updatedAt: serverTimestamp(),
      };

      if (list?.id) {
        await updateDoc(doc(db, "Profiles", ownerUid, "lists", list.id), payload);
      } else {
        await addDoc(collection(db, "Profiles", ownerUid, "lists"), {
          ...payload,
          order: Date.now(),
          createdAt: serverTimestamp(),
        });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("Save list error", e);
      Alert.alert("Error", "Failed to save list.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!list?.id) return;
    Alert.alert("Delete list", `Delete "${list.title}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: handleDelete },
    ]);
  };

  const handleDelete = async () => {
    if (!list?.id) return;
    try {
      await deleteDoc(doc(db, "Profiles", ownerUid, "lists", list.id));
      onDeleted?.();
      onClose();
    } catch (e) {
      console.error("Delete list error", e);
      Alert.alert("Error", "Failed to delete list.");
    }
  };

  const placeholderTitle = !list && isFirstList ? "Top Recommendations" : "List title";
  const placeholderText = !list && isFirstList ? "e.g., Favorite podcast, Best pizza in town" : "Item text";
  const placeholderLink = "Link (optional)";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>{list ? "Edit List" : "New List"}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.close, { color: colors.subtle }]}>✕</Text>
            </Pressable>
          </View>

          {/* Title */}
          <Text style={[styles.label, { color: colors.text }]}>Title</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text }]}
            placeholder={placeholderTitle}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />

          {/* Items */}
          <View style={styles.itemsHeaderRow}>
            <Text style={[styles.label, { color: colors.text }]}>Items</Text>
            {list?.id ? (
              <Pressable onPress={confirmDelete} hitSlop={10} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Delete List</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.itemsScroll} keyboardShouldPersistTaps="handled">
            {items.map((item, idx) => (
              <View key={idx} style={[styles.itemRow, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <TextInput
                    style={[styles.input, { borderColor: colors.border, backgroundColor: colors.card, color: colors.text }]}
                    placeholder={placeholderText}
                    placeholderTextColor={colors.subtle}
                    value={item.text}
                    onChangeText={(v) => updateItem(idx, "text", v)}
                    maxLength={200}
                  />
                  <TextInput
                    style={[styles.input, styles.linkInput, { borderColor: colors.border, backgroundColor: colors.card, color: colors.subtle }]}
                    placeholder={placeholderLink}
                    placeholderTextColor={colors.subtle}
                    value={item.link ?? ""}
                    onChangeText={(v) => updateItem(idx, "link", v)}
                    autoCapitalize="none"
                    keyboardType="url"
                    maxLength={500}
                  />
                </View>
                {items.length > 1 && (
                  <Pressable onPress={() => removeItem(idx)} hitSlop={8} style={styles.removeBtn}>
                    <Text style={styles.removeTxt}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}

            <Pressable onPress={addItem} style={styles.addItemBtn}>
              <Text style={[styles.addItemTxt, { color: colors.primary }]}>+ Add Item</Text>
            </Pressable>
          </ScrollView>

          {/* Actions */}
          <View style={styles.btnRow}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
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
                <Text style={styles.btnPrimaryText}>{list ? "Save" : "Create"}</Text>
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
    maxHeight: "85%",
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
    fontSize: 15,
    color: colors.text,
  },
  linkInput: {
    fontSize: 13,
    color: colors.subtle,
  },

  itemsHeaderRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  itemsScroll: {
    marginTop: 6,
    maxHeight: 300,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: "#FAFAFA",
  },

  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  removeTxt: { color: "#B91C1C", fontWeight: "800", fontSize: 12 },

  addItemBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  addItemTxt: { color: colors.primary, fontWeight: "700", fontSize: 14 },

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
