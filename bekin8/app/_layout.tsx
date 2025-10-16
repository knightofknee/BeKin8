// app/_layout.tsx
import React, { useEffect } from "react";
import { Slot, usePathname, useRouter, useRootNavigationState } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Routes that are accessible when NOT signed in */
const PUBLIC_ROUTES = new Set<string>([
  "/",            // login
  "/signup",      // create account
  "/forgot-password",
  "/privacy",
  "/legal",
]);

function Gate() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const navState = useRootNavigationState(); // ✅ tells us when navigation is mounted

  useEffect(() => {
    // wait until auth is known AND the navigator is mounted
    if (!initialized || !navState?.key) return;

    if (user) {
      if (pathname === "/" || pathname === "/signup") {
        router.replace("/home");
      }
    } else {
      if (!PUBLIC_ROUTES.has(pathname)) {
        router.replace("/");
      }
    }

    // hide splash only once we can safely render/navigate
    SplashScreen.hideAsync().catch(() => {});
  }, [initialized, navState?.key, user, pathname, router]);

  if (!initialized || !navState?.key) {
    // keep a white background so there’s no black flash
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // keep a white root background; transitions still come from your screens
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Gate />
      </View>
    </AuthProvider>
  );
}