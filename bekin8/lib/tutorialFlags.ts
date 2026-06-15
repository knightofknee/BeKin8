// lib/tutorialFlags.ts
// Per-user "has seen this tutorial" flags, backed by AsyncStorage.
// Key scheme matches the existing `feed_showMine:${uid}` convention (see app/feed.tsx),
// with a version segment so bumping VERSION re-triggers a tutorial for everyone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../firebase.config";

const VERSION = "v1";

export type TutorialFeature = "beacon" | "post" | "notifications";

const uidOrAnon = () => auth.currentUser?.uid ?? "anon";
const keyFor = (feature: TutorialFeature, uid: string) =>
  `@bekin_tutorial_${feature}_${VERSION}:${uid}`;

/** True once the user has seen (or skipped) the given tutorial. Never throws. */
export async function getSeen(
  feature: TutorialFeature,
  uid: string = uidOrAnon()
): Promise<boolean> {
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
  try {
    await AsyncStorage.removeItem(keyFor(feature, uid));
  } catch {
    /* ignore */
  }
}
