// app/friends.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
  FlatList,
  Alert,
  Pressable,
} from "react-native";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "expo-router";
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
  orderBy,
} from "firebase/firestore";
import { colors } from "@/components/ui/colors";
import { Friend, FriendRequest, Edge, MessageState } from "@/components/types";
import FriendsProfileAndInvite from "@/components/FriendsProfileAndInvite";
import FriendRequestsSection from "@/components/FriendRequestsSection";
import FriendsList from "@/components/FriendsList";
import FriendGroupEditor, { type FriendGroup } from "@/components/FriendGroupEditor";
import BottomBar from "@/components/BottomBar";

const edgeId = (a: string, b: string) => [a, b].sort().join("_");
const BOTTOM_BAR_SPACE = 90; // <-- extra scroll space so footer clears BottomBar

export default function FriendsScreen() {
  const router = useRouter();

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
  const [message, setMessage] = useState<MessageState>({ text: "", type: null });

  // Search input (send request)
  const [name, setName] = useState("");

  // Sources we merge
  const [subFriends, setSubFriends] = useState<Friend[]>([]);
  const [legacyFriends, setLegacyFriends] = useState<Friend[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Friend Groups
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FriendGroup | null>(null);

  // Username cache for UIDs from edges
  const nameCacheRef = useRef<Record<string, string>>({});

  // Logout state
  const [loggingOut, setLoggingOut] = useState(false);

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
        // Clear local state
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        setCurrentUsername(null);
        setSubFriends([]);
        setLegacyFriends([]);
        setEdges([]);
        setGroups([]);
        setEditingGroup(null);
        setGroupEditorOpen(false);

        // 🚪 Hard-guard: if unauthenticated, push to login and clear history
        router.replace("/");
        return;
      }

      fetchCurrentUsername();

      // Subscribe: incoming pending
      const qIn = query(
        collection(db, "FriendRequests"),
        where("receiverUid", "==", user.uid),
        where("status", "==", "pending")
      );
      const unsubIn = onSnapshot(qIn, (snap) => {
        setIncoming(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });
      cleanups.push(unsubIn);

      // Subscribe: outgoing pending
      const qOut = query(
        collection(db, "FriendRequests"),
        where("senderUid", "==", user.uid),
        where("status", "==", "pending")
      );
      const unsubOut = onSnapshot(qOut, (snap) => {
        setOutgoing(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });
      cleanups.push(unsubOut);

      // Subscribe: preferred subcollection
      const unsubSub = onSnapshot(
        collection(db, "users", user.uid, "friends"),
        (snap) => {
          const arr = snap.docs.map((d) => d.data() as any);
          const cleaned = cleanAndDedupeFriends(arr);
          cleaned.forEach((f) => {
            if (f.uid && f.username) nameCacheRef.current[f.uid] = f.username;
          });
          setSubFriends(cleaned);
        }
      );
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

      // Subscribe: Friend Groups for this user
      const qGroups = query(
        collection(db, "FriendGroups"),
        where("ownerUid", "==", user.uid),
        orderBy("name")
      );
      const unsubGroups = onSnapshot(qGroups, (snap) => {
        const arr: FriendGroup[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setGroups(arr);
      });
      cleanups.push(unsubGroups);
    });

    return () => {
      unsubAuth();
      cleanups.forEach((fn) => fn());
    };
  }, [router]);

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

      await setDoc(
        doc(db, "Profiles", user.uid),
        { username: desired, usernameLower: desiredLower },
        { merge: true }
      );

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

      // Prevent re-sending: check edges already accepted
      const qEdges = query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", me.uid),
        where("state", "==", "accepted")
      );
      const edgesSnap = await getDocs(qEdges);
      const alreadyFriends = edgesSnap.docs.some((d) => {
        const ed = d.data() as any;
        const uids: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
        return uids.includes(targetUid);
      });
      if (alreadyFriends) return showMessage("Already friends.", "success");

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
      if (
        (existingOut.exists() && (existingOut.data() as any).status === "accepted") ||
        (existingIn.exists() && (existingIn.data() as any).status === "accepted")
      ) {
        return showMessage("Already friends.", "success");
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

  // Accept / reject / cancel requests
  const acceptRequest = async (req: FriendRequest) => {
    const me = auth.currentUser;
    if (!me || req.receiverUid !== me.uid) return;

    try {
      setBusy(true);

      const otherUid = req.senderUid;

      await updateDoc(doc(db, "FriendRequests", req.id), {
        status: "accepted",
        updatedAt: serverTimestamp(),
      });

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

      const otherProfile = await getDoc(doc(db, "Profiles", otherUid));
      const otherUsername =
        (otherProfile.exists() && (otherProfile.data() as any)?.username) ||
        req.senderUsername ||
        otherUid;

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

  const removeFriend = async (friend: Friend) => {
    const me = auth.currentUser;
    if (!me) return showMessage("Please log in first.", "error");
    if (!friend.uid) return showMessage("Can’t remove this entry (missing UID).", "error");

    const otherUid = friend.uid;
    const eid = edgeId(me.uid, otherUid);

    try {
      setBusy(true);

      // 1) Delete canonical FriendEdge
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
    Alert.alert("Remove friend", `Are you sure you want to remove ${friend.username}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeFriend(friend) },
    ]);
  };

  // --- Logout handler (footer button) ---
  const handleLogout = async () => {
    if (loggingOut) return;
    try {
      setLoggingOut(true);
      await signOut(auth);
      router.dismissAll?.();
      router.replace("/");
    } catch {
      setLoggingOut(false);
      Alert.alert("Error", "Failed to log out. Please try again.");
    }
  };

  // Handlers: Friend Groups
  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupEditorOpen(true);
  };

  const openEditGroup = (g: FriendGroup) => {
    setEditingGroup(g);
    setGroupEditorOpen(true);
  };

  const onSavedGroup = (g: FriendGroup) => {
    // No-op; realtime subscription updates the list. This keeps state simple.
    showMessage(editingGroup ? "Group updated!" : "Group created!", "success");
  };

  const onDeletedGroup = (groupId: string) => {
    showMessage("Group deleted.", "success");
  };

  // ----- PAGE SCROLLER: One FlatList for the entire screen -----
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={friends}
        keyExtractor={(item, index) =>
          item.uid ? `uid:${item.uid}` : `name:${item.username.toLowerCase()}:${index}`
        }
        renderItem={({ item }) => (
          <FriendsList.Row item={item} busy={busy} onRemove={() => confirmRemove(item)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={styles.header}>Friends</Text>

            {/* Username + Invite */}
            <FriendsProfileAndInvite
              currentUsername={currentUsername}
              usernameInput={usernameInput}
              onChangeUsername={setUsernameInput}
              onSaveUsername={handleSetUsername}
              busyUsername={busyUsername}
              nameInput={name}
              onChangeName={setName}
              hasProfileUsername={!!currentUsername?.trim()}
              onSendRequest={handleAddFriend}
              busySend={busy}
              message={message}
            />

            {/* My Friend Groups */}
            <View style={styles.card}>
              <View style={styles.groupsHeaderRow}>
                <Text style={styles.sectionTitle}>My Friend Groups</Text>
                <Pressable onPress={openCreateGroup} hitSlop={10} style={styles.plusBtn}>
                  <Text style={styles.plusBtnText}>＋</Text>
                </Pressable>
              </View>

              {groups.length === 0 ? (
                <Text style={styles.subtle}>No groups yet — tap + to create one.</Text>
              ) : (
                <View style={{ rowGap: 8 }}>
                  {groups.map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => openEditGroup(g)}
                      style={styles.groupRow}
                    >
                      <View style={styles.groupAvatar}>
                        <Text style={{ color: "#fff", fontWeight: "800" }}>
                          {g.name?.[0]?.toUpperCase() || "G"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupName}>{g.name}</Text>
                        <Text style={styles.groupMeta}>
                          {(g.memberUids?.length ?? 0)} member{(g.memberUids?.length ?? 0) === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <Text style={styles.groupEditHint}>Edit</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Requests */}
            <FriendRequestsSection
              incoming={incoming}
              outgoing={outgoing}
              busy={busy}
              onAccept={acceptRequest}
              onReject={rejectRequest}
              onCancel={cancelRequest}
            />

            {/* Friends section title */}
            <View style={[styles.card, { marginBottom: 0 }]}>
              <Text style={styles.sectionTitle}>My Friends</Text>
              {friends.length === 0 && (
                <Text style={styles.subtle}>No friends yet — send a request above.</Text>
              )}
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={{ paddingTop: 16, paddingBottom: 32, alignItems: "center" }}>
            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              style={[styles.logoutBtn, loggingOut && { opacity: 0.6 }]}
            >
              {loggingOut ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.logoutBtnText}>Log out</Text>
              )}
            </Pressable>
          </View>
        }
        contentContainerStyle={{
          padding: 20,
          paddingTop: 70,
          paddingBottom: BOTTOM_BAR_SPACE, // ✅ ensures logout clears BottomBar
          rowGap: 14,
        }}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : "none"}
        removeClippedSubviews={false}
        initialNumToRender={20}
        windowSize={10}
      />

      {/* Friend Group Editor Modal */}
      <FriendGroupEditor
        visible={groupEditorOpen}
        group={editingGroup}
        onClose={() => setGroupEditorOpen(false)}
        onSaved={onSavedGroup}
        onDeleted={onDeletedGroup}
      />
      <BottomBar />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { rowGap: 14 },
  header: { fontSize: 28, fontWeight: "800", color: colors.text, textAlign: 'center' },
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

  // Groups section
  groupsHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  plusBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  plusBtnText: { color: "#fff", fontWeight: "900", fontSize: 20 },

  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.card,
  },
  groupAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  groupName: { fontWeight: "800", color: colors.text },
  groupMeta: { color: colors.subtle, marginTop: 2, fontSize: 12 },
  groupEditHint: { color: colors.primary, fontWeight: "700" },

  // Logout button
  logoutBtn: {
    backgroundColor: "#B00020",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    minWidth: 160,
    alignItems: "center",
  },
  logoutBtnText: { color: "#fff", fontWeight: "800" },
});