// app/_layout.tsx
import React, { useEffect, useRef } from "react";
import { Stack, usePathname, useRouter, useRootNavigationState } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";

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
  const { colors } = useTheme();
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

  // --- Notification deep linking ---
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (!initialized || !navState?.key || !user) return;

    const routeForNotification = (data: Record<string, any> | undefined) => {
      if (!data?.type) return;
      const t = String(data.type);
      if ((t === "beacon" || t === "beacon_comment") && data.beaconId) {
        router.push(`/home?beaconId=${data.beaconId}`);
      } else if ((t === "post_comment" || t === "new_post") && data.postId) {
        router.push(`/feed?postId=${data.postId}`);
      }
    };

    // Handle tap while app is running (foreground / background)
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeForNotification(response.notification.request.content.data);
    });

    // Handle cold start (app was killed, user tapped notification to launch)
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) routeForNotification(response.notification.request.content.data);
      });
    }

    return () => sub.remove();
  }, [initialized, navState?.key, user, router]);

  if (!initialized || !navState?.key) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Gate />
      </ThemeProvider>
    </AuthProvider>
  );
}
