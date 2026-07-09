// components/VerifyEmailGate.tsx
// Rendered ONCE at the root (inside AuthProvider/ThemeProvider, above the router stack).
// Deferred email verification UX for email/password accounts created after the epoch:
//   grace period -> slim dismissible banner near the top (non-blocking)
//   past deadline -> full-screen blocking overlay until verified (or sign out)
// Renders NOTHING for SSO-only users, verified users, pre-epoch users, and signed-out state.
// No animation on purpose (reduced-motion-safe).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../firebase.config";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { needsVerification, isGated, daysLeft, resendVerification } from "../lib/emailVerification";
import { logout } from "../lib/logout";

// Banner dismissal is per-session per-user (no persistence). Module-level so a remount of the
// gate (e.g. theme change re-render tree churn) doesn't resurrect a dismissed banner.
let dismissedForUid: string | null = null;

// Poll fast only while the hard gate overlay blocks the app; during the grace period the
// AppState-foreground re-check carries the unblock, so the interval backs off to save battery/data.
const GATED_POLL_MS = 20_000;
const GRACE_POLL_MS = 60_000;
const NOTE_CLEAR_MS = 3_000;

export default function VerifyEmailGate() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // user.reload() mutates the User object in place (same reference), so a manual tick forces
  // re-evaluation of needsVerification/isGated after each reload.
  const [, setTick] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Brief feedback for the resend / verify-check actions ('Sent', 'Wait 42s', ...).
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNote = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_CLEAR_MS);
  }, []);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  const relevant = needsVerification(user);
  const gated = isGated(user);

  const reloadAndCheck = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    try {
      await u.reload();
    } catch {
      // Offline or transient error: keep current state, next poll/foreground retries.
    }
    setTick((t) => t + 1);
  }, []);

  // While verification is pending, re-check on foreground so verifying in the mail app then
  // returning to BeKin unblocks without manual steps. The background interval polls fast only
  // while gated; during the grace period it backs off (foreground re-check does the work).
  // Mounted only while needed.
  useEffect(() => {
    if (!relevant) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") reloadAndCheck();
    });
    const interval = setInterval(reloadAndCheck, gated ? GATED_POLL_MS : GRACE_POLL_MS);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [relevant, gated, reloadAndCheck]);

  const handleResend = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) return;
    const res = await resendVerification(u);
    showNote(res.ok ? "Sent" : res.waitSeconds ? `Wait ${res.waitSeconds}s` : "Send failed");
  }, [showNote]);

  const handleVerifiedCheck = useCallback(async () => {
    await reloadAndCheck();
    if (auth.currentUser && !auth.currentUser.emailVerified) showNote("Not verified yet");
  }, [reloadAndCheck, showNote]);

  const handleSignOut = useCallback(async () => {
    try {
      // Drop this device's push token first, then sign out, so a later account on this
      // device does not double-register and inherit the prior account's notifications.
      // _layout.tsx sees user=null and routes to "/".
      await logout();
    } catch {
      // ignore; auth listener handles state either way
    }
  }, []);

  if (!user || !relevant) return null;

  // ---- Hard gate: full-screen blocking overlay ----
  if (gated) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.bg }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="mail-unread-outline" size={40} color={colors.primary} style={styles.cardIcon} />
          <Text style={[styles.title, { color: colors.text }]}>Verify your email</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>
            To keep using BeKin, please verify the email address on your account. Check your inbox
            (and spam folder) for the verification link we sent to:
          </Text>
          <Text style={[styles.email, { color: colors.text }]}>{user.email ?? "your email"}</Text>
          {note ? <Text style={[styles.note, { color: colors.primary }]}>{note}</Text> : null}
          <Pressable
            onPress={handleResend}
            accessibilityRole="button"
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.buttonText}>Resend email</Text>
          </Pressable>
          <Pressable
            onPress={handleVerifiedCheck}
            accessibilityRole="button"
            style={[styles.button, styles.buttonOutline, { borderColor: colors.primary }]}
          >
            <Text style={[styles.buttonText, { color: colors.primary }]}>I have verified</Text>
          </Pressable>
          <Pressable onPress={handleSignOut} accessibilityRole="button" style={styles.signOut}>
            <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Grace period: slim dismissible banner ----
  if (dismissed || dismissedForUid === user.uid) return null;
  const n = daysLeft(user);
  return (
    <View
      style={[
        styles.banner,
        { top: insets.top + 6, backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Ionicons name="mail-unread-outline" size={18} color={colors.primary} />
      <Text style={[styles.bannerText, { color: colors.text }]} numberOfLines={2}>
        {`Verify your email: check your inbox. ${n} ${n === 1 ? "day" : "days"} left.`}
      </Text>
      <Pressable onPress={handleResend} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.bannerAction, { color: colors.primary }]}>{note ?? "Resend"}</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          dismissedForUid = user.uid;
          setDismissed(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss verification reminder"
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color={colors.subtle} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Overlay sits above the router stack; OfflineBanner (zIndex 9999) stays above it.
  overlay: {
    zIndex: 9990,
    elevation: 9990,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  cardIcon: { marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  email: { fontSize: 15, fontWeight: "700", marginTop: 8, marginBottom: 4, textAlign: "center" },
  note: { fontSize: 13, fontWeight: "700", marginTop: 6 },
  button: {
    alignSelf: "stretch",
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1.5, marginTop: 10 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  signOut: { marginTop: 16, padding: 4 },
  signOutText: { fontSize: 14, fontWeight: "700" },
  banner: {
    position: "absolute",
    left: 10,
    right: 10,
    zIndex: 9980,
    elevation: 9980,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  bannerAction: { fontSize: 13, fontWeight: "800" },
});
