// app/friends.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
  Alert,
} from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase.config";
import {
  arrayUnion,
  collection,
  deleteDoc,
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

type Edge = { id: string; uids: string[]; state: "accepted" | "blocked" | "pending" };

const colors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  error: "#B00020",
  success: "#0E7A0D",
  danger: "#B00020",
  dark: "#111827",
};

const edgeId = (a: string, b: string) => [a, b].sort().join("_");

export default function FriendsScreen() {
  // Username state
  const [usernameInput, setUsernameInput] = useState("");
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [busyUsername, setBusyUsername] = useState(false);

  // Requests
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);

  // Friends (derived from multiple sources)
  const [friends, setFriends] = useState<Friend[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | null }>({
    text: "",
    type: null,
  });

  // Search input (send request)
  const [name, setName] = useState("");

  // Sources we merge
  const [subFriends, setSubFriends] = useState<Friend[]>([]);
  const [legacyFriends, setLegacyFriends] = useState<Friend[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Username cache for UIDs from edges
  const nameCacheRef = useRef<Record<string, string>>({});

  const showMessage = (text: string, type: "error" | "success") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: null }), 2500);
  };

  const requestIdFor = (a: string, b: string) => `${a}_${b}`;

  // Helpers
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
        nameCacheRef.current[user.uid] = u.trim();
      } else {
        setCurrentUsername(null);
      }
    } else {
      setCurrentUsername(null);
    }
  };

  const resolveUsernames = async (uids: string[]) => {
    const toFetch = uids.filter((u) => !nameCacheRef.current[u]);
    for (const uid of toFetch) {
      try {
        const prof = await getDoc(doc(db, "Profiles", uid));
        const uname =
          (prof.exists() && (prof.data() as any)?.username) ||
          (prof.exists() && (prof.data() as any)?.usernameLower);
        if (uname) nameCacheRef.current[uid] = String(uname);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      cleanups.forEach((fn) => fn());
      cleanups = [];

      if (!user) {
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        setCurrentUsername(null);
        setSubFriends([]);
        setLegacyFriends([]);
        setEdges([]);
        return;
      }

      fetchCurrentUsername();

      // Subscribe: incoming pending (receiver==me)
      const qIn = query(
        collection(db, "FriendRequests"),
        where("receiverUid", "==", user.uid),
        where("status", "==", "pending")
      );
      const unsubIn = onSnapshot(qIn, (snap) => {
        setIncoming(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });
      cleanups.push(unsubIn);

      // Subscribe: outgoing pending (sender==me)
      const qOut = query(
        collection(db, "FriendRequests"),
        where("senderUid", "==", user.uid),
        where("status", "==", "pending")
      );
      const unsubOut = onSnapshot(qOut, (snap) => {
        setOutgoing(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });
      cleanups.push(unsubOut);

      // Subscribe: preferred subcollection (my denorm list)
      const unsubSub = onSnapshot(collection(db, "users", user.uid, "friends"), (snap) => {
        const arr = snap.docs.map((d) => d.data() as any);
        const cleaned = cleanAndDedupeFriends(arr);
        cleaned.forEach((f) => {
          if (f.uid && f.username) nameCacheRef.current[f.uid] = f.username;
        });
        setSubFriends(cleaned);
      });
      cleanups.push(unsubSub);

      // Subscribe: legacy top-level Friends/{me}
      const unsubLegacy = onSnapshot(doc(db, "Friends", user.uid), (snap) => {
        if (!snap.exists()) {
          setLegacyFriends([]);
          return;
        }
        const cleaned = cleanAndDedupeFriends((snap.data() as any)?.friends || []);
        cleaned.forEach((f) => {
          if (f.uid && f.username) nameCacheRef.current[f.uid] = f.username;
        });
        setLegacyFriends(cleaned);
      });
      cleanups.push(unsubLegacy);

      // Subscribe: canonical edges (accepted)
      const qEdges = query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", user.uid),
        where("state", "==", "accepted")
      );
      const unsubEdges = onSnapshot(qEdges, (snap) => {
        setEdges(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });
      cleanups.push(unsubEdges);
    });

    return () => {
      unsubAuth();
      cleanups.forEach((fn) => fn());
    };
  }, []);

  // Merge sources into friends
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      setFriends([]);
      return;
    }

    const map = new Map<string, Friend>();
    subFriends.forEach((f) => {
      if (f.uid) map.set(f.uid, { uid: f.uid, username: f.username });
    });
    legacyFriends.forEach((f) => {
      if (f.uid && !map.has(f.uid)) map.set(f.uid, { uid: f.uid, username: f.username });
    });

    const otherUids: string[] = [];
    edges.forEach((e) => {
      const other = e.uids.find((u) => u !== me.uid);
      if (!other) return;
      if (!map.has(other)) {
        const uname = nameCacheRef.current[other] || other;
        map.set(other, { uid: other, username: uname });
        if (!nameCacheRef.current[other]) otherUids.push(other);
      }
    });

    if (otherUids.length) {
      resolveUsernames(otherUids).then(() => {
        setFriends((prev) => {
          const m = new Map<string, Friend>();
          for (const f of Array.from(map.values())) {
            const u = f.uid ? nameCacheRef.current[f.uid] || f.username : f.username;
            m.set(f.uid || f.username, { uid: f.uid, username: u });
          }
          return Array.from(m.values()).sort((a, b) => a.username.localeCompare(b.username));
        });
      });
    }

    const merged = Array.from(map.values()).sort((a, b) => a.username.localeCompare(b.username));
    setFriends(merged);
  }, [subFriends, legacyFriends, edges]);

  // Derived flag: has a username?
  const hasProfileUsername = !!currentUsername?.trim();

  // Username setter
  const handleSetUsername = async () => {
    const user = auth.currentUser;
    if (!user) return showMessage("Please log in first.", "error");

    const desired = usernameInput.trim();
    if (!desired) return showMessage("Username required.", "error");
    if (desired.length < 3 || desired.length > 20) return showMessage("3–20 characters, please.", "error");
    if (!/^[a-zA-Z0-9_]+$/.test(desired)) return showMessage("Use letters, numbers, or underscore only.", "error");

    const desiredLower = desired.toLowerCase();

    try {
      setBusyUsername(true);
      const profilesCol = collection(db, "Profiles");
      const q1 = query(profilesCol, where("usernameLower", "==", desiredLower));
      const snap = await getDocs(q1);

      if (!snap.empty && snap.docs[0].id !== user.uid) {
        return showMessage("That username is already taken.", "error");
      }

      await setDoc(doc(db, "Profiles", user.uid), { username: desired, usernameLower: desiredLower }, { merge: true });

      setCurrentUsername(desired);
      nameCacheRef.current[user.uid] = desired;
      showMessage("Username saved!", "success");
    } catch (e) {
      console.error("handleSetUsername error", e);
      showMessage("Failed to save username.", "error");
    } finally {
      setBusyUsername(false);
    }
  };

  // Send friend request
  const handleAddFriend = async () => {
    const input = name.trim();
    if (!input) return;

    const me = auth.currentUser;
    if (!me) return showMessage("Please log in first.", "error");
    if (!hasProfileUsername) return showMessage("Set a username first.", "error");

    try {
      setBusy(true);

      // Resolve username -> uid
      const profilesCol = collection(db, "Profiles");
      let snap = await getDocs(query(profilesCol, where("usernameLower", "==", input.toLowerCase())));
      if (snap.empty) snap = await getDocs(query(profilesCol, where("username", "==", input)));

      if (snap.empty) return showMessage("User not found.", "error");

      const targetDoc = snap.docs[0];
      const targetUid = targetDoc.id;
      const targetUsername = (targetDoc.data() as any)?.username || input;

      if (targetUid === me.uid) return showMessage("You can’t add yourself.", "error");

      // Check if already friends (edge exists and accepted)
      const eid = edgeId(me.uid, targetUid);
      const existingEdge = await getDoc(doc(db, "FriendEdges", eid));
      if (existingEdge.exists() && (existingEdge.data() as any)?.state === "accepted") {
        return showMessage("Already friends.", "success");
      }

      // Prevent duplicates in requests
      const outId = requestIdFor(me.uid, targetUid);
      const inId = requestIdFor(targetUid, me.uid);
      const existingOut = await getDoc(doc(db, "FriendRequests", outId));
      const existingIn = await getDoc(doc(db, "FriendRequests", inId));

      if (existingOut.exists() && (existingOut.data() as any).status === "pending") {
        return showMessage("Request already sent.", "error");
      }
      if (existingIn.exists() && (existingIn.data() as any).status === "pending") {
        return showMessage("They already requested you — check requests above.", "success");
      }

      // Create outgoing request
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

  // Accept request — receiver only
  const acceptRequest = async (req: FriendRequest) => {
    const me = auth.currentUser;
    if (!me || req.receiverUid !== me.uid) return;

    try {
      setBusy(true);

      const otherUid = req.senderUid;

      // 1) Flip request to accepted
      await updateDoc(doc(db, "FriendRequests", req.id), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });

      // 2) Create/Upsert canonical edge (both sides will see via their listeners)
      const eid = edgeId(me.uid, otherUid);
      await setDoc(
        doc(db, "FriendEdges", eid),
        {
          uids: [me.uid, otherUid],
          state: "accepted",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 3) (Optional) Denormalize under *my* user for fast lists
      const otherProfile = await getDoc(doc(db, "Profiles", otherUid));
      const otherUsername =
        (otherProfile.exists() && (otherProfile.data() as any)?.username) || req.senderUsername || otherUid;

      await setDoc(
        doc(db, "users", me.uid, "friends", otherUid),
        { uid: otherUid, username: otherUsername, status: "accepted", acceptedAt: serverTimestamp() },
        { merge: true }
      );

      await setDoc(
        doc(db, "Friends", me.uid),
        { friends: arrayUnion({ uid: otherUid, username: otherUsername }) },
        { merge: true }
      );

      // 4) Clean up request doc (no longer needed)
      await deleteDoc(doc(db, "FriendRequests", req.id));

      nameCacheRef.current[otherUid] = otherUsername;

      showMessage("Friend added!", "success");
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

  // ---- Remove friend (UNFRIEND) ----
  const removeFriend = async (friend: Friend) => {
    const me = auth.currentUser;
    if (!me) return showMessage("Please log in first.", "error");
    if (!friend.uid) return showMessage("Can’t remove this entry (missing UID).", "error");

    const otherUid = friend.uid;
    const eid = edgeId(me.uid, otherUid);

    try {
      setBusy(true);

      // 1) Delete the canonical edge doc (true unfriend, enables re-request)
      await deleteDoc(doc(db, "FriendEdges", eid));

      // 2) Remove my denorm subcollection doc
      await deleteDoc(doc(db, "users", me.uid, "friends", otherUid));

      // 3) Remove from Friends/{me} array (rewrite safely)
      const fDoc = await getDoc(doc(db, "Friends", me.uid));
      if (fDoc.exists()) {
        const arr: any[] = Array.isArray((fDoc.data() as any).friends) ? (fDoc.data() as any).friends : [];
        const filtered = arr.filter((x) => String(x?.uid) !== otherUid);
        await setDoc(doc(db, "Friends", me.uid), { friends: filtered }, { merge: true });
      }

      showMessage(`Removed ${friend.username}.`, "success");
    } catch (e) {
      console.error("removeFriend error", e);
      showMessage("Failed to remove friend.", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (friend: Friend) => {
    Alert.alert(
      "Remove friend",
      `Are you sure you want to remove ${friend.username}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeFriend(friend),
        },
      ]
    );
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
        style={[styles.smallBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}
      >
        <Text style={styles.smallBtnText}>Accept</Text>
      </Pressable>
      <Pressable
        onPress={() => rejectRequest(item)}
        disabled={busy}
        style={[styles.smallBtn, { backgroundColor: colors.danger, opacity: busy ? 0.5 : 1 }]}
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
        style={[styles.smallBtn, { backgroundColor: "#444", opacity: busy ? 0.5 : 1 }]}
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
      <Pressable
        disabled={busy || !item.uid}
        onPress={() => confirmRemove(item)}
        style={[
          styles.smallBtn,
          {
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: colors.border,
            opacity: busy || !item.uid ? 0.5 : 1,
          },
        ]}
      >
        <Text style={{ fontSize: 18 }}>⛔️</Text>
      </Pressable>
    </View>
  );

  // ----- PAGE SCROLLER: One FlatList for the entire screen -----
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={friends}
        keyExtractor={(item, index) =>
          item.uid ? `uid:${item.uid}` : `name:${item.username.toLowerCase()}:${index}`
        }
        renderItem={FriendRow}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={styles.header}>Friends</Text>

            {/* Username card */}
            <View style={styles.card}>
              {currentUsername ? (
                <>
                  <Text style={styles.label}>Your username</Text>
                  <Text style={styles.rowTitle}>{currentUsername}</Text>
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
                      style={[styles.btn, { paddingHorizontal: 16, opacity: busyUsername ? 0.6 : 1 }]}
                    >
                      {busyUsername ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
                    </Pressable>
                  </View>
                </>
              )}
            </View>

            {/* Add Friend */}
            <View style={styles.card}>
              <Text style={styles.label}>Send a Friend Request (by username)</Text>
              {!hasProfileUsername && (
                <Text style={[styles.subtle, { marginBottom: 8 }]}>You need a username first.</Text>
              )}
              <View style={styles.inputRow}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="friend_username"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  style={[styles.input, !hasProfileUsername && styles.inputDisabled]}
                  editable={hasProfileUsername}
                  returnKeyType="done"
                  onSubmitEditing={hasProfileUsername ? handleAddFriend : undefined}
                />
                <Pressable
                  disabled={busy || !hasProfileUsername}
                  onPress={handleAddFriend}
                  style={[styles.btn, { paddingHorizontal: 16, opacity: busy || !hasProfileUsername ? 0.5 : 1 }]}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send</Text>}
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
                        scrollEnabled={false}
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
                        scrollEnabled={false}
                      />
                    </>
                  )}
                </>
              )}
            </View>

            {/* Friends section title */}
            <View style={[styles.card, { marginBottom: 0 }]}>
              <Text style={styles.sectionTitle}>My Friends</Text>
              {friends.length === 0 && <Text style={styles.subtle}>No friends yet — send a request above.</Text>}
            </View>
          </View>
        }
        ListFooterComponent={<View style={{ height: 48 }} />}
        contentContainerStyle={{
          padding: 20,
          paddingTop: 70,
          rowGap: 14,
        }}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : "none"}
        removeClippedSubviews={false}
        initialNumToRender={20}
        windowSize={10}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { rowGap: 14 },
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
    marginBottom: 14,
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
    backgroundColor: colors.card,
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