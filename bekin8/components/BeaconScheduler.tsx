// components/BeaconScheduler.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { colors } from "@/components/ui/colors";
import KeyboardAware from "./KeyboardAware";

type FriendGroup = {
  id: string;
  name: string;
  memberUids: string[];
  source: "top" | "sub";
};

type Props = {
  beaconId?: string;
  onSaved?: () => void;
  initialDays?: string[];
  initialGroupIds?: string[];
};

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function BeaconScheduler({ beaconId, onSaved, initialDays, initialGroupIds }: Props) {
  const router = useRouter();
  const [selectedDays, setSelectedDays] = useState<string[]>(initialDays || []);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(initialGroupIds || []);
  const [saving, setSaving] = useState(false);

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const me = auth.currentUser;

  // --- Load friend groups from BOTH places; **skip unnamed**  ---
  useEffect(() => {
    if (!me) return;

    // A) Top-level FriendGroups
    const qTop = query(collection(db, "FriendGroups"), where("ownerUid", "==", me.uid));
    const unsubA = onSnapshot(
      qTop,
      (snap) => {
        const arr: (FriendGroup | null)[] = snap.docs.map((d) => {
          const data: any = d.data();
          const ownerUid = data?.ownerUid || data?.ownerId;
          if (ownerUid !== me.uid) return null;

          const rawMembers: any = data?.memberUids || data?.members || data?.memberIds || [];
          const memberUids: string[] = Array.isArray(rawMembers)
            ? rawMembers
                .map((m) => (typeof m === "string" ? m : typeof m?.uid === "string" ? m.uid : null))
                .filter(Boolean) as string[]
            : [];

          const name = (data?.name || data?.title || "").toString().trim();
          if (!name) return null; // skip unnamed

          return { id: d.id, name, memberUids, source: "top" as const };
        });

        const cleanedTop = (arr.filter(Boolean) as FriendGroup[]).sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        setFriendGroups((prev) => {
          const subOnly = prev.filter((g) => g.source === "sub");
          const map = new Map<string, FriendGroup>();
          [...subOnly, ...cleanedTop].forEach((g) => map.set(`${g.source}:${g.id}`, g));
          return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      },
      () => {}
    );

    // B) users/{uid}/friendGroups
    const qSubCol = collection(db, "users", me.uid, "friendGroups");
    const unsubB = onSnapshot(
      qSubCol,
      (snap) => {
        const arr: (FriendGroup | null)[] = snap.docs.map((d) => {
          const data: any = d.data();
          const rawMembers: any = data?.memberUids || data?.members || data?.memberIds || [];
          const memberUids: string[] = Array.isArray(rawMembers)
            ? rawMembers
                .map((m) => (typeof m === "string" ? m : typeof m?.uid === "string" ? m.uid : null))
                .filter(Boolean) as string[]
            : [];

          const name = (data?.name || data?.title || "").toString().trim();
          if (!name) return null; // skip unnamed

          return { id: d.id, name, memberUids, source: "sub" as const };
        });

        const cleanedSub = (arr.filter(Boolean) as FriendGroup[]).sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        setFriendGroups((prev) => {
          const topOnly = prev.filter((g) => g.source === "top");
          const map = new Map<string, FriendGroup>();
          [...topOnly, ...cleanedSub].forEach((g) => map.set(`${g.source}:${g.id}`, g));
          return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      },
      () => {}
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [me?.uid]);

  // Initialize selections if props arrive late (rare)
  useEffect(() => {
    if (initialDays && !selectedDays.length) setSelectedDays(initialDays);
  }, [initialDays]);

  useEffect(() => {
    if (initialGroupIds && !selectedGroupIds.length) setSelectedGroupIds(initialGroupIds);
  }, [initialGroupIds]);

  const toggleDay = (day: string) => {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const groupsSelected = useMemo(
    () => friendGroups.filter((g) => selectedGroupIds.includes(g.id)),
    [friendGroups, selectedGroupIds]
  );

  const saveBeacon = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      setSaving(true);

      // Flatten allowed UIDs (selected groups only)
      let allowedUids: string[] = [];
      groupsSelected.forEach((g) => {
        allowedUids.push(...(g.memberUids || []));
      });

      // Ensure uniqueness + include owner
      allowedUids = Array.from(new Set([...allowedUids, user.uid]));

      const data = {
        ownerUid: user.uid,
        days: selectedDays,
        groupIds: selectedGroupIds,
        allowedUids,
        updatedAt: serverTimestamp(),
        ...(beaconId ? {} : { createdAt: serverTimestamp(), isActive: true }),
      };

      const ref = beaconId ? doc(db, "Beacons", beaconId) : doc(collection(db, "Beacons"));
      await setDoc(ref, data, { merge: true });

      onSaved?.();
    } catch (e) {
      console.error("Failed to save beacon:", e);
    } finally {
      setSaving(false);
    }
  };

  const showEmptyHint = !friendGroups.length;

  return (
    <KeyboardAware
      // For a sheet-like panel, move the entire content above the keyboard.
      behaviorIOS="position"
      headerHeight={0}
      style={styles.flex}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={[
            styles.container,
            keyboardVisible && { paddingBottom: 24 }, // keep last controls visible
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Day selector */}
          <Text style={styles.label}>Day</Text>
          <View style={styles.rowWrap}>
            {daysOfWeek.map((day) => {
              const selected = selectedDays.includes(day);
              return (
                <Pressable key={day} onPress={() => toggleDay(day)} style={[styles.chip, selected && styles.chipActive]}>
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Friend groups selector */}
          <Text style={[styles.label, { marginTop: 16 }]}>Friend Groups</Text>

          {showEmptyHint ? (
            <View style={styles.emptyHintBox}>
              <Text style={styles.emptyHintText}>You don’t have any friend groups yet.</Text>
              <Text style={[styles.emptyHintText, { marginTop: 2 }]}>Create groups from the Friends screen.</Text>
              <Pressable onPress={() => router.push("/friends")} style={styles.hintBtn}>
                <Text style={styles.hintBtnText}>Open Friends</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.rowWrap}>
              {friendGroups.map((g) => {
                const selected = selectedGroupIds.includes(g.id);
                return (
                  <Pressable
                    key={`${g.source}:${g.id}`}
                    onPress={() => toggleGroup(g.id)}
                    style={[styles.chip, selected && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{g.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable onPress={saveBeacon} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Beacon</Text>}
          </Pressable>
        </ScrollView>
      </TouchableWithoutFeedback>

      {keyboardVisible && (
        <Pressable accessibilityLabel="Dismiss keyboard" onPress={Keyboard.dismiss} style={styles.keyboardDismissFab}>
          <Text style={styles.keyboardDismissFabText}>Done</Text>
        </Pressable>
      )}
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  label: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: colors.text },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "700" },

  emptyHintBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    marginBottom: 4,
  },
  emptyHintText: { color: colors.subtle },

  hintBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  hintBtnText: { color: "#fff", fontWeight: "700" },

  saveBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700" },

  flex: { flex: 1 },

  keyboardDismissFab: {
    position: "absolute",
    right: 16,
    bottom: Platform.select({ ios: 24, android: 16 }),
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  keyboardDismissFabText: { color: "#fff", fontWeight: "700" },
});