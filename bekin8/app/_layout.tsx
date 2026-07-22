// app/_layout.tsx
import React, { useEffect, useRef, useState } from "react";
import { Stack, usePathname, useRouter, useRootNavigationState } from "expo-router";
import { ActivityIndicator, Alert, Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../providers/AuthProvider";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
import { NetworkProvider, useOnline } from "../providers/NetworkProvider";
import { TourProvider } from "../providers/TourProvider";
import { OnboardingProvider } from "../providers/OnboardingProvider";
import OfflineBanner from "../components/OfflineBanner";
import VerifyEmailGate from "../components/VerifyEmailGate";
import FriendCelebration, { type FriendCelebrationVariant } from "../components/FriendCelebration";
import ErrorBoundary, { logClientError } from "../components/ErrorBoundary";
import { getSeen } from "../lib/tutorialFlags";
import {
  parseInviteCode,
  stashPendingInvite,
  getPendingInvite,
  clearPendingInvite,
  redeemInviteCode,
  prefetchMyInviteCode,
  captureInstallReferrerInvite,
  claimDeferredInvites,
} from "../lib/inviteLink";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Global uncaught-JS-error net. Installs once: logs to console + best-effort Firestore,
// then chains to the previous handler so default red-box / crash behavior is preserved.
declare const global: any;
(function installGlobalErrorHandler() {
  const g = global as any;
  if (g.__BEKIN_GLOBAL_ERR_INSTALLED__) return;
  const errorUtils = g.ErrorUtils;
  if (!errorUtils?.setGlobalHandler || !errorUtils?.getGlobalHandler) return;
  g.__BEKIN_GLOBAL_ERR_INSTALLED__ = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    console.error("Uncaught JS error:", error, "isFatal:", isFatal);
    void logClientError(error, isFatal ? "global-fatal" : "global");
    if (typeof previous === "function") previous(error, isFatal);
  });
})();

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
  const { colors, isDark } = useTheme();
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
      // /legal/privacy, /legal/terms, /legal/guidelines are the real routes, so any
      // /legal/* path is public even though the set only lists the "/legal" base.
      if (!PUBLIC_ROUTES.has(pathname) && !pathname.startsWith("/legal")) {
        router.replace("/");
      }
    }

    // hide splash only once we can safely render/navigate
    SplashScreen.hideAsync().catch(() => {});
  }, [initialized, navState?.key, user, pathname, router]);

  // --- Notification deep linking ---
  // Taps are STAGED into state and routed only once auth + the navigator have settled on a real
  // app route. Routing straight from the tap raced the auth redirect on cold start ("/" -> "/home"):
  // two near-simultaneous router.replace calls, and the notification's one (carrying the beaconId)
  // could be dropped, so the app opened but the beacon chat never did.
  const handledColdStart = useRef(false);
  const [pendingNotif, setPendingNotif] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const stage = (data: Record<string, any> | undefined) => {
      if (data?.type) setPendingNotif(data);
    };
    // Tap while the app is running (foreground / background)
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      stage(response.notification.request.content.data);
    });
    // Cold start (app was killed, the tap launched it)
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) stage(response.notification.request.content.data);
      });
    }
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!pendingNotif || !initialized || !navState?.key || !user) return;
    // Still on the auth screens: the signed-in redirect to /home hasn't landed yet. Keep the tap
    // staged; this effect re-runs when pathname changes.
    if (pathname === "/" || pathname === "/signup") return;
    const data = pendingNotif;
    setPendingNotif(null);
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
    } else if (t === "friend_request") {
      router.replace("/friends");
    }
  }, [pendingNotif, initialized, navState?.key, user, pathname, router]);

  // --- Referral invite deep link ---
  // Capture an incoming invite code from a deep link / Universal Link (works pre-auth) and
  // stash it so it survives signup.
  // Declared ahead of the capture effect below, which un-latches it when a fresh code lands.
  const redeemDoneRef = useRef(false);
  const redeemInFlightRef = useRef(false);
  // Link-made friendship celebration (variant 'first' = new user pre-tutorial, 'link' = existing
  // user adding via link; names can be several when a claim-all matched multiple sharers).
  const [celebrate, setCelebrate] = useState<{ names: string[]; variant: FriendCelebrationVariant } | null>(null);

  // Warm my own invite code the moment we know who's signed in, so the Friends screen's
  // "Share friend link" button is live immediately instead of waiting on a cold callable.
  useEffect(() => {
    if (user?.uid) prefetchMyInviteCode(user.uid);
  }, [user?.uid]);

  const incomingUrl = Linking.useURL();
  // Bumped once a fresh incoming code is STORED. A link can arrive while the app is already
  // running, after the redeem pass below latched "done for this session" (nothing was pending at
  // startup); this tick un-latches it and re-runs the pass, and only after the stash write has
  // landed so the pass can't read stale storage.
  const [inviteTick, setInviteTick] = useState(0);
  useEffect(() => {
    const code = parseInviteCode(incomingUrl);
    if (!code) return;
    Promise.resolve(stashPendingInvite(code)).then(() => {
      redeemDoneRef.current = false;
      setInviteTick((t) => t + 1);
    });
  }, [incomingUrl]);

  // Android deferred attribution: on first launch, read the Play Install Referrer (the store
  // carries the invite code through install). A found code is stashed like a tapped link, then the
  // redeem pass below connects the pair the moment the user is signed in/up.
  useEffect(() => {
    captureInstallReferrerInvite().then((found) => {
      if (found) {
        redeemDoneRef.current = false;
        setInviteTick((t) => t + 1);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS deferred attribution: Apple passes nothing through an App Store install, so once per
  // install (after sign-in, and only when no tapped link is already pending) ask the server
  // whether this IP recently visited an invite link. A match auto-friends with NO confirm
  // (product call: minimum new-user friction). Visits serve EVERY install on the network while
  // they live (a group sharing one link all auto-connect); the guards against a wrong match are
  // server-side (2h visit expiry, self-invite filtering), and the celebration screen names who
  // you connected with, so a rare shared-WiFi mismatch is visible and unfriendable.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!initialized || !navState?.key || !user) return;
    const CLAIM_KEY = "@bekin_invite_claim_done";
    (async () => {
      try {
        if (await AsyncStorage.getItem(CLAIM_KEY)) return;
        await AsyncStorage.setItem(CLAIM_KEY, "1"); // one-shot per install, whatever the outcome
        if (await getPendingInvite()) return; // a tapped link already carries the invite
        const invites = await claimDeferredInvites();
        if (!invites.length) return;
        // Redeem every matched sharer directly (idempotent server-side); celebrate the ones that
        // actually created a new friendship.
        const names: string[] = [];
        let created = 0;
        for (const inv of invites) {
          try {
            const res = await redeemInviteCode(inv.code);
            if (res.ok && !res.already) {
              created += 1;
              const n = res.inviterUsername || inv.inviterUsername;
              if (n) names.push(n);
            }
          } catch {
            // one bad code must not sink the rest
          }
        }
        if (created > 0) {
          const tourDone = await getSeen("beacon").catch(() => false);
          setCelebrate({ names, variant: tourDone ? "link" : "first" });
        }
      } catch {
        // best-effort; the re-tap fallback still works
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, navState?.key, user?.uid]);

  // Once authenticated, redeem any pending invite into an accepted friendship (server-side).
  // The DONE guard latches only on a definitive outcome (success or unrecoverable), so a transient
  // failure stays retryable; a separate IN-FLIGHT guard prevents overlapping runs. Re-runs on
  // auth change and on network recovery (online), so a failed redeem retries without an app restart.
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
            // New users (tutorial not completed yet) get the first-friend celebration, then land
            // on the tutorial when they dismiss it. Existing users get the quicker 'link' variant.
            const tourDone = await getSeen("beacon").catch(() => false);
            setCelebrate({ names: res.inviterUsername ? [res.inviterUsername] : [], variant: tourDone ? "link" : "first" });
          }
        } else if (res.error === "SELF") {
          await clearPendingInvite(); // unrecoverable, stop retrying
          redeemDoneRef.current = true;
          Alert.alert(
            "That's your own friend link",
            "Share it with a friend instead; when they tap it, the two of you get connected."
          );
        } else if (res.error === "NOT_FOUND" || res.error === "BAD_CODE") {
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
    // inviteTick: a link that arrives mid-session stashes a fresh code + un-latches DONE above,
    // and this dep makes the redeem pass actually re-run for it (after the stash write landed).
  }, [initialized, navState?.key, user?.uid, online, inviteTick]);

  if (!initialized || !navState?.key) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        {/* StatusBar tracks the app theme app-wide, not just on the login screen. */}
        <StatusBar style={isDark ? "light" : "dark"} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* StatusBar tracks the app theme app-wide, so the in-app dark-mode toggle can't
          leave the bar unreadable on non-login screens. */}
      <StatusBar style={isDark ? "light" : "dark"} />
      {/* ErrorBoundary is the white-screen-of-death guard: a render crash anywhere in the
          router stack shows a friendly fallback instead of a blank screen. */}
      <ErrorBoundary>
        {/* contentStyle paints the screen container the theme bg, so a mounting/transitioning route
            never flashes the default WHITE before its own background paints (worst on first mount). */}
        <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: colors.bg } }} />
        {/* Deferred email-verification UX (email/password accounts created after the epoch):
            grace-period banner, then a hard gate overlay that must cover the whole router stack. */}
        <VerifyEmailGate />
        <OfflineBanner />
        {/* Link-made friendship celebration: a Modal, so it covers the tutorial overlay too; for a
            new user, dismissing it lands them on the tutorial's first step. */}
        <FriendCelebration
          visible={!!celebrate}
          friendNames={celebrate?.names ?? []}
          variant={celebrate?.variant ?? "first"}
          onDone={() => setCelebrate(null)}
        />
      </ErrorBoundary>
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
