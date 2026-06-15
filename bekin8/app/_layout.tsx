// app/_layout.tsx
import React, { useEffect, useRef } from "react";
import { Stack, usePathname, useRouter, useRootNavigationState } from "expo-router";
import { ActivityIndicator, Alert, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
import { NetworkProvider } from "../providers/NetworkProvider";
import OfflineBanner from "../components/OfflineBanner";
import {
  parseInviteCode,
  stashPendingInvite,
  getPendingInvite,
  clearPendingInvite,
  redeemInviteCode,
} from "../lib/inviteLink";

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
      const enc = (v: any) => encodeURIComponent(String(v));
      if ((t === "beacon" || t === "beacon_comment") && data.beaconId) {
        const beaconId = enc(data.beaconId);
        if (t === "beacon_comment" && data.messageId) {
          const messageId = enc(data.messageId);
          router.replace(`/home?beaconId=${beaconId}&messageId=${messageId}`);
        } else {
          router.replace(`/home?beaconId=${beaconId}`);
        }
      } else if (t === "post_comment" && data.postId) {
        const postId = enc(data.postId);
        if (data.commentId) {
          const commentId = enc(data.commentId);
          router.replace(`/feed?postId=${postId}&commentId=${commentId}`);
        } else {
          router.replace(`/feed?postId=${postId}`);
        }
      } else if (t === "new_post" && data.postId) {
        const postId = enc(data.postId);
        router.replace(`/feed?scrollToPostId=${postId}`);
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

  // --- Referral invite deep link ---
  // Capture an incoming invite code from a deep link / Universal Link (works pre-auth) and
  // stash it so it survives signup.
  const incomingUrl = Linking.useURL();
  useEffect(() => {
    const code = parseInviteCode(incomingUrl);
    if (code) stashPendingInvite(code);
  }, [incomingUrl]);

  // Once authenticated, redeem any pending invite into an accepted friendship (server-side).
  const redeemedInviteRef = useRef(false);
  useEffect(() => {
    if (!initialized || !navState?.key || !user) return;
    if (redeemedInviteRef.current) return;
    redeemedInviteRef.current = true;
    (async () => {
      const code = await getPendingInvite();
      if (!code) return;
      try {
        const res = await redeemInviteCode(code);
        if (res.ok) {
          await clearPendingInvite();
          if (!res.already) {
            const who = res.inviterUsername ? `@${res.inviterUsername}` : "your friend";
            Alert.alert("You're connected!", `You and ${who} are now friends on BeKin.`);
          }
        } else if (res.error === "SELF" || res.error === "NOT_FOUND" || res.error === "BAD_CODE") {
          await clearPendingInvite(); // unrecoverable — stop retrying
        }
        // transient errors: keep the pending code to retry on a future launch
      } catch {
        // network/other error — leave pending for next launch
      }
    })();
  }, [initialized, navState?.key, user]);

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
      <OfflineBanner />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NetworkProvider>
          <Gate />
        </NetworkProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
