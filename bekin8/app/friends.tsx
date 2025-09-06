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
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type Friend = { uid?: string; username: string };

type FriendRequest = {
  id: string;
  senderUid: string;
  receiverUid: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt?: any;
  updatedAt?: any;
  senderUsername?: string;
  receiverUsername?: string;
};

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
  // Username
  const [usernameInput, setUsernameInput] = useState("");
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [busyUsername, setBusyUsername] = useState(false);

  // Friends state
  const [name, setName] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | null }>({
    text: "",
    type: null,
  });

  const showMessage = (text: string, type: "error" | "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: null }), 2500);
  };

  const requestIdFor = (a: string, b: string) => `${a}_${b}`;

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

  const fetchCurrentUsername = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const profileRef = doc(db, "Profiles", user.uid);
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      const u = (snap.data() as any)?.username;
      if (typeof u === "string" && u.trim()) {
        setCurrentUsername(u.trim());
        setUsernameInput(u.trim());
      } else {
        setCurrentUsername(null);
      }
    } else {
      setCurrentUsername(null);
    }
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchFriends();
        fetchCurrentUsername();

        const qIn = query(
          collection(db, "FriendRequests"),
          where("receiverUid", "==", user.uid),
          where("status", "==", "pending")
        );
        const unsubIn = onSnapshot(qIn, (snap) => {
          const arr: FriendRequest[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          setIncoming(arr);
        });

        const qOut = query(
          collection(db, "FriendRequests"),
          where("senderUid", "==", user.uid),
          where("status", "==", "pending")
        );
        const unsubOut = onSnapshot(qOut, (snap) => {
          const arr: FriendRequest[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          setOutgoing(arr);
        });

        cleanup = () => {
          unsubIn();
          unsubOut();
        };
      } else {
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        setCurrentUsername(null);
      }
    });
    return () => {
      unsubAuth();
      if (cleanup) cleanup();
    };
  }, []);

  // Username setter (kept for later use)
  const handleSetUsername = async () => {
    const user = auth.currentUser;
    if (!user) {
      showMessage("Please log in first.", "error");
      return;
    }

    const desired = usernameInput.trim();
    if (!desired) {
      showMessage("Username required.", "error");
      return;
    }
    if (desired.length < 3 || desired.length > 20) {
      showMessage("3–20 characters, please.", "error");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(desired)) {
      showMessage("Use letters, numbers, or underscore only.", "error");
      return;
    }

    const desiredLower = desired.toLowerCase();

    try {
      setBusyUsername(true);
      const profilesCol = collection(db, "Profiles");
      const q1 = query(profilesCol, where("usernameLower", "==", desiredLower));
      const snap = await getDocs(q1);

      if (!snap.empty) {
        const takenBy = snap.docs[0].id;
        if (takenBy !== user.uid) {
          showMessage("That username is already taken.", "error");
          return;
        }
      }

      await setDoc(
        doc(db, "Profiles", user.uid),
        { username: desired, usernameLower: desiredLower },
        { merge: true }
      );

      setCurrentUsername(desired);
      showMessage("Username saved!", "success");
    } catch (e) {
      console.error("handleSetUsername error", e);
      showMessage("Failed to save username.", "error");
    } finally {
      setBusyUsername(false);
    }
  };

  // --- handleAddFriend, acceptRequest, rejectRequest, cancelRequest (unchanged) ---
  const handleAddFriend = async () => {
    const input = name.trim();
    if (!input) return;

    const me = auth.currentUser;
    if (!me) {
      showMessage("Please log in first.", "error");
      return;
    }

    if (friends.some((f) => f.username.toLowerCase() === input.toLowerCase())) {
      showMessage("Already friends.", "error");
      return;
    }

    try {
      setBusy(true);

      const profilesCol = collection(db, "Profiles");
      const q1 = query(profilesCol, where("usernameLower", "==", input.toLowerCase()));
      let snap = await getDocs(q1);
      if (snap.empty) {
        const q2 = query(profilesCol, where("username", "==", input));
        snap = await getDocs(q2);
      }

      if (snap.empty) {
        showMessage("User not found.", "error");
        return;
      }

      const targetDoc = snap.docs[0];
      const targetUid = targetDoc.id;
      const targetUsername = (targetDoc.data() as any)?.username || input;

      if (targetUid === me.uid) {
        showMessage("You can’t add yourself.", "error");
        return;
      }

      const outId = requestIdFor(me.uid, targetUid);
      const inId = requestIdFor(targetUid, me.uid);
      const existingOut = await getDoc(doc(db, "FriendRequests", outId));
      const existingIn = await getDoc(doc(db, "FriendRequests", inId));

      if (existingOut.exists() && (existingOut.data() as any).status === "pending") {
        showMessage("Request already sent.", "error");
        return;
      }
      if (existingIn.exists() && (existingIn.data() as any).status === "pending") {
        showMessage("They already requested you — check requests above.", "success");
        return;
      }

      const myProfileSnap = await getDoc(doc(db, "Profiles", me.uid));
      const myUsername = (myProfileSnap.data() as any)?.username || "";

      await setDoc(
        doc(db, "FriendRequests", outId),
        {
          senderUid: me.uid,
          receiverUid: targetUid,
          status: "pending",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          senderUsername: myUsername,
          receiverUsername: targetUsername,
        },
        { merge: true }
      );

      setName("");
      showMessage("Request sent!", "success");
    } catch (e) {
      console.error("Error sending request:", e);
      showMessage("Failed to send request.", "error");
    } finally {
      setBusy(false);
    }
  };

  const acceptRequest = async (req: FriendRequest) => {
    const me = auth.currentUser;
    if (!me || req.receiverUid !== me.uid) return;

    try {
      setBusy(true);
      await updateDoc(doc(db, "FriendRequests", req.id), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });

      const myFriendsRef = doc(db, "Friends", me.uid);
      const newFriend: Friend = {
        uid: req.senderUid,
        username: req.senderUsername || req.senderUid,
      };
      await setDoc(myFriendsRef, { friends: arrayUnion(newFriend) }, { merge: true });

      showMessage("Friend added!", "success");
      await fetchFriends();
    } catch (e) {
      console.error("acceptRequest error", e);
      showMessage("Failed to accept.", "error");
    } finally {
      setBusy(false);
    }
  };

  const rejectRequest = async (req: FriendRequest) => {
    const me = auth.currentUser;
    if (!me || req.receiverUid !== me.uid) return;

    try {
      setBusy(true);
      await updateDoc(doc(db, "FriendRequests", req.id), {
        status: "rejected",
        updatedAt: serverTimestamp(),
      });
      showMessage("Request rejected.", "success");
    } catch (e) {
      console.error("rejectRequest error", e);
      showMessage("Failed to reject.", "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (req: FriendRequest) => {
    const me = auth.currentUser;
    if (!me || req.senderUid !== me.uid) return;

    try {
      setBusy(true);
      await updateDoc(doc(db, "FriendRequests", req.id), {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      });
      showMessage("Request cancelled.", "success");
    } catch (e) {
      console.error("cancelRequest error", e);
      showMessage("Failed to cancel.", "error");
    } finally {
      setBusy(false);
    }
  };

  // Row components
  const RequestRowIncoming = ({ item }: { item: FriendRequest }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {(item.senderUsername?.[0] || "?").toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.senderUsername || item.senderUid}</Text>
        <Text style={styles.subtle}>wants to be friends</Text>
      </View>
      <Pressable
        onPress={() => acceptRequest(item)}
        disabled={busy}
        style={[styles.smallBtn, { backgroundColor: colors.primary }]}
      >
        <Text style={styles.smallBtnText}>Accept</Text>
      </Pressable>
      <Pressable
        onPress={() => rejectRequest(item)}
        disabled={busy}
        style={[styles.smallBtn, { backgroundColor: "#b00020" }]}
      >
        <Text style={styles.smallBtnText}>Reject</Text>
      </Pressable>
    </View>
  );

  const RequestRowOutgoing = ({ item }: { item: FriendRequest }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {(item.receiverUsername?.[0] || "?").toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.receiverUsername || item.receiverUid}</Text>
        <Text style={styles.subtle}>pending…</Text>
      </View>
      <Pressable
        onPress={() => cancelRequest(item)}
        disabled={busy}
        style={[styles.smallBtn, { backgroundColor: "#444" }]}
      >
        <Text style={styles.smallBtnText}>Cancel</Text>
      </Pressable>
    </View>
  );

  const FriendRow = ({ item }: { item: Friend }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {item.username?.[0]?.toUpperCase() || "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.username}</Text>
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

        {/* Username section */}
        <View style={styles.card}>
          {currentUsername ? (
            <>
              <Text style={styles.label}>Your username</Text>
              <Text style={styles.rowTitle}>{currentUsername}</Text>

              {/* --- Update form (disabled for now) ---
              <View style={styles.inputRow}>
                <TextInput
                  value={usernameInput}
                  onChangeText={setUsernameInput}
                  placeholder="choose_a_username"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={handleSetUsername}
                />
                <Pressable
                  disabled={busyUsername}
                  onPress={handleSetUsername}
                  style={[styles.btn, { paddingHorizontal: 16 }]}
                >
                  {busyUsername ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Update</Text>
                  )}
                </Pressable>
              </View>
              */}
            </>
          ) : (
            <>
              <Text style={styles.label}>Set your username</Text>
              <View style={styles.inputRow}>
                <TextInput
                  value={usernameInput}
                  onChangeText={setUsernameInput}
                  placeholder="choose_a_username"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={handleSetUsername}
                />
                <Pressable
                  disabled={busyUsername}
                  onPress={handleSetUsername}
                  style={[styles.btn, { paddingHorizontal: 16 }]}
                >
                  {busyUsername ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* Add Friend */}
        <View style={styles.card}>
          <Text style={styles.label}>Send a Friend Request (by username)</Text>
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
                <Text style={styles.btnText}>Send</Text>
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

        {/* Requests */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Requests</Text>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <Text style={styles.subtle}>No active requests.</Text>
          ) : (
            <>
              {incoming.length > 0 && (
                <>
                  <Text style={[styles.subtle, { marginBottom: 8 }]}>Incoming</Text>
                  <FlatList
                    data={incoming}
                    keyExtractor={(i) => `in_${i.id}`}
                    renderItem={RequestRowIncoming}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  />
                </>
              )}
              {outgoing.length > 0 && (
                <>
                  <Text style={[styles.subtle, { marginTop: 12, marginBottom: 8 }]}>Outgoing</Text>
                  <FlatList
                    data={outgoing}
                    keyExtractor={(i) => `out_${i.id}`}
                    renderItem={RequestRowOutgoing}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  />
                </>
              )}
            </>
          )}
        </View>

        {/* Friends */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>My Friends</Text>
          {friends.length === 0 ? (
            <Text style={styles.subtle}>No friends yet — send a request above.</Text>
          ) : (
            <FlatList
              data={friends}
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
  smallBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  smallBtnText: { color: "#fff", fontWeight: "800" },
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
