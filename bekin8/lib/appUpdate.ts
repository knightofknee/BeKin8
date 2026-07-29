// lib/appUpdate.ts
// App Store version check for the update nudge (components/UpdateModal.tsx).
import * as Application from "expo-application";
import { Platform } from "react-native";

export type AppUpdateInfo = {
  /** Version currently live on the App Store, e.g. "1.2.25". */
  storeVersion: string;
  /** Direct link to the app's App Store page. */
  storeUrl: string;
};

/**
 * Returns true when `store` is a strictly newer dotted version than
 * `installed`. Missing segments count as 0 ("1.2" vs "1.2.0" is equal).
 * Non-numeric segments make the comparison bail to false; never prompt
 * on garbage data.
 */
export function isNewerVersion(store: string, installed: string): boolean {
  const a = store.split(".");
  const b = installed.split(".");
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] === undefined ? 0 : Number(a[i]);
    const y = b[i] === undefined ? 0 : Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Storefront region for the lookup: the device locale's region is the best
// no-extra-dependency proxy (a hardcoded US hands non-US users a US listing
// whose release timing and store link may not match their storefront).
function deviceRegion(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    const region = locale.split("-").find((part) => /^[A-Z]{2}$/.test(part));
    return region ?? "US";
  } catch {
    return "US";
  }
}

/**
 * Checks the App Store for a newer version of the app.
 *
 * Compares against the running binary's own CFBundleShortVersionString
 * (Application.nativeApplicationVersion), NOT app.json: the store listing
 * displays the approved binary's version string, so that's the only number
 * guaranteed to share the store's versioning scheme.
 *
 * Resolves with the store version + listing URL when the installed build is
 * behind, or null when up to date / not applicable (Android, dev builds,
 * network failure, app not found). Never throws; an update nudge is not
 * worth surfacing an error for.
 *
 * Apple-side caching can delay a fresh release appearing in this lookup
 * (usually minutes-to-hours, worst case ~24h); callers should re-check on
 * foreground rather than only at cold start.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  // iTunes lookup only covers the App Store; dev builds always report the
  // in-progress version and would nag constantly.
  if (Platform.OS !== "ios" || __DEV__) return null;

  const bundleId = Application.applicationId;
  const installed = Application.nativeApplicationVersion;
  if (!bundleId || !installed) return null;

  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${bundleId}&country=${deviceRegion()}`,
      { headers: { "Cache-Control": "no-cache" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const app = json?.results?.[0];
    const storeVersion: unknown = app?.version;
    const storeUrl: unknown = app?.trackViewUrl;
    if (typeof storeVersion !== "string" || typeof storeUrl !== "string") {
      return null;
    }
    if (!isNewerVersion(storeVersion, installed)) return null;
    return { storeVersion, storeUrl };
  } catch {
    return null;
  }
}
