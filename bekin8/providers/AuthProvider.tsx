// providers/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";

export type UserProfile = {
  username: string;
  displayName: string;
  commentsEnabled: boolean;
};

type AuthCtx = {
  user: User | null;
  initialized: boolean;
  profile: UserProfile | null;      // null = not yet loaded
  profileLoaded: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => void; // optimistic local update
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  initialized: false,
  profile: null,
  profileLoaded: false,
  refreshProfile: async () => {},
  updateProfile: () => {},
});

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser]               = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [profile, setProfile]         = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const parseProfile = (data: any): UserProfile => ({
    username:        (typeof data?.username    === "string" ? data.username.trim()    : ""),
    displayName:     (typeof data?.displayName === "string" ? data.displayName.trim() : ""),
    commentsEnabled: data?.commentsEnabled === true,
  });

  const refreshProfile = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const snap = await getDoc(doc(db, "Profiles", uid));
    setProfile(snap.exists() ? parseProfile(snap.data()) : { username: "", displayName: "", commentsEnabled: false });
    setProfileLoaded(true);
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile((prev) => prev ? { ...prev, ...patch } : prev);
  }, []);

  // Auth listener
  useEffect(() => {
    let mounted = true;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!mounted) return;
      setUser(u ?? null);
      setInitialized(true);
      if (!u) {
        // signed out — clear profile
        setProfile(null);
        setProfileLoaded(false);
      }
    });
    return () => { mounted = false; unsub(); };
  }, []);

  // Profile listener — subscribe once we have a user
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, "Profiles", user.uid),
      (snap) => {
        setProfile(snap.exists() ? parseProfile(snap.data()) : { username: "", displayName: "", commentsEnabled: false });
        setProfileLoaded(true);
      },
      () => setProfileLoaded(true) // on error still unblock screens
    );
    return unsub;
  }, [user?.uid]);

  const value = useMemo(
    () => ({ user, initialized, profile, profileLoaded, refreshProfile, updateProfile }),
    [user, initialized, profile, profileLoaded, refreshProfile, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
