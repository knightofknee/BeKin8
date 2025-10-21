// ./lib/push.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { auth, db } from "../firebase.config";
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

/**
 * NOTES:
 * - Canonical write: users/{uid}/pushTokens/{installationId} { token, platform, ... }
 * - Legacy mirrors (for current Functions/queries): users/{uid}.expoPushToken and Profiles/{uid}.expoPushToken
 * - EXTRA legacy mirror for older data: users/{uid}.pushToken (temporary until server is fully normalized)
 */

// --- Public API ---
/**
 * Call this once on app start (after React mounts).
 * - Sets foreground behavior.
 * - Ensures Android has a default notification channel so alerts show reliably.
 */
export async function initNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, // show alerts even in foreground on iOS
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Android requires a channel for heads-up alerts with sound.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
    });
  }
}

/**
 * Ensures permission is granted and a push token for this installation is saved
 * under the signed-in user. Returns { granted, token }.
 * If user denies, no token is created/saved.
 */
export async function ensurePushPermissionsAndToken(): Promise<{
  granted: boolean;
  token?: string;
}> {
  if (!Device.isDevice) {
    return { granted: false }; // iOS simulator never receives push
  }

  // 1) Check current status
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  // 2) If not granted, ask now (contextual prompt)
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (status !== "granted") {
    return { granted: false };
  }

  // 3) We have permission — get / save token
  const token = await getExpoPushToken();
  const user = auth.currentUser;
  if (user && token) {
    const installationId = await getInstallationId();

    // 1) Canonical: per-installation token (multi-device safe)
    await setDoc(
      doc(db, "users", user.uid, "pushTokens", installationId),
      {
        token,
        platform: Platform.OS,
        installationId,
        updatedAt: serverTimestamp(),
        appVersion: Constants.expoConfig?.version ?? null,
        build:
          (Platform.OS === "ios"
            ? Constants.expoConfig?.ios?.buildNumber
            : Constants.expoConfig?.android?.versionCode) ?? null,
      },
      { merge: true }
    );

    // 2) Legacy/back-compat single-token fields so existing Functions can find it
    await setDoc(
      doc(db, "Profiles", user.uid),
      {
        expoPushToken: token,
        expoPlatform: Platform.OS,
        expoUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await setDoc(
      doc(db, "users", user.uid),
      {
        // modern legacy mirror (preferred)
        expoPushToken: token,
        expoPlatform: Platform.OS,
        expoUpdatedAt: serverTimestamp(),

        // ultra-legacy mirror (temporary; covers old queries that expect `pushToken`)
        pushToken: token,
      },
      { merge: true }
    );
  }

  return { granted: true, token };
}

/**
 * Clean up this device's token on logout (optional but recommended).
 */
export async function removePushTokenForThisDevice(uid?: string) {
  const userId = uid ?? auth.currentUser?.uid;
  if (!userId) return;
  const installationId = await getInstallationId();
  await deleteDoc(doc(db, "users", userId, "pushTokens", installationId));
}

/**
 * Subscribe the current user to a friend's notifications by friendUid.
 * Only call this after ensurePushPermissionsAndToken returns granted=true.
 */
export async function subscribeToFriendNotifications(friendUid: string) {
  const user = auth.currentUser;
  if (!user) return;
  await setDoc(
    doc(db, "users", user.uid, "friendSubscriptions", friendUid),
    {
      enabled: true,
      friendUid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function unsubscribeFromFriendNotifications(friendUid: string) {
  const user = auth.currentUser;
  if (!user) return;
  await setDoc(
    doc(db, "users", user.uid, "friendSubscriptions", friendUid),
    {
      enabled: false,
      friendUid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// --- Internals ---

async function getExpoPushToken(): Promise<string | undefined> {
  // Since SDK 49+, supplying projectId is safest for EAS builds.
  // It auto-resolves for classic projects; otherwise add your EAS projectId to app config if needed.

  // Prefer EAS projectId when available (dev client / production builds)
  const projectId: string | undefined =
    // SDK 50+: easConfig is the canonical place
    (Constants as any).easConfig?.projectId ??
    // common pattern for passing via extra
    Constants.expoConfig?.extra?.eas?.projectId ??
    // fallback best effort (classic)
    (Constants.expoConfig?.owner && Constants.expoConfig?.slug
      ? `${Constants.expoConfig.owner}/${Constants.expoConfig.slug}`
      : undefined);

  const tok = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return tok.data;
}

async function getInstallationId(): Promise<string> {
  const KEY = "installationId";
  let val = await SecureStore.getItemAsync(KEY);
  if (val) return val;
  // lightweight UUID-ish
  val = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await SecureStore.setItemAsync(KEY, val);
  return val;
}

export async function syncPushTokenIfGranted() {
  const status = (await Notifications.getPermissionsAsync()).status;
  if (status !== "granted") return; // no prompt here
  await ensurePushPermissionsAndToken(); // saves/updates token for this device
}