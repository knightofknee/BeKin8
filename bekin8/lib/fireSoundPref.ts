// lib/fireSoundPref.ts
// Device-local "Fire sounds" preference (default OFF). Backed by AsyncStorage with a tiny pub/sub so
// the Settings toggle and the Home beacon screen stay in sync without a server round-trip.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@bekin_fire_sounds";
type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

// Default ON for the centerpiece beacon (user decision 2026-06-18). We persist an explicit "0" when
// the user mutes, so absence-of-key reads as ON. A small mute button lives on the home beacon.
export async function getFireSoundEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function setFireSoundEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(enabled));
}

export function onFireSoundChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
