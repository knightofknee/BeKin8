// app/_layout.tsx
import React, { useEffect, useRef } from "react";
import { Stack, usePathname, useRouter, useRootNavigationState } from "expo-router";
import { ActivityIndicator, Alert, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
import { NetworkProvider, useOnline } from "../providers/NetworkProvider";
import { TourProvider } from "../providers/TourProvider";
import { OnboardingProvider } from "../providers/OnboardingProvider";
import OfflineBanner from "../components/OfflineBanner";
import VerifyEmailGate from "../components/VerifyEmailGate";
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
  const online = useOnline();

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
  // The DONE guard latches only on a definitive outcome (success or unrecoverable), so a transient
  // failure stays retryable; a separate IN-FLIGHT guard prevents overlapping runs. Re-runs on
  // auth change and on network recovery (online), so a failed redeem retries without an app restart.
  const redeemDoneRef = useRef(false);
  const redeemInFlightRef = useRef(false);
  useEffect(() => {
    if (!initialized || !navState?.key || !user) return;
    if (redeemDoneRef.current || redeemInFlightRef.current) return;
    redeemInFlightRef.current = true;
    (async () => {
      try {
        const code = await getPendingInvite();
        if (!code) {
          redeemDoneRef.current = true; // nothing pending, done for this session
          return;
        }
        const res = await redeemInviteCode(code);
        if (res.ok) {
          await clearPendingInvite();
          redeemDoneRef.current = true;
          if (!res.already) {
            const who = res.inviterUsername ? `@${res.inviterUsername}` : "your friend";
            Alert.alert("You're connected!", `You and ${who} are now friends on BeKin.`);
          }
        } else if (res.error === "SELF" || res.error === "NOT_FOUND" || res.error === "BAD_CODE") {
          await clearPendingInvite(); // unrecoverable, stop retrying
          redeemDoneRef.current = true;
        }
        // transient errors: leave DONE unlatched + code pending so a later run retries
      } catch {
        // network/other error, leave DONE unlatched + code pending for retry
      } finally {
        redeemInFlightRef.current = false;
      }
    })();
  }, [initialized, navState?.key, user?.uid, online]);

  if (!initialized || !navState?.key) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* contentStyle paints the screen container the theme bg, so a mounting/transitioning route
          never flashes the default WHITE before its own background paints (worst on first mount). */}
      <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: colors.bg } }} />
      {/* Deferred email-verification UX (email/password accounts created after the epoch):
          grace-period banner, then a hard gate overlay that must cover the whole router stack. */}
      <VerifyEmailGate />
      <OfflineBanner />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <NetworkProvider>
          <OnboardingProvider>
            <TourProvider>
              <Gate />
            </TourProvider>
          </OnboardingProvider>
        </NetworkProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
