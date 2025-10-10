// app/providers/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../firebase.config";

type AuthCtx = {
  user: User | null;
  initialized: boolean;
};

const AuthContext = createContext<AuthCtx>({ user: null, initialized: false });

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!mounted) return;
      setUser(u ?? null);
      setInitialized(true);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const value = useMemo(() => ({ user, initialized }), [user, initialized]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);