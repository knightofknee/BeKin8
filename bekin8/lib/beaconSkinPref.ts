// lib/beaconSkinPref.ts
// Device-local selected beacon SKIN id. AsyncStorage + a tiny pub/sub so the Beacon-options picker
// and the home beacon stay in sync without a server round-trip. Defaults to DEFAULT_SKIN_ID.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SKIN_ID, getSkin, type BeaconSkin } from "./beaconSkins";

const KEY = "@bekin_beacon_skin";
type Listener = (id: string) => void;
const listeners = new Set<Listener>();

export async function getBeaconSkinId(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) || DEFAULT_SKIN_ID;
  } catch {
    return DEFAULT_SKIN_ID;
  }
}

export async function getBeaconSkin(): Promise<BeaconSkin> {
  return getSkin(await getBeaconSkinId());
}

export async function setBeaconSkinId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(id));
}

export function onBeaconSkinChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
