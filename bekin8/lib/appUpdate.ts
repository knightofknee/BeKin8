// lib/appUpdate.ts
// Version check for the update nudge (components/UpdateModal.tsx).
//
// SOURCE OF TRUTH: our own Config/app doc, NOT the iTunes lookup API. The App Store's public
// version name and the binary's own version (what EAS stamps from app.json) are two different
// numbering schemes on purpose, so comparing the binary against the store listing nags every
// up-to-date user forever (shipped: binary 1.2.25 inside the listing named "2.0.1"). Instead,
// Config/app carries `latestVersion` on the BINARY scheme, written by hand when a release is
// confirmed live in the store. That also kills the release-day window where Apple's lookup
// reports a version the store CDN won't actually hand over yet: the field is flipped only once
// the store really serves the update, so the Update button never leads to a dead end.
//
// ANDROID compares the build number (versionCode), not the version name: Android builds only
// bump versionCode (eas.json autoIncrement), so several Play releases share one version name and
// a name check never tells Android users a new build is out. Android gets its own dials,
// androidLatestBuild (warn, here) / androidMinBuild (block, lib/updateGate.ts), which also lets
// each store be flipped when IT goes live. Android builds up to versionCode 13 predate this and
// still read latestVersion / minVersion.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.config";

export type AppUpdateInfo = {
  /**
   * The release this build is behind: Config/app.latestVersion on iOS (e.g. "1.2.25"),
   * "android build N" on Android. Keys the snooze.
   */
  latestVersion: string;
  /** Link to this platform's store listing. */
  storeUrl: string;
  /** Config/app.message: an optional per-release line (what's new) that replaces the card's built-in text. */
  message?: string;
};

/**
 * Returns true when `latest` is a strictly newer dotted version than
 * `installed`. Missing segments count as 0 ("1.2" vs "1.2.0" is equal).
 * Non-numeric segments make the comparison bail to false; never prompt
 * on garbage data.
 */
export function isNewerVersion(latest: string, installed: string): boolean {
  const a = latest.split(".");
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

/**
 * True when a whole-number build `target` (Config/app androidLatestBuild / androidMinBuild) is
 * above the running build number. Anything that isn't a positive whole number on either side
 * bails to false: never prompt on garbage data.
 */
export function isOlderBuild(target: unknown, installed: string | null | undefined): boolean {
  const have = Number(installed);
  if (typeof target !== "number" || !Number.isInteger(target) || target <= 0) return false;
  if (!installed || !Number.isInteger(have) || have <= 0) return false;
  return have < target;
}

/**
 * Android only: whether this build sits below one of Config/app's build dials ('latest' warns,
 * 'min' blocks). Resolves "android build N" (the snooze key) when it does, null when current,
 * the dial is unset, or the data is garbage.
 */
export function behindAndroidDial(data: any, dial: "latest" | "min"): string | null {
  const target = data?.[dial === "latest" ? "androidLatestBuild" : "androidMinBuild"];
  return isOlderBuild(target, Application.nativeBuildVersion) ? `android build ${target}` : null;
}

// Dismissing the nudge is a snooze, not a mute: Close (or an Update tap) buys quiet for a day,
// then the nagging resumes until the user is actually current. Persisted so a relaunch doesn't
// reset the clock.
export const DISMISS_SNOOZE_MS = 24 * 60 * 60 * 1000;
const DISMISS_KEY = "appUpdate.dismissed";

export type DismissRecord = {
  /** The latest-version string that was dismissed. */
  version: string;
  /** Epoch ms when it was dismissed. */
  at: number;
};

/**
 * True while a previously dismissed version should stay quiet: same version,
 * dismissed less than DISMISS_SNOOZE_MS ago. A newer release prompts immediately.
 */
export function isSnoozed(
  latestVersion: string,
  record: DismissRecord | null,
  now: number
): boolean {
  if (!record) return false;
  return record.version === latestVersion && now - record.at < DISMISS_SNOOZE_MS;
}

/** Best-effort read of the persisted dismissal; malformed or missing resolves to null. */
export async function loadDismissRecord(): Promise<DismissRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version !== "string" || typeof parsed?.at !== "number") return null;
    return { version: parsed.version, at: parsed.at };
  } catch {
    return null;
  }
}

/** Best-effort persist of a dismissal; storage failure just means an earlier re-prompt. */
export async function saveDismissRecord(version: string): Promise<void> {
  try {
    const record: DismissRecord = { version, at: Date.now() };
    await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify(record));
  } catch {
    // Ignore: the snooze is a courtesy, not a contract.
  }
}

/**
 * Checks Config/app for a newer released version of the app.
 *
 * iOS compares the running binary's own version (Application.nativeApplicationVersion,
 * the same number EAS stamps from app.json) against Config/app.latestVersion,
 * which is on the same scheme. The App Store's public version name never enters
 * the comparison. Android compares its build number (Application.nativeBuildVersion,
 * the versionCode) against Config/app.androidLatestBuild (see the top of this file).
 *
 * Resolves with the latest version + this platform's store URL when the installed
 * build is behind, or null when up to date / not applicable (dev builds, missing
 * config, no store URL for this platform, network failure). Never throws; an
 * update nudge is not worth surfacing an error for.
 *
 * Config/app is world-readable by rule, so this works signed-out too. Fields used:
 *   latestVersion       string  iOS: latest released binary version; blank/absent disables the nudge
 *   androidLatestBuild  number  Android: latest released versionCode; absent disables the nudge
 *   iosUrl              string  App Store listing link
 *   androidUrl          string  Play Store listing link (absent while Android has no public release)
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  // Dev builds always report the in-progress version and would nag constantly.
  if (__DEV__) return null;

  try {
    const snap = await getDoc(doc(db, "Config", "app"));
    if (!snap.exists()) return null;
    const data = snap.data() as any;

    const storeUrl = Platform.OS === "ios" ? data?.iosUrl : data?.androidUrl;
    if (typeof storeUrl !== "string" || !storeUrl) return null;

    let latestVersion: string;
    if (Platform.OS === "android") {
      const behind = behindAndroidDial(data, "latest");
      if (!behind) return null;
      latestVersion = behind;
    } else {
      const installed = Application.nativeApplicationVersion;
      if (!installed) return null;
      latestVersion = typeof data?.latestVersion === "string" ? data.latestVersion.trim() : "";
      if (!latestVersion) return null;
      if (!isNewerVersion(latestVersion, installed)) return null;
    }
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    return { latestVersion, storeUrl, ...(message ? { message } : {}) };
  } catch {
    return null;
  }
}
