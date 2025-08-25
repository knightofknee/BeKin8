// app/friends.tsx
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from "react-native";
import { auth, db } from "../firebase.config";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type Friend = { uid?: string; username: string };

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  error: "#B00020",
  success: "#0E7A0D",
};

export default function FriendsScreen() {
  const [name, setName] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | null }>({
    text: "",
    type: null,
  });

  const showMessage = (text: string, type: "error" | "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: null }), 2500);
  };

  const cleanAndDedupeFriends = (arr: any[]): Friend[] => {
    const out: Friend[] = [];
    const seen = new Set<string>();
    for (const f of arr || []) {
      const uid = typeof f?.uid === "string" ? f.uid : undefined;
      const username = (f?.username ?? "").toString().trim();
      if (!username) continue;
      const key = uid ? `uid:${uid}` : `name:${username.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ uid, username });
    }
    // Stable order for rendering
    out.sort((a, b) => a.username.localeCompare(b.username));
    return out;
  };

  const fetchFriends = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const docRef = doc(db, "Friends", user.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const cleaned = cleanAndDedupeFriends(docSnap.data()?.friends || []);
      setFriends(cleaned);
    } else {
      setFriends([]);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) fetchFriends();
      else setFriends([]);
    });
    return () => unsub();
  }, []);

  const handleAddFriend = async () => {
    const input = name.trim();
    if (!input) return;

    const user = auth.currentUser;
    if (!user) {
      showMessage("Please log in first.", "error");
      return;
    }

    // local duplicate guard
    if (friends.some((f) => f.username.toLowerCase() === input.toLowerCase())) {
      showMessage("Friend already added.", "error");
      return;
    }

    try {
      setBusy(true);

      // Look up in Profiles by lowercase username, fallback to exact username
      const profilesCol = collection(db, "Profiles");
      const q1 = query(profilesCol, where("usernameLower", "==", input.toLowerCase()));
      let snap = await getDocs(q1);
      if (snap.empty) {
        const q2 = query(profilesCol, where("username", "==", input));
        snap = await getDocs(q2);
      }

      if (snap.empty) {
        showMessage("Friend not found.", "error");
        setBusy(false);
        return;
      }

      const friendDoc = snap.docs[0];
      const friendUid = friendDoc.id;
      const friendUsername = (friendDoc.data() as any)?.username || input;

      // Write to Friends/{myUid}.friends (arrayUnion)
      const myFriendsRef = doc(db, "Friends", user.uid);
      const newFriend: Friend = { uid: friendUid, username: friendUsername };
      await setDoc(myFriendsRef, { friends: arrayUnion(newFriend) }, { merge: true });

      await fetchFriends();
      setName("");
      showMessage("Friend added!", "success");
    } catch (e) {
      console.error("Error adding friend:", e);
      showMessage("Failed to add friend.", "error");
    } finally {
      setBusy(false);
    }
  };

  const FriendRow = ({ item }: { item: Friend }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {item.username?.[0]?.toUpperCase() || "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.username}</Text>
        {/* UID intentionally hidden for now */}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.header}>Friends</Text>

        {/* Add Friend */}
        <View style={styles.card}>
          <Text style={styles.label}>Add a Friend (by username)</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="friend_username"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={handleAddFriend}
            />
            <Pressable
              disabled={busy}
              onPress={handleAddFriend}
              style={[styles.btn, { paddingHorizontal: 16 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Add</Text>
              )}
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

        {/* Friends List (no tapping) */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>My Friends</Text>
          {friends.length === 0 ? (
            <Text style={styles.subtle}>No friends yet — add someone above.</Text>
          ) : (
            <FlatList
              data={friends}
              // Unique key fix: prefer uid; fallback to username+index
              keyExtractor={(item, index) =>
                item.uid ? `uid:${item.uid}` : `name:${item.username.toLowerCase()}:${index}`
              }
              renderItem={FriendRow}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 70, gap: 14 },
  header: { fontSize: 28, fontWeight: "800", color: colors.text },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
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
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "800" },
  message: { marginTop: 10, fontWeight: "600" },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8, color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  rowTitle: { fontWeight: "700", color: colors.text },
  subtle: { color: colors.subtle },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});