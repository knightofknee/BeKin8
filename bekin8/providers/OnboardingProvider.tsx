// providers/OnboardingProvider.tsx
// Tracks the "base setup" the user must finish to actually get value from BeKin: pick a username,
// add a friend, and turn on notifications. Drives the resume banner (which persists until all three
// are done — independent of whether the tour was watched) and tells it where to jump.
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
  const [notifChecked, setNotifChecked] = useState(false);

  // Friend count from accepted FriendEdges — the same canonical source the Friends screen and the
  // tour's add-brian gate use (symmetric: both parties appear in `uids`). Errors resolve to "none".
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setHasFriend(false);
      setFriendLoaded(false);
      return;
    }
    const qEdges = query(
      collection(db, "FriendEdges"),
      where("uids", "array-contains", uid),
      where("state", "==", "accepted")
    );
    const unsub = onSnapshot(
      qEdges,
      (snap) => {
        setHasFriend(snap.size > 0);
        setFriendLoaded(true);
      },
      () => {
        setHasFriend(false);
        setFriendLoaded(true);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // OS notification permission — re-checked on mount, on user change, and whenever the app returns
  // to the foreground (so returning from iOS Settings clears the step). `refresh` covers the
  // in-app enable, which on iOS shows a modal that doesn't fire an AppState change.
  const checkNotif = useCallback(async () => {
    try {
      const perm = await Notifications.getPermissionsAsync();
      setNotifGranted(!!perm.granted);
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
    { key: "friend", label: "Add a friend", done: hasFriend, target: "add-brian" },
    { key: "notifications", label: "Turn on notifications", done: notifGranted, target: "settings-notifications" },
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
