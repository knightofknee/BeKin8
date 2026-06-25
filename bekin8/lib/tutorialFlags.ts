// lib/tutorialFlags.ts
// Per-user "has seen this tutorial" flags, backed by AsyncStorage.
// Key scheme matches the existing `feed_showMine:${uid}` convention (see app/feed.tsx),
// with a version segment so bumping VERSION re-triggers a tutorial for everyone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../firebase.config";

const VERSION = "v1";

// "beacon"/"post" = the tutorial was COMPLETED (reached the end). "beacon_intro" = the beacon
// tutorial has auto-popped once, so later launches rely on the resume banner instead of re-popping.
// "skip_hint" = the one-time "you can reopen the tour" popup has been shown after a first skip.
// "first_tour_done" = the beacon tour has ended at least once (finish OR skip). "beacon_audience_seen"
// = the one-time "who will see this" confirmation on the first beacon lit after that has been shown.
export type TutorialFeature =
  | "beacon"
  | "post"
  | "notifications"
  | "beacon_intro"
  | "beacon_chat"
  | "skip_hint"
  | "first_tour_done"
  | "beacon_audience_seen";

const uidOrAnon = () => auth.currentUser?.uid ?? "anon";
const keyFor = (feature: TutorialFeature, uid: string) =>
  `@bekin_tutorial_${feature}_${VERSION}:${uid}`;

// Tutorials completed in the CURRENT JS session, so a finished tour (and its resume banner) stays
// dismissed until the next refresh. A refresh reloads this module, clearing the set.
const sessionSeen = new Set<TutorialFeature>();

/** True once the user has seen (or skipped) the given tutorial. Never throws. */
export async function getSeen(
  feature: TutorialFeature,
  uid: string = uidOrAnon()
): Promise<boolean> {
  if (sessionSeen.has(feature)) return true;
  try {
    const v = await AsyncStorage.getItem(keyFor(feature, uid));
    return v === "1";
  } catch {
    return false;
  }
}

/** Mark a tutorial seen (default) or clear it. Never throws, onboarding must not be blocked by storage. */
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
