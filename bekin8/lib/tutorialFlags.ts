// lib/tutorialFlags.ts
// Per-user "has seen this tutorial" flags, backed by AsyncStorage.
// Key scheme matches the existing `feed_showMine:${uid}` convention (see app/feed.tsx),
// with a version segment so bumping VERSION re-triggers a tutorial for everyone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../firebase.config";

const VERSION = "v1";

// ── DEV TESTING ──────────────────────────────────────────────────────────────
// Flip to `true` to make EVERY tutorial show from the start on each app refresh (it forces
// getSeen() to report "not seen", so the beacon tour auto-opens on Home and the post tour on the
// Post tab every time). Gated behind __DEV__ so it can never affect a release build.
// Set back to `false` before shipping.
const DEV_ALWAYS_SHOW_TUTORIALS = true;

// "beacon"/"post" = the tutorial was COMPLETED (reached the end). "beacon_intro" = the beacon
// tutorial has auto-popped once, so later launches rely on the resume banner instead of re-popping.
export type TutorialFeature = "beacon" | "post" | "notifications" | "beacon_intro";

const uidOrAnon = () => auth.currentUser?.uid ?? "anon";
const keyFor = (feature: TutorialFeature, uid: string) =>
  `@bekin_tutorial_${feature}_${VERSION}:${uid}`;

// Tutorials completed in the CURRENT JS session. This wins over DEV_ALWAYS_SHOW_TUTORIALS, so a
// finished tour (and its resume banner) stays dismissed until the next refresh — a refresh reloads
// this module, clearing the set and re-arming the reset.
const sessionSeen = new Set<TutorialFeature>();

/** True once the user has seen (or skipped) the given tutorial. Never throws. */
export async function getSeen(
  feature: TutorialFeature,
  uid: string = uidOrAnon()
): Promise<boolean> {
  if (sessionSeen.has(feature)) return true;
  if (__DEV__ && DEV_ALWAYS_SHOW_TUTORIALS) return false;
  try {
    const v = await AsyncStorage.getItem(keyFor(feature, uid));
    return v === "1";
  } catch {
    return false;
  }
}

/** Mark a tutorial seen (default) or clear it. Never throws — onboarding must not be blocked by storage. */
export async function setSeen(
  feature: TutorialFeature,
  seen: boolean = true,
  uid: string = uidOrAnon()
): Promise<void> {
  if (seen) sessionSeen.add(feature);
  else sessionSeen.delete(feature);
  try {
    if (seen) await AsyncStorage.setItem(keyFor(feature, uid), "1");
    else await AsyncStorage.removeItem(keyFor(feature, uid));
  } catch {
    /* ignore */
  }
}

/** Clear the flag so the tutorial auto-shows again (used for "reset onboarding"). */
export async function resetSeen(
  feature: TutorialFeature,
  uid: string = uidOrAnon()
): Promise<void> {
  sessionSeen.delete(feature);
  try {
    await AsyncStorage.removeItem(keyFor(feature, uid));
  } catch {
    /* ignore */
  }
}
