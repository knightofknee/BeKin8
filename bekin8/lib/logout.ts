// lib/logout.ts
// Single logout path: best-effort drop this device's push token, then sign out.
// Token removal must never block sign-out, so failures are swallowed.
import { signOut } from "firebase/auth";
import { auth } from "../firebase.config";
import { removePushTokenForThisDevice } from "./push";

export async function logout(): Promise<void> {
  try {
    // Cap the wait: on a dead connection Firestore's deleteDoc never settles, and an
    // unbounded await here left the Log out button doing nothing. After the cap we sign
    // out anyway; the delete stays in Firestore's offline queue and flushes if the
    // connection returns before the app dies. Worst case an orphaned token doc lingers,
    // which was already the accepted outcome of the swallowed-failure path below.
    await Promise.race([
      removePushTokenForThisDevice(auth.currentUser?.uid),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // non-fatal: sign out regardless of token cleanup outcome
  }
  await signOut(auth);
}
