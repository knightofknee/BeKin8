// components/UpdateModal.tsx
// Root-mounted nudge shown when the installed binary is behind the App Store version.
// App Store updates aren't actually automatic for everyone (auto-update can be off or
// delayed), and the goal is getting fixes to active users fast: so this checks at launch
// AND on every app foreground (throttled), not just at cold start. iOS apps stay resident
// for days; waiting for a cold start would add days on top of Apple review.
//
// Purely a suggestion: Update deep-links to the store listing, Close dismisses that store
// version for the rest of the session (a later, newer release re-prompts). The Update
// button is deliberately the loudest element on the card.
import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";
import { useTour } from "../providers/TourProvider";
import { checkForAppUpdate, type AppUpdateInfo } from "../lib/appUpdate";

// Minimum gap between store checks. Foreground events fire constantly during normal use;
// one check per half hour keeps the prompt near-immediate once a release propagates
// without hammering the lookup API.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function UpdateModal() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isActive: tourActive } = useTour();
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const dismissedVersionRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    let unmounted = false;

    async function runCheck() {
      if (Date.now() - lastCheckRef.current < CHECK_INTERVAL_MS) return;
      lastCheckRef.current = Date.now();
      const result = await checkForAppUpdate();
      if (unmounted || !result) return;
      if (result.storeVersion === dismissedVersionRef.current) return;
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
    if (info) Linking.openURL(info.storeUrl).catch(() => {});
  }

  function dismiss() {
    if (info) dismissedVersionRef.current = info.storeVersion;
    setInfo(null);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={styles.emoji}>⬆️</Text>
          <Text style={[styles.title, { color: colors.text }]}>Update available</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>
            A newer version of BeKin (v{info.storeVersion}) is on the App Store. Update now to get
            the latest fixes and features.
          </Text>
          <Pressable
            onPress={openStore}
            style={({ pressed }) => [
              styles.updateBtn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Update on the App Store"
          >
            <Text style={styles.updateBtnTxt}>Update</Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <Text style={[styles.closeBtnTxt, { color: colors.subtle }]}>Close</Text>
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
