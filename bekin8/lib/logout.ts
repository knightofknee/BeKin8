// lib/logout.ts
// Single logout path: best-effort drop this device's push token, then sign out.
// Token removal must never block sign-out, so failures are swallowed.
import { signOut } from "firebase/auth";
import { auth } from "../firebase.config";
import { removePushTokenForThisDevice } from "./push";

export async function logout(): Promise<void> {
  try {
    await removePushTokenForThisDevice(auth.currentUser?.uid);
  } catch {
    // non-fatal: sign out regardless of token cleanup outcome
  }
  await signOut(auth);
}
