// app/_layout.tsx
import React, { useEffect, useMemo } from "react";
import { Slot, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Routes that are accessible when NOT signed in */
const PUBLIC_ROUTES = new Set<string>([
  "/",          // login
  "/signup",    // create account
  // add others if you have them:
  // "/forgot-password",
  // "/privacy",
  // "/legal",
]);

function Gate() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!initialized) return;

    if (user) {
      // Signed-in users shouldn't sit on login/signup
      if (pathname === "/" || pathname === "/signup") {
        router.replace("/home");
      }
    } else {
      // Signed-out users must stay on public routes
      if (!PUBLIC_ROUTES.has(pathname)) {
        router.replace("/");
      }
    }

    SplashScreen.hideAsync().catch(() => {});
  }, [initialized, user, pathname]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}