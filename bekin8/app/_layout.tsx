// app/_layout.tsx
import React, { useEffect } from "react";
import { Slot, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "../providers/AuthProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Routes that are accessible when NOT signed in */
const PUBLIC_ROUTES = new Set<string>([
  "/",        // login
  "/signup",  // create account
  // add others if needed: "/forgot-password", "/privacy", "/legal",
]);

function Gate() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!initialized) return;

    if (user) {
      if (pathname === "/" || pathname === "/signup") {
        router.replace("/home");
      }
    } else {
      if (!PUBLIC_ROUTES.has(pathname)) {
        router.replace("/");
      }
    }

    SplashScreen.hideAsync().catch(() => {});
  }, [initialized, user, pathname]);

  if (!initialized) {
    // ✅ White background while loading so no black flash
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    // ✅ Force white behind every screen but keep your existing transitions
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <Slot />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      {/* ✅ Outer white in case Gate ever renders nothing briefly */}
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Gate />
      </View>
    </AuthProvider>
  );
}