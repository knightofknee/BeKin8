// app/friends.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
  FlatList,
  Alert,
  Linking,
  Pressable,
  Switch,
  Share,
} from "react-native";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase.config";
import { getFunctions, httpsCallable } from "firebase/functions";
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
import { SCREEN_PAD } from "@/components/ui/layout";
import { Friend, FriendRequest, Edge, MessageState } from "@/components/types";
import FriendsProfileAndInvite from "@/components/FriendsProfileAndInvite";
import FriendRequestsSection from "@/components/FriendRequestsSection";
import FriendsList from "@/components/FriendsList";
import FriendGroupEditor, { type FriendGroup } from "@/components/FriendGroupEditor";
import BottomBar from "@/components/BottomBar";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { useOnline } from "../providers/NetworkProvider";
import { tap } from "../utils/haptics";
import { buildInviteUrl, prefetchMyInviteCode } from "../lib/inviteLink";
import TutorialResumeBanner from "@/components/tutorial/TutorialResumeBanner";
import FriendsSetupCard from "@/components/tutorial/FriendsSetupCard";
import { useTour, useTourTarget } from "../providers/TourProvider";
import { useOnboarding } from "../providers/OnboardingProvider";
import { emitNotifyPermissionChange } from "../lib/notifyPermission";

import * as Notifications from "expo-notifications";

// 🔔 Push helpers (new)
import {
  ensurePushPermissionsAndToken,
  subscribeToFriendNotifications,
  unsubscribeFromFriendNotifications,
  syncPushTokenIfGranted,
} from "../lib/push";

const edgeId = (a: string, b: string) => [a, b].sort().join("_");
const BOTTOM_BAR_SPACE = 90; // <-- extra scroll space so footer clears BottomBar

export default function FriendsScreen() {
  const { user, initialized, profile, profileLoaded } = useAuth();
  const { colors: tc } = useTheme();
  const online = useOnline();
  const [notifyByUid, setNotifyByUid] = useState<Record<string, boolean>>({});
  const [notifyAllBeacons, setNotifyAllBeacons] = useState(false);
  const [notifyAllBusy, setNotifyAllBusy] = useState(false);
  const router = useRouter();
  // Non-blocking "add your first friend" card. Shown to ANY user with no friend yet whenever they are
  // on this screen (dismissable for the session, so it returns on the next visit). It locks nothing;
  // "Next" hands off to the final tour step (checklist / celebration).
  const [setupCardDismissed, setSetupCardDismissed] = useState(false);
  const setupHelpNext = useCallback(() => {
    setSetupCardDismissed(true);
    router.navigate({ pathname: "/home", params: { tutorial: "1", tourStepId: "set-first-beacon" } });
  }, [router]);

  // Username state, seeded from cached profile, editable locally
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
  // Display name cache
  const displayNameCacheRef = useRef<Record<string, string>>({});
  // Profile color cache
  const colorCacheRef = useRef<Record<string, string>>({});

  // NEW: my blocked users set
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());

  // My invite code, sourced from the ensureInviteCode callable's RETURN rather than a Firestore field:
  // the code no longer lives on the world-readable Profiles doc (it was a public force-friend token).
  // The callable owns it (users/{uid}, owner-only) and hands it back to us here.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  useEffect(() => {
    if (!profileLoaded || inviteCode || !currentUsername?.trim()) return;
    let alive = true;
    (async () => {
      const uid = user?.uid;
      if (!uid) return;
      // Cache-first (the root layout prefetches at sign-in), so the Share button is live
      // immediately; falls back to minting via the callable for brand-new usernames.
      const code = await prefetchMyInviteCode(uid);
      if (alive && code) setInviteCode(code);
    })();
    return () => { alive = false; };
  }, [profileLoaded, inviteCode, currentUsername, user?.uid]);

  // Coach-mark tour targets on this screen.
  const { isActive: tourActive, currentStepId, currentStepTarget, measureTarget } = useTour();
  const groupsTarget = useTourTarget("friends-groups");
  const brianTarget = useTourTarget("add-brian");
  // Wraps the Requests section + the My Friends list/add-brian card so the tour highlights them as one
  // step. The page FlatList scrolls this block into view when the tour reaches it.
  const requestsListTarget = useTourTarget("friends-requests");
  // Zero-content marker at the very END of the friend rows: the tour unions it with the
  // requests block so the ring encloses EVERY row (rows are list items, not wrappable).
  const listEndTarget = useTourTarget("friends-list-end");
  const listRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);

  // Base-setup progress drives the resume banner here too, so a user on Friends sees it persist
  // until username + friend + notifications are all done.
  const onboarding = useOnboarding();

  // While the tour is on a Friends step, the page does NOT hand-scroll (scrollEnabled below):
  // the ring staying put while content slid under it read as broken. Instead the tour positions
  // each step's target itself. Uses the tour's measureTarget so it works for any registered
  // target, including ones inside child components.
  useEffect(() => {
    // friends-groups is deliberately NOT here: its card sits mid-screen where the TOP-slot callout
    // never covers it, and auto-scrolling it up to desiredY collided with the callout slot that
    // was latched from the pre-scroll measurement (callout landed ON the highlighted card).
    const SCROLLABLE = [
      "friends-username",
      "friends-profile",
      "friends-add-card",
      "friends-requests",
    ];
    if (!currentStepTarget || !SCROLLABLE.includes(currentStepTarget)) return;
    const bring = async () => {
      const r = await measureTarget(currentStepTarget);
      if (!r) return;
      // Default: block's top near the top of the screen, above a LOW callout. The friends-list
      // steps (speed 2b + full step 8) instead put their callout in the TOP slot, so their block
      // sits BELOW the callout (nothing covered).
      const desiredY = currentStepId === 'speed-friend' || currentStepId === 'full-friends' ? 330 : 120;
      const delta = r.y - desiredY;
      if (Math.abs(delta) > 12) {
        // SNAP, don't glide: an animated scroll here made the ring + callout visibly chase the
        // content a beat after they had already landed (the "awkward vertical shift").
        listRef.current?.scrollToOffset({ offset: Math.max(0, scrollYRef.current + delta), animated: false });
      }
    };
    const t0 = setTimeout(bring, 30); // immediately, so the snap lands before the ring/callout draw
    const t1 = setTimeout(bring, 320); // after the navigation to Friends settles
    const t2 = setTimeout(bring, 650); // a second pass in case layout was still mounting
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [currentStepTarget, currentStepId, measureTarget]);

  const handleShareInvite = async () => {
    const code = inviteCode ?? profile?.inviteCode; // state first; profile fallback during migration
    if (!code) return;
    const url = buildInviteUrl(code);
    // Share the LINK, nothing else. The sender adds their own words; no canned marketing blurb.
    try {
      if (Platform.OS === "ios") {
        await Share.share({ url }, { subject: "Add me on BeKin" });
      } else {
        // Android ignores `url`, so the link is the message.
        await Share.share({ message: url }, { dialogTitle: "Share your friend link" });
      }
    } catch {
      // user cancelled or share failed, no-op
    }
  };

  // Prevent double-toggles per-UID
  const togglingRef = useRef<Set<string>>(new Set());

  // Simple yes/no helper for native confirm
  function confirmAsync(title: string, message: string, okText = "Allow", cancelText = "Not now"): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(title, message, [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ]);
    });
  }


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
      const displayName = (f?.displayName ?? "").toString().trim() || undefined;
      out.push({ uid, username, displayName });
    }
    out.sort((a, b) => a.username.localeCompare(b.username));
    return out;
  };

  // Seed notifyAllBeacons from profile doc
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, "Profiles", uid), (snap) => {
      if (snap.exists()) {
        setNotifyAllBeacons(!!(snap.data() as any)?.notifyAllBeacons);
      }
    });
    return unsub;
  }, [user?.uid]);

  // Seed username from cached profile
  useEffect(() => {
    if (!profileLoaded || !profile) return;
    const u = profile.username;
    if (u) {
      setCurrentUsername(u);
      setUsernameInput(u);
      if (user?.uid) nameCacheRef.current[user.uid] = u;
    } else {
      setCurrentUsername(null);
    }
  }, [profileLoaded]);

  // Tracks which uids we've already fetched the canonical Profile for, so we
  // don't refetch on every snapshot, but unlike the old logic, this is NOT
  // seeded from the stamped denorm. The denorm's username may be stale or
  // wrong-cased; the canonical Profiles/{uid} doc is the source of truth.
  const profilesFetchedRef = useRef<Set<string>>(new Set());

  const resolveUsernames = async (uids: string[]) => {
    // De-dupe against in-flight / already-fetched. Pre-mark so a concurrent
    // call doesn't kick off the same fetch twice.
    const toFetch = uids.filter((u) => u && !profilesFetchedRef.current.has(u));
    if (!toFetch.length) return;
    toFetch.forEach((u) => profilesFetchedRef.current.add(u));
    await Promise.all(
      toFetch.map(async (uid) => {
        try {
          const prof = await getDoc(doc(db, "Profiles", uid));
          if (prof.exists()) {
            const data = prof.data() as any;
            const uname = data?.username || data?.usernameLower;
            // Overwrite any stamped value, canonical Profile wins.
            if (uname) nameCacheRef.current[uid] = String(uname);
            if (data?.displayName) displayNameCacheRef.current[uid] = String(data.displayName);
            // Fall back to legacy `avatarColor` field for older users whose
            // profile predates the rename to `profileColor`.
            const color = data?.profileColor || data?.avatarColor;
            if (color) colorCacheRef.current[uid] = color;
          }
        } catch {
          // ignore, leave the cache as-is so the stamped fallback survives
        }
      })
    );
  };

  useEffect(() => {
    // Wait until auth state is known; if logged out, clear state and exit.
    if (!initialized) return;

    // If `user` is null, clear local state (screen will be unreachable anyway due to the gate).
    if (!user) {
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
      setBlockedUids(new Set());
      setNotifyByUid({});
      return;
    }

    // Logged in: set up all Firestore subscriptions.
    const cleanups: Array<() => void> = [];

    // username seeded from AuthProvider profile cache

    // Optional: keep token fresh silently if already granted (no prompt)
    syncPushTokenIfGranted().catch(() => {});

    // Incoming pending
    {
      const qIn = query(
        collection(db, "FriendRequests"),
        where("receiverUid", "==", user.uid),
        where("status", "==", "pending")
      );
      cleanups.push(
        onSnapshot(qIn, (snap) => {
          setIncoming(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        })
      );
    }

    // Outgoing pending
    {
      const qOut = query(
        collection(db, "FriendRequests"),
        where("senderUid", "==", user.uid),
        where("status", "==", "pending")
      );
      cleanups.push(
        onSnapshot(qOut, (snap) => {
          setOutgoing(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        })
      );
    }

    // Preferred subcollection
    cleanups.push(
      onSnapshot(collection(db, "users", user.uid, "friends"), (snap) => {
        const arr = snap.docs.map((d) => d.data() as any);
        const cleaned = cleanAndDedupeFriends(arr);
        // Intentionally NOT seeding nameCacheRef from the stamped denorm,
        // the denorm can be stale or wrong-cased. The merge effect below
        // triggers a canonical Profile fetch instead, and the stamped
        // username flows through as a fallback in makeFriend().
        setSubFriends(cleaned);

        const nm: Record<string, boolean> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const uid = (typeof data?.uid === "string" && data.uid) || d.id;
          if (uid) nm[uid] = !!data?.notify;
        });
        setNotifyByUid(nm);
      })
    );

    // Legacy top-level Friends/{me}
    cleanups.push(
      onSnapshot(doc(db, "Friends", user.uid), (snap) => {
        if (!snap.exists()) {
          setLegacyFriends([]);
          return;
        }
        const cleaned = cleanAndDedupeFriends((snap.data() as any)?.friends || []);
        // Same as the subcollection listener, don't seed nameCacheRef from
        // the stamped denorm; let resolveUsernames fetch the canonical Profile.
        setLegacyFriends(cleaned);
      })
    );

    // Canonical edges (accepted)
    {
      const qEdges = query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", user.uid),
        where("state", "==", "accepted")
      );
      cleanups.push(
        onSnapshot(qEdges, (snap) => {
          setEdges(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        })
      );
    }

    // Friend Groups
    {
      const qGroups = query(
        collection(db, "FriendGroups"),
        where("ownerUid", "==", user.uid),
        orderBy("name")
      );
      cleanups.push(
        onSnapshot(qGroups, (snap) => {
          // Exclude the reserved onboarding "test" group (id `${uid}__tutorial_test`) so users can't
          // rename / add members to / delete it here, it must stay empty to "notify no one".
          const arr: any[] = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((g) => !String(g.id).endsWith('__tutorial_test'));
          setGroups(arr);
        })
      );
    }

    // Block list
    cleanups.push(
      onSnapshot(collection(db, "users", user.uid, "blocks"), (snap) => {
        const s = new Set<string>();
        snap.forEach((d) => s.add(d.id));
        setBlockedUids(s);
      })
    );

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [initialized, user]);

  // Merge sources into friends
  useEffect(() => {
    const me = auth.currentUser;
    if (!me) {
      setFriends([]);
      return;
    }

    // Prefer canonical Profile values (in caches) over the stamped denorm.
    // Stamped values are used only as a fallback for the brief window before
    // resolveUsernames has fetched the canonical Profile.
    const makeFriend = (uid: string, stampedUsername: string): Friend => ({
      uid,
      username: nameCacheRef.current[uid] || stampedUsername,
      displayName: displayNameCacheRef.current[uid] || undefined,
      profileColor: colorCacheRef.current[uid] || undefined,
    });

    const map = new Map<string, Friend>();
    subFriends.forEach((f) => {
      if (f.uid) map.set(f.uid, makeFriend(f.uid, f.username));
    });
    legacyFriends.forEach((f) => {
      if (f.uid && !map.has(f.uid)) map.set(f.uid, makeFriend(f.uid, f.username));
    });
    edges.forEach((e) => {
      const other = e.uids.find((u) => u !== me.uid);
      if (!other) return;
      if (!map.has(other)) {
        // No stamped username for edge-only friends, fall back to uid string
        // until resolveUsernames fills in the cache.
        map.set(other, makeFriend(other, other));
      }
    });

    // Fetch canonical Profile for EVERY friend we haven't already fetched.
    // resolveUsernames de-dupes internally via profilesFetchedRef.
    const allUids = Array.from(map.keys());
    const needFetch = allUids.filter((u) => !profilesFetchedRef.current.has(u));
    if (needFetch.length) {
      resolveUsernames(needFetch).then(() => {
        // After canonical data is in the caches, rebuild friends so the UI
        // picks up the corrected username / displayName / profileColor.
        setFriends((prev) => {
          const m = new Map<string, Friend>();
          for (const f of prev) {
            if (!f.uid) { m.set(f.username, f); continue; }
            // Reuse the existing entry's username as the stamped fallback so
            // we never lose info if the canonical fetch failed.
            m.set(f.uid, makeFriend(f.uid, f.username));
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

      // Write the username to the Profiles doc (the source of truth the app reads). This must NOT
      // be coupled to the Usernames reservation below: the deployed rules are default-deny and no
      // rule establishes the Usernames collection, so an atomic batch that includes it would reject
      // the whole commit and make usernames impossible to set. So commit Profiles on its own first.
      await setDoc(
        doc(db, "Profiles", user.uid),
        { username: desired, usernameLower: desiredLower },
        { merge: true }
      );

      // Best-effort uniqueness reservation, entirely separate so a rule denial can never block the
      // username itself. Only prevents true races once the deployed rules enforce create-if-absent
      // on the Usernames collection (a console-only rules change, see report); until then it is a
      // no-op that fails silently.
      const prevLower = currentUsername?.trim().toLowerCase();
      try {
        await setDoc(
          doc(db, "Usernames", desiredLower),
          { uid: user.uid, username: desired, createdAt: serverTimestamp() },
          { merge: true }
        );
        if (prevLower && prevLower !== desiredLower) {
          await deleteDoc(doc(db, "Usernames", prevLower));
        }
      } catch (claimErr: any) {
        if (__DEV__) console.warn("username reservation (non-blocking) failed", claimErr);
      }

      setCurrentUsername(desired);
      nameCacheRef.current[user.uid] = desired;
      showMessage("Username saved!", "success");
    } catch (e) {
      if (__DEV__) console.error("handleSetUsername error", e);
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

      const meUid = me.uid;
      if (targetUid === meUid) return showMessage("You can’t add yourself.", "error");

      // ── Block checks ────────────────────────────────────────────────────────
      // Run both block lookups in parallel.
      const [theirBlockOnMe, myBlockOnThem] = await Promise.all([
        getDoc(doc(db, "users", targetUid, "blocks", meUid)),
        getDoc(doc(db, "users", meUid, "blocks", targetUid)),
      ]);

      // If the target has us blocked, refuse. Use the same "User not found."
      // message that's shown when the username doesn't resolve at all, so we
      // don't reveal to the sender that they were specifically blocked.
      if (theirBlockOnMe.exists()) {
        return showMessage("User not found.", "error");
      }

      // If WE have THEM blocked, sending a fresh request implicitly unblocks,
      // delete our block doc first, then proceed. The cloud function won't
      // reverse this because the trigger fires on block creation, not deletion.
      if (myBlockOnThem.exists()) {
        await deleteDoc(doc(db, "users", meUid, "blocks", targetUid));
      }

      // Prevent re-sending: check edges already accepted
      const qEdges = query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", meUid),
        where("state", "==", "accepted")
      );
      const edgesSnap = await getDocs(qEdges);
      const alreadyFriends = edgesSnap.docs.some((d) => {
        const ed = d.data() as any;
        const uids: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
        return uids.includes(targetUid);
      });
      if (alreadyFriends) return showMessage("Already friends.", "success");

      // Prevent duplicates in requests. The FriendRequests read rule (query-safe) denies a get on a
      // NON-existent request, so a missing request throws permission-denied; treat that as "no such
      // request" and proceed. An existing request I participate in reads fine.
      const outId = requestIdFor(meUid, targetUid);
      const inId = requestIdFor(targetUid, meUid);
      const existingOut = await getDoc(doc(db, "FriendRequests", outId)).catch(() => null);
      const existingIn = await getDoc(doc(db, "FriendRequests", inId)).catch(() => null);

      if (existingOut?.exists() && (existingOut.data() as any).status === "pending") {
        return showMessage("Request already sent.", "error");
      }
      if (existingIn?.exists() && (existingIn.data() as any).status === "pending") {
        return showMessage("They already requested you. Check requests above.", "success");
      }
      if (
        (existingOut?.exists() && (existingOut.data() as any).status === "accepted") ||
        (existingIn?.exists() && (existingIn.data() as any).status === "accepted")
      ) {
        return showMessage("Already friends.", "success");
      }

      // Create outgoing request
      const myProfileSnap = await getDoc(doc(db, "Profiles", meUid));
      const myUsername = (myProfileSnap.data() as any)?.username || "";

      await setDoc(
        doc(db, "FriendRequests", outId),
        {
          senderUid: meUid,
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
      if (__DEV__) console.error("Error sending request:", e);
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

      // notify: true = new friendships DEFAULT ON for beacon notifications (the server's
      // onFriendRequestAccepted mirrors the sender's side).
      await setDoc(
        doc(db, "users", me.uid, "friends", otherUid),
        { uid: otherUid, username: otherUsername, status: "accepted", acceptedAt: serverTimestamp(), notify: true },
        { merge: true }
      );

      await setDoc(
        doc(db, "Friends", me.uid),
        { friends: arrayUnion({ uid: otherUid, username: otherUsername }) },
        { merge: true }
      );

      nameCacheRef.current[otherUid] = otherUsername;
      setNotifyByUid((prev) => ({ ...prev, [otherUid]: true }));
      try {
        await subscribeToFriendNotifications(otherUid);
      } catch {}

      showMessage("Friend added!", "success");
    } catch (e) {
      if (__DEV__) console.error("acceptRequest error", e);
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
      if (__DEV__) console.error("rejectRequest error", e);
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
      if (__DEV__) console.error("cancelRequest error", e);
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

      // Optimistically drop the friend from the local list so the UI updates
      // instantly, even before the edge-delete round-trips.
      setFriends((prev) => prev.filter((f) => f.uid !== otherUid));
      setSubFriends((prev) => prev.filter((f) => f.uid !== otherUid));
      setLegacyFriends((prev) => prev.filter((f) => f.uid !== otherUid));
      setEdges((prev) => prev.filter((e) => e.id !== eid));

      // 1) Delete the canonical FriendEdge. This is the AUTHORITATIVE action:
      // the server's onDocumentDeleted('FriendEdges/{id}') trigger two-sided-cleans
      // BOTH users' users/{x}/friends/{y} docs and Friends/{x} array entries. The
      // client cannot write the other user's docs, so we never attempt to.
      await deleteDoc(doc(db, "FriendEdges", eid));

      // 2) Best-effort local denorm cleanup for MY side only, so the list reflects
      // the removal even if the server trigger is briefly delayed / undeployed. A
      // failure here must not mask the authoritative edge delete above.
      try {
        await deleteDoc(doc(db, "users", me.uid, "friends", otherUid));
        const fDoc = await getDoc(doc(db, "Friends", me.uid));
        if (fDoc.exists()) {
          const arr: any[] = Array.isArray((fDoc.data() as any).friends) ? (fDoc.data() as any).friends : [];
          const filtered = arr.filter((x) => String(x?.uid) !== otherUid);
          await setDoc(doc(db, "Friends", me.uid), { friends: filtered }, { merge: true });
        }
      } catch (denormErr) {
        if (__DEV__) console.warn("removeFriend local denorm cleanup failed (best-effort)", denormErr);
      }

      showMessage(`Removed ${friend.username}.`, "success");
    } catch (e) {
      if (__DEV__) console.error("removeFriend error", e);
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

  // NEW: block friend (adds uid to users/{me}/blocks/{uid})
  const blockFriend = async (friend: Friend) => {
    const me = auth.currentUser;
    if (!me) return showMessage("Please log in first.", "error");
    if (!friend.uid) return showMessage("Can’t block this entry (missing UID).", "error");

    try {
      setBusy(true);
      await setDoc(doc(db, "users", me.uid, "blocks", friend.uid), {
        blockedAt: serverTimestamp(),
      });
      showMessage(`Blocked ${friend.username}.`, "success");
    } catch (e) {
      if (__DEV__) console.error("blockFriend error", e);
      showMessage("Failed to block user.", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = (friend: Friend) => {
    Alert.alert(
      "Block user",
      `You won’t see content from ${friend.username}. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: () => blockFriend(friend) },
      ]
    );
  };

  // NEW: filter out blocked users from the displayed list
  const visibleFriends = friends.filter((f) => !(f.uid && blockedUids.has(f.uid)));

  // Filter incoming friend requests so anything from a blocked user is hidden.
  // The onUserBlocked cloud function cancels pending requests on block, but this
  // is defense-in-depth for any edge case where a request slips through (e.g. a
  // request was created before the block, in the brief window before the trigger
  // fires, or from a client that bypassed the send-side check).
  const visibleIncoming = useMemo(
    () => incoming.filter((r) => !(r.senderUid && blockedUids.has(r.senderUid))),
    [incoming, blockedUids]
  );

  // "Add Brian", first-friend suggestion (only shown when user has zero friends)
  const [addingBrian, setAddingBrian] = useState(false);
  const handleAddBrian = async () => {
    const me = auth.currentUser;
    if (!me) return showMessage("Please log in first.", "error");
    if (!hasProfileUsername) return showMessage("Set a username first.", "error");

    try {
      setAddingBrian(true);

      const profilesCol = collection(db, "Profiles");
      let snap = await getDocs(query(profilesCol, where("usernameLower", "==", "brain")));
      if (snap.empty) snap = await getDocs(query(profilesCol, where("username", "==", "brain")));
      if (snap.empty) return showMessage("User not found.", "error");

      const targetDoc = snap.docs[0];
      const targetUid = targetDoc.id;
      const targetUsername = (targetDoc.data() as any)?.username || "brain";
      const meUid = me.uid;

      if (targetUid === meUid) return; // user IS Brian

      // Check if already friends
      const qEdges = query(
        collection(db, "FriendEdges"),
        where("uids", "array-contains", meUid),
        where("state", "==", "accepted")
      );
      const edgesSnap = await getDocs(qEdges);
      const alreadyFriends = edgesSnap.docs.some((d) => {
        const ed = d.data() as any;
        const uids: string[] = Array.isArray(ed?.uids) ? ed.uids : [];
        return uids.includes(targetUid);
      });
      if (alreadyFriends) return showMessage("Already friends with Brian!", "success");

      // Create the mutual friendship server-side. A client can't write Brian's
      // owner-only collections (users/{brian}/friends, Friends/{brian}), so we
      // call the Admin-SDK callable which creates the accepted edge + BOTH sides'
      // denorms after a bidirectional block check. The callable RESOLVES (does not
      // throw) with { ok:false } for its guard cases, so inspect the result and
      // never claim success on a soft failure.
      const res = await httpsCallable(getFunctions(), "addFriendMutual")({ targetUid });
      const data = (res?.data ?? {}) as { ok?: boolean; already?: boolean; error?: string };
      if (!data.ok) {
        if (data.error === "BLOCKED") {
          return showMessage("You've blocked Brian. Unblock to add them.", "error");
        }
        return showMessage("Couldn't add Brian. Please try again.", "error");
      }

      nameCacheRef.current[targetUid] = targetUsername;

      showMessage("You and Brian are now friends!", "success");
    } catch (e: any) {
      if (__DEV__) console.error("handleAddBrian error", e);
      // Fail soft when the callable isn't deployed yet (or otherwise errors), so
      // the app never crashes and we never claim success on a real failure.
      if (e?.code === "functions/not-found" || e?.code === "not-found") {
        showMessage("Couldn't add Brian yet. Please try again later.", "error");
      } else {
        showMessage("Failed to add Brian.", "error");
      }
    } finally {
      setAddingBrian(false);
    }
  };

  // --- Master "notify all beacons" toggle ---
  const handleToggleNotifyAll = async (nextValue: boolean) => {
    const me = auth.currentUser;
    if (!me || notifyAllBusy) return;

    if (nextValue) {
      // Check notification permissions first
      const perm = await Notifications.getPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          const ok = await confirmAsync(
            "Enable notifications?",
            "Turn on notifications to get alerts when any friend lights a beacon.",
          );
          if (!ok) return;
          const req = await Notifications.requestPermissionsAsync();
          if (!req.granted) {
            Alert.alert("Notifications Off", "You can enable notifications later from this screen.");
            return;
          }
        } else {
          await new Promise<void>((resolve) => {
            Alert.alert(
              "Notifications Off",
              Platform.OS === "ios"
                ? "To enable, open Settings → BeKin → Notifications and turn on Allow Notifications."
                : "To enable, open Settings → Apps → BeKin → Notifications and turn them on.",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve() },
                { text: "Open Settings", onPress: async () => { try { await Linking.openSettings(); } catch {} resolve(); } },
              ]
            );
          });
          return;
        }
      }
      try { await syncPushTokenIfGranted(); } catch {}
      emitNotifyPermissionChange(); // refresh the setup banner's notifications step
    }

    setNotifyAllBusy(true);
    try {
      await setDoc(doc(db, "Profiles", me.uid), { notifyAllBeacons: nextValue, updatedAt: serverTimestamp() }, { merge: true });
      setNotifyAllBeacons(nextValue);
    } catch {
      Alert.alert("Error", "Could not update preference.");
    } finally {
      setNotifyAllBusy(false);
    }
  };

  // --- Notify toggle handler with clean permission flow ---
  const handleToggleNotify = async (friendUid: string, nextValue: boolean) => {
    const me = auth.currentUser;
    if (!me || !friendUid) return;

    if (togglingRef.current.has(friendUid)) return;
    togglingRef.current.add(friendUid);

    try {
      if (nextValue) {
        // 1) Probe current status WITHOUT prompting
        const perm = await Notifications.getPermissionsAsync();
        const grantedNow = !!perm.granted;

        if (!grantedNow) {
          if (perm.canAskAgain) {
            // 2) Ask in-app first
            const ok = await confirmAsync(
              "Enable notifications?",
              "Turn on notifications to get alerts when this friend lights a beacon. You will not receive any other notifications from Bekin. If you decline the following prompt, you have to go into settings to turn on notifications.",
            );
            if (!ok) return; // user declined our in-app ask

            // 3) Trigger the iOS system prompt
            const req = await Notifications.requestPermissionsAsync();
            if (!req.granted) {
              Alert.alert("Notifications Off", "You can enable notifications later from this screen.");
              return;
            }
          } else {
            // Already denied at OS level; iOS will not show the system prompt again.
            // Keep everything in‑app (no Settings deep-link). Inform the user and stop.
            await new Promise<void>((resolve) => {
              Alert.alert(
                "Notifications Off",
                Platform.OS === "ios"
                  ? "To enable, open Settings → BeKin → Notifications and turn on Allow Notifications."
                  : "To enable, open Settings → Apps → BeKin → Notifications and turn them on.",
                [
                  { text: "Cancel", style: "cancel", onPress: () => resolve() },
                  {
                    text: "Open Settings",
                    onPress: async () => {
                      try {
                        await Linking.openSettings();
                      } catch {}
                      resolve();
                    },
                  },
                ]
              );
            });
            return;
          }
        }

        // 4) We have permission now, BEST‑EFFORT token sync (do not block on failure)
        try {
          await syncPushTokenIfGranted();
        } catch (e) {
          if (__DEV__) console.warn("syncPushTokenIfGranted failed (best‑effort)", e);
        }
        emitNotifyPermissionChange(); // refresh the setup banner's notifications step

        // 5) Persist ON + subscribe
        await setDoc(
          doc(db, "users", me.uid, "friends", friendUid),
          { notify: true, updatedAt: serverTimestamp() },
          { merge: true }
        );
        try {
          await subscribeToFriendNotifications(friendUid);
        } catch (e) {
          // Non-fatal: backend fanout also honors users/{uid}/friends/{friendUid}.notify===true
          if (__DEV__) console.warn("subscribeToFriendNotifications failed (best‑effort)", e);
        }
        setNotifyByUid((prev) => ({ ...prev, [friendUid]: true }));
      } else {
        // Turning OFF: optimistic local OFF, persist, and try to unsubscribe.
        const prevVal = notifyByUid[friendUid];
        setNotifyByUid((prev) => ({ ...prev, [friendUid]: false }));

        try {
          // Persist OFF first
          await setDoc(
            doc(db, "users", me.uid, "friends", friendUid),
            { notify: false, updatedAt: serverTimestamp() },
            { merge: true }
          );
        } catch (e) {
          // If write failed, roll back UI and surface error
          setNotifyByUid((prev) => ({ ...prev, [friendUid]: prevVal }));
          throw e;
        }

        // Best-effort unsubscribe of the subscription doc; do not block or roll back UI
        try {
          await unsubscribeFromFriendNotifications(friendUid);
        } catch (e) {
          if (__DEV__) console.warn("unsubscribeFromFriendNotifications failed (best‑effort)", e);
        }
      }
    } catch (e: any) {
      if (__DEV__) console.error("onToggleNotify failed", e);
      showMessage(e?.message || "Couldn't update notifications.", "error");
    } finally {
      togglingRef.current.delete(friendUid);
    }
  };

  // Show the "add your first friend" card to anyone with no friend yet (until dismissed this session).
  const friendStepDone = !!onboarding.steps.find((s) => s.key === "friend")?.done;
  const showSetupCard = onboarding.loaded && !friendStepDone && !setupCardDismissed;

  // ----- PAGE SCROLLER: One FlatList for the entire screen -----
  if (!profileLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tc.bg }}>
        <ActivityIndicator color={tc.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tc.bg }}>
      <FlatList
        ref={listRef}
        data={visibleFriends}
        keyExtractor={(item, index) =>
          item.uid ? `uid:${item.uid}` : `name:${item.username.toLowerCase()}:${index}`
        }
        renderItem={({ item }) => (
          <FriendsList.Row
            item={item}
            busy={busy}
            onRemove={() => confirmRemove(item)}
            onBlock={() => confirmBlock(item)}
            notify={!!(item.uid && notifyByUid[item.uid])}
            onToggleNotify={(v) => {
              if (!item.uid) return;
              handleToggleNotify(item.uid, v);
            }}
            onPressName={item.username ? () => { tap(); router.push(`/profile/${item.username}`); } : undefined}
            onDoubleTap={item.username ? () => { tap(); router.push(`/profile/${item.username}`); } : undefined}
            notifyDisabled={notifyAllBeacons}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            {showSetupCard ? (
              <FriendsSetupCard onNext={setupHelpNext} onDismiss={() => setSetupCardDismissed(true)} />
            ) : (
              <TutorialResumeBanner
                visible={onboarding.loaded && !onboarding.allDone && !tourActive}
                doneCount={onboarding.doneCount}
                total={onboarding.total}
                nextLabel={onboarding.firstIncomplete?.label}
                onPress={() => {
                  const inc = onboarding.firstIncomplete;
                  // Already on Friends: the "add a friend" step re-opens the (dismissed) help card in
                  // place rather than bouncing through a locked coach-mark.
                  if (inc?.key === "friend") { setSetupCardDismissed(false); return; }
                  router.push(inc ? `/home?tutorial=1&tourTarget=${inc.target}` : "/home?tutorial=1");
                }}
              />
            )}
            <Text style={[styles.header, { color: tc.text }]}>Friends</Text>

            {/* Username + Invite. Its tour targets (friends-username / friends-profile / friends-add)
                are registered inside the component. */}
            <FriendsProfileAndInvite
              currentUsername={currentUsername}
              usernameInput={usernameInput}
              onChangeUsername={setUsernameInput}
              onSaveUsername={handleSetUsername}
              busyUsername={busyUsername}
              displayName={profile?.displayName || null}
              onPressDisplayName={() => { if (currentUsername) { tap(); router.push(`/profile/${currentUsername}?editDisplayName=1`); } }}
              nameInput={name}
              onChangeName={setName}
              hasProfileUsername={!!currentUsername?.trim()}
              onSendRequest={handleAddFriend}
              busySend={busy}
              inviteCode={inviteCode ?? profile?.inviteCode ?? null}
              onShareInvite={handleShareInvite}
              message={message}
            />

            {/* My Friend Groups */}
            <View ref={groupsTarget} collapsable={false} style={[styles.card, { backgroundColor: tc.card, shadowColor: tc.dark }]}>
              <View style={styles.groupsHeaderRow}>
                <Text style={[styles.sectionTitle, { color: tc.text }]}>My Friend Groups</Text>
                <Pressable onPress={() => { tap(); setEditingGroup(null); setGroupEditorOpen(true); }} hitSlop={10} style={[styles.plusBtn, { backgroundColor: tc.primary }]}>
                  <Text style={styles.plusBtnText}>＋</Text>
                </Pressable>
              </View>

              {groups.length === 0 ? (
                <Text style={[styles.subtle, { color: tc.subtle }]}>
                  {online ? "No groups yet. Tap + to create one." : "Can't load groups. No internet connection."}
                </Text>
              ) : (
                <View style={{ rowGap: 8 }}>
                  {groups.map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => { tap(); setEditingGroup(g); setGroupEditorOpen(true); }}
                      style={[styles.groupRow, { borderColor: tc.border, backgroundColor: tc.card }]}
                    >
                      <View style={[styles.groupAvatar, { backgroundColor: tc.primary }]}>
                        <Text style={{ color: "#fff", fontWeight: "800" }}>
                          {g.name?.[0]?.toUpperCase() || "G"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.groupName, { color: tc.text }]}>{g.name}</Text>
                        <Text style={[styles.groupMeta, { color: tc.subtle }]}>
                          {(g.memberUids?.length ?? 0)} member{(g.memberUids?.length ?? 0) === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <Text style={[styles.groupEditHint, { color: tc.primary }]}>Edit</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Requests + friends list, wrapped so the tour highlights them as one step (friends-requests). */}
            <View ref={requestsListTarget} collapsable={false}>
            {/* Requests */}
            <FriendRequestsSection
              incoming={visibleIncoming}
              outgoing={outgoing}
              busy={busy}
              onAccept={acceptRequest}
              onReject={rejectRequest}
              onCancel={cancelRequest}
            />

            {/* Friends section title */}
            <View style={[styles.card, { marginBottom: 0, backgroundColor: tc.card, shadowColor: tc.dark }]}>
              <Text style={[styles.sectionTitle, { color: tc.text }]}>My Friends</Text>

              {/* Master notify-all toggle */}
              <View style={styles.notifyAllRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.notifyAllLabel, { color: tc.text }]}>Beacon notifications from all friends</Text>
                </View>
                <Switch
                  value={notifyAllBeacons}
                  onValueChange={handleToggleNotifyAll}
                  disabled={notifyAllBusy}
                  trackColor={{ false: tc.border, true: tc.primary }}
                  thumbColor="#fff"
                />
              </View>
              {visibleFriends.length === 0 && (
                online ? (
                  <>
                    <Text style={[styles.subtle, { color: tc.subtle }]}>No friends yet. Search for a username above to send a request.</Text>

                    {/* First-friend suggestion */}
                    <View ref={brianTarget} collapsable={false} style={[styles.brianCard, { borderColor: tc.primary, backgroundColor: tc.inputBg }]}>
                      <View style={[styles.brianAvatar, { backgroundColor: tc.primary }]}>
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>B</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.brianTitle, { color: tc.text }]}>New here? Add Brian, the creator of BeKin, as your first friend!</Text>
                      </View>
                      <Pressable
                        onPress={handleAddBrian}
                        disabled={addingBrian || busy}
                        style={[styles.brianBtn, { backgroundColor: tc.primary }, (addingBrian || busy) && { opacity: 0.6 }]}
                      >
                        {addingBrian ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.brianBtnText}>Add</Text>
                        )}
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Text style={[styles.subtle, { color: tc.subtle }]}>
                    Can&apos;t load friends. No internet connection.
                  </Text>
                )
              )}
            </View>
            </View>
          </View>
        }
        ListFooterComponent={<View ref={listEndTarget} collapsable={false} style={{ height: 16 }} />}
        contentContainerStyle={{
          padding: SCREEN_PAD,
          paddingTop: 70,
          paddingBottom: BOTTOM_BAR_SPACE, // ✅ ensures the last row clears BottomBar
          rowGap: 14,
        }}
        style={{ flex: 1 }}
        // The tour drives positioning while it's active (see the effect above); hand-scrolling
        // under the spotlight just slid content out of the ring and looked broken.
        scrollEnabled={!tourActive}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
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
        onSaved={() => showMessage(editingGroup ? "Group updated!" : "Group created!", "success")}
        onDeleted={() => showMessage("Group deleted.", "success")}
      />
      <BottomBar />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { rowGap: 14 },
  header: { fontSize: 28, fontWeight: "800", color: colors.text, textAlign: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000", // overridden inline with tc.dark
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8, color: colors.text },
  notifyAllRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 8,
  },
  notifyAllLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
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

  // "Add Brian" first-friend card
  brianCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  brianAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brianTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    lineHeight: 20,
  },
  brianBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  brianBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});