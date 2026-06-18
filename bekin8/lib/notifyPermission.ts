// lib/notifyPermission.ts
// Single source of truth for requesting OS notification permission. Prompts when it can
// still be asked, and deep-links to system Settings when it was permanently denied.
// Used by settings toggles, the notifications screen, and the onboarding tutorial.
import { Alert, Platform, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import { syncPushTokenIfGranted } from "./push";

// Lightweight pub/sub so anything that flips OS notification permission can notify interested
// listeners (e.g. the onboarding banner). The iOS permission prompt is a modal that does NOT fire
// an AppState change, so an explicit signal is the only way to refresh derived state promptly.
const permissionListeners = new Set<() => void>();
export function onNotifyPermissionChange(cb: () => void): () => void {
  permissionListeners.add(cb);
  return () => {
    permissionListeners.delete(cb);
  };
}
export function emitNotifyPermissionChange(): void {
  permissionListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

/** Returns true if notifications are (or become) granted. Shows the OS prompt if needed. */
export async function ensureNotifyPermission(
  reason: string = "Turn on notifications to get alerts for beacons, comments, and requests."
): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  if (perm.granted) return true;

  if (perm.canAskAgain) {
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert("Enable notifications?", reason, [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Allow", onPress: () => resolve(true) },
      ])
    );
    if (!ok) return false;
    const req = await Notifications.requestPermissionsAsync();
    if (!req.granted) {
      Alert.alert("Notifications Off", "You can enable them later from Settings.");
      return false;
    }
    try {
      await syncPushTokenIfGranted();
    } catch {
      /* ignore */
    }
    emitNotifyPermissionChange();
    return true;
  }

  // Already permanently denied — direct to OS settings.
  await new Promise<void>((resolve) =>
    Alert.alert(
      "Notifications Off",
      Platform.OS === "ios"
        ? "Open Settings → BeKin → Notifications and turn on Allow Notifications."
        : "Open Settings → Apps → BeKin → Notifications and turn them on.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve() },
        {
          text: "Open Settings",
          onPress: async () => {
            try {
              await Linking.openSettings();
            } catch {
              /* ignore */
            }
            resolve();
          },
        },
      ]
    )
  );
  return false;
}
