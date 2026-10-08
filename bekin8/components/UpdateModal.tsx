// components/UpdateModal.tsx
// Root-mounted nudge shown when the installed binary is behind Config/app.latestVersion (iOS)
// or Config/app.androidLatestBuild, a versionCode (Android). See lib/appUpdate.ts for why the
// source of truth is our own config doc, not the store, and why Android counts builds.
// Store updates aren't actually automatic for everyone (auto-update can be off or
// delayed), and the goal is getting fixes to active users fast: so this checks at launch
// AND on every app foreground (throttled), not just at cold start. Apps stay resident
// for days; waiting for a cold start would add days on top of store review.
//
// Purely a suggestion: Update deep-links to the store listing, and either button snoozes
// the nudge for a day (persisted across relaunches; a later, newer release re-prompts
// immediately). One nag per day, but nagging resumes until the user is actually current.
// The Update button is deliberately the loudest element on the card.
import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { useTour } from "../providers/TourProvider";
import {
  checkForAppUpdate,
  isSnoozed,
  loadDismissRecord,
  saveDismissRecord,
  type AppUpdateInfo,
} from "../lib/appUpdate";
import { fetchUpdateGate } from "../lib/updateGate";

// Minimum gap between store checks. Foreground events fire constantly during normal use;
// one check per half hour keeps the prompt near-immediate once a release propagates
// without hammering the lookup API.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function UpdateModal() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isActive: tourActive } = useTour();
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    let unmounted = false;

    async function runCheck() {
      if (Date.now() - lastCheckRef.current < CHECK_INTERVAL_MS) return;
      lastCheckRef.current = Date.now();
      const result = await checkForAppUpdate();
      if (unmounted || !result) return;
      // Below the hard floor UpdateRequiredGate owns the screen. This card is
      // a native Modal and would sit on top of the gate, so it stands aside.
      if (await fetchUpdateGate()) return;
      const dismissed = await loadDismissRecord();
      if (unmounted || isSnoozed(result.latestVersion, dismissed, Date.now())) return;
      setInfo(result);
    }

    runCheck();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") runCheck();
    });
    return () => {
      unmounted = true;
      sub.remove();
    };
  }, []);

  // Hold the card back while signed out or mid-tour: an update nudge must not cover the
  // login screen or a tour spotlight. The check result stays in state, so it surfaces as
  // soon as the gate clears.
  if (!info || !user || tourActive) return null;

  function openStore() {
    if (!info) return;
    // A store visit earns the same day of quiet as Close: whether they update or bail,
    // re-nagging sooner is noise.
    saveDismissRecord(info.latestVersion);
    Linking.openURL(info.storeUrl).catch(() => {});
  }

  function dismiss() {
    if (info) saveDismissRecord(info.latestVersion);
    setInfo(null);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={styles.emoji}>💛</Text>
          <Text style={[styles.title, { color: colors.text }]}>Something new for you</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>
            {info.message ?? 'We made BeKin a little better. Could you update when you get a sec? Thank you!'}
          </Text>
          <Pressable
            onPress={openStore}
            style={({ pressed }) => [
              styles.updateBtn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === "android" ? "Update on Google Play" : "Update on the App Store"}
          >
            <Text style={styles.updateBtnTxt}>Update</Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            hitSlop={8}
          >
            <Text style={[styles.closeBtnTxt, { color: colors.subtle }]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  emoji: { fontSize: 48, lineHeight: 56 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 4 },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 8 },
  // The one action we want taken: full-width, tall, bold, tinted.
  updateBtn: {
    alignSelf: "stretch",
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  updateBtnTxt: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  // Quiet escape hatch, visually subordinate to Update.
  closeBtn: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 16 },
  closeBtnTxt: { fontSize: 14, opacity: 0.7 },
});
