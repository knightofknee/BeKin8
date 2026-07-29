// components/UpdateRequiredGate.tsx
// Rendered ONCE at the root, alongside VerifyEmailGate. Shows a full-screen blocking overlay when
// the running build is older than Config/app.minVersion.
//
// Renders NOTHING in the normal case, and nothing at all when the config is missing, unreadable, or
// disabled: see lib/updateGate.ts for why every unknown fails OPEN. A gate that can brick every
// install on a bad config value is worse than the problem it solves.
//
// Deliberately NOT tied to auth state: an out-of-date build is out of date on the sign-in screen
// too, and the config read does not require a signed-in user.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { fetchUpdateGate, currentAppVersion, type UpdateGateConfig } from '../lib/updateGate';

export default function UpdateRequiredGate() {
  const { colors } = useTheme();
  const [gate, setGate] = useState<UpdateGateConfig | null>(null);
  const [opening, setOpening] = useState(false);

  const check = useCallback(async () => {
    setGate(await fetchUpdateGate());
  }, []);

  useEffect(() => {
    check();
    // Re-check on foreground so the overlay clears itself once the user has updated and come back,
    // without needing a cold start.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  // Null unless Config/app has `required: true`. Everyday "new version available" nudging is
  // UpdateModal's job; this is only the un-dismissible block.
  if (!gate) return null;

  const openStore = async () => {
    if (!gate.storeUrl) return;
    setOpening(true);
    try {
      await Linking.openURL(gate.storeUrl);
    } catch {
      // Nothing useful to do: the user can still update from the store manually.
    } finally {
      setOpening(false);
    }
  };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>Update required</Text>
        <Text style={[styles.body, { color: colors.subtle }]}>{gate.message}</Text>
        <Text style={[styles.version, { color: colors.subtle }]}>
          You have {currentAppVersion() || 'an older version'}. Version {gate.minVersion} or newer is
          required.
        </Text>

        {gate.storeUrl ? (
          <Pressable
            onPress={openStore}
            disabled={opening}
            accessibilityRole="button"
            accessibilityLabel="Update BeKin"
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.88 },
              opening && { opacity: 0.6 },
            ]}
          >
            {opening ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={[styles.btnTxt, { color: colors.bg }]}>Update now</Text>
            )}
          </Pressable>
        ) : (
          // No store URL configured: still block, but tell the user what to do rather than
          // rendering a button that goes nowhere.
          <Text style={[styles.body, { color: colors.subtle }]}>
            Please update BeKin from the App Store to continue.
          </Text>
        )}

        {/* No skip button on purpose: this only renders when the old build is genuinely broken
            against the backend, so there is nothing useful to skip to. */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, justifyContent: 'center', alignItems: 'center' },
  inner: { paddingHorizontal: 28, alignItems: 'center', maxWidth: 420 },
  title: { fontSize: 24, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 10 },
  version: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 22 },
  btn: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, minWidth: 180, alignItems: 'center' },
  btnTxt: { fontSize: 16, fontWeight: '700' },
});
