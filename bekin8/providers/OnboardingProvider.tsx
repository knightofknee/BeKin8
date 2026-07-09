// providers/OnboardingProvider.tsx
// Tracks the "base setup" the user must finish to actually get value from BeKin: pick a username,
// add a friend, and turn on notifications. Drives the resume banner (which persists until all three
// are done, independent of whether the tour was watched) and tells it where to jump.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import * as Notifications from "expo-notifications";
import { db } from "../firebase.config";
import { useAuth } from "./AuthProvider";
import { onNotifyPermissionChange } from "../lib/notifyPermission";

export type OnboardingStepKey = "username" | "friend" | "notifications";

export type OnboardingStep = {
  key: OnboardingStepKey;
  /** Short banner label for the next incomplete step. */
  label: string;
  done: boolean;
  /** Tour target to jump to when the banner is tapped on this step. */
  target: string;
};

type OnboardingCtx = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  /** All required steps complete (only meaningful once `loaded`). */
  allDone: boolean;
  /** The earliest incomplete required step, or null when all are done. */
  firstIncomplete: OnboardingStep | null;
  /** True once username, friend count, and notification permission have all been resolved once. */
  loaded: boolean;
  /** Re-check the OS notification permission (call after an in-app enable attempt). */
  refresh: () => void;
};

const DEFAULT: OnboardingCtx = {
  steps: [],
  doneCount: 0,
  total: 3,
  allDone: false,
  firstIncomplete: null,
  loaded: false,
  refresh: () => {},
};

const Ctx = createContext<OnboardingCtx>(DEFAULT);

export const OnboardingProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, profile, profileLoaded } = useAuth();
  const [hasFriend, setHasFriend] = useState(false);
  const [friendLoaded, setFriendLoaded] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  // True when the OS permission is permanently denied (denied AND can no longer prompt). We treat
  // this as "resolved" so the setup banner can complete instead of dead-ending in an OS-Settings
  // alert the user has already refused.
  const [notifBlocked, setNotifBlocked] = useState(false);
  const [notifChecked, setNotifChecked] = useState(false);

  // "Has a friend" from the SAME two sources the friends list unions in, so an existing user with
  // friends never reads as friendless: FriendEdges (participant) AND the denormalized
  // users/{me}/friends subcollection. A MISSING `state` on an edge = a legacy edge, treated as
  // accepted (matching the server's friendUidsOf); requiring state=='accepted' in the query used to
  // miss those and left real users stuck on "Add a friend". Errors resolve to "none".
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setHasFriend(false);
      setFriendLoaded(false);
      return;
    }
    let edgeCount = 0;
    let subCount = 0;
    let edgeReady = false;
    let subReady = false;
    const apply = () => {
      setHasFriend(edgeCount > 0 || subCount > 0);
      if (edgeReady && subReady) setFriendLoaded(true);
    };
    // array-contains only (no state filter, so no composite index and legacy edges count).
    const unsubEdges = onSnapshot(
      query(collection(db, "FriendEdges"), where("uids", "array-contains", uid)),
      (snap) => {
        let c = 0;
        snap.forEach((d) => {
          const st = (d.data() as any)?.state;
          if (st === "accepted" || st == null) c += 1;
        });
        edgeCount = c;
        edgeReady = true;
        apply();
      },
      () => {
        edgeCount = 0;
        edgeReady = true;
        apply();
      }
    );
    const unsubSub = onSnapshot(
      collection(db, "users", uid, "friends"),
      (snap) => {
        subCount = snap.size;
        subReady = true;
        apply();
      },
      () => {
        subCount = 0;
        subReady = true;
        apply();
      }
    );
    return () => {
      unsubEdges();
      unsubSub();
    };
  }, [user?.uid]);

  // OS notification permission, re-checked on mount, on user change, and whenever the app returns
  // to the foreground (so returning from iOS Settings clears the step). `refresh` covers the
  // in-app enable, which on iOS shows a modal that doesn't fire an AppState change.
  const checkNotif = useCallback(async () => {
    try {
      const perm = await Notifications.getPermissionsAsync();
      setNotifGranted(!!perm.granted);
      setNotifBlocked(!perm.granted && !perm.canAskAgain);
    } catch {
      /* leave previous value */
    } finally {
      setNotifChecked(true);
    }
  }, []);

  useEffect(() => {
    checkNotif();
  }, [checkNotif, user?.uid]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") checkNotif();
    });
    return () => sub.remove();
  }, [checkNotif]);

  // Any in-app permission grant (tour, Settings toggles, per-friend/all-friends notify, the
  // post-beacon prompt) emits this so the banner updates without waiting for a foreground.
  useEffect(() => onNotifyPermissionChange(checkNotif), [checkNotif]);

  const hasUsername = !!profile?.username?.trim();
  const steps: OnboardingStep[] = [
    { key: "username", label: "Pick a username", done: hasUsername, target: "friends-username" },
    { key: "friend", label: "Add a friend", done: hasFriend, target: "friends-requests" },
    { key: "notifications", label: "Turn on notifications", done: notifGranted || notifBlocked, target: "settings-notifications" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const firstIncomplete = steps.find((s) => !s.done) ?? null;
  const loaded = profileLoaded && friendLoaded && notifChecked;
  const allDone = loaded && doneCount === steps.length;

  return (
    <Ctx.Provider
      value={{ steps, doneCount, total: steps.length, allDone, firstIncomplete, loaded, refresh: checkNotif }}
    >
      {children}
    </Ctx.Provider>
  );
};

export const useOnboarding = () => useContext(Ctx);
