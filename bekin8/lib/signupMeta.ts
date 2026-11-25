// lib/signupMeta.ts
// Fields stamped on users/{uid} when an account is first created, so signups can be split by how
// and where they came in (tools/funnelReport.js). Android also records the raw Play install
// referrer, which carries an ad campaign's utm_* / gclid when the install came from an ad.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

export type SignupMethod = "password" | "google" | "apple";
export const INSTALL_REFERRER_KEY = "@bekin_install_referrer";

export async function signupMeta(method: SignupMethod): Promise<Record<string, string>> {
  const out: Record<string, string> = { signupMethod: method, signupPlatform: Platform.OS };
  const version = Constants.expoConfig?.version;
  if (version) out.signupAppVersion = String(version);
  try {
    const ref = await AsyncStorage.getItem(INSTALL_REFERRER_KEY);
    if (ref) out.installReferrer = ref.slice(0, 500);
  } catch {
    /* optional */
  }
  return out;
}
