// lib/autoUsername.ts
// New accounts get a username the moment they exist (server: assignDefaultUsername), built from
// their name or email, numbered when taken (Brian, Brian2, ...). They can change it on Friends.
// Single-flight per uid, so the root layout and Home can both await the same call.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { track } from "./analytics";

// Apple hands the person's name to the device once, at first sign-in, and never to Firebase.
// lib/appleAuth stashes it here so the server can build the username from it.
const NAME_HINT_KEY = "@bekin_name_hint";
export async function stashNameHint(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  try {
    await AsyncStorage.setItem(NAME_HINT_KEY, n.slice(0, 60));
  } catch {
    /* optional */
  }
}

const inFlight = new Map<string, Promise<string | null>>();

/** Resolves to the username (existing or newly assigned), or null if the call failed. */
export function ensureAutoUsername(uid: string): Promise<string | null> {
  const existing = inFlight.get(uid);
  if (existing) return existing;
  const p = (async () => {
    try {
      const nameHint = (await AsyncStorage.getItem(NAME_HINT_KEY).catch(() => null)) || undefined;
      const res = await httpsCallable(getFunctions(), "assignDefaultUsername")({ nameHint });
      const data = (res.data ?? {}) as { username?: string; assigned?: boolean };
      if (data.assigned) track("username_assigned");
      AsyncStorage.removeItem(NAME_HINT_KEY).catch(() => {});
      return data.username || null;
    } catch {
      inFlight.delete(uid); // offline or not deployed yet: let a later call retry
      return null;
    }
  })();
  inFlight.set(uid, p);
  return p;
}
