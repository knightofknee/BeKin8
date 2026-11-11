// lib/googleAuth.web.ts
// Web build of lib/googleAuth.ts: Firebase's Google popup instead of the native Google SDK.
import { GoogleAuthProvider } from "firebase/auth";
import { popupSignIn } from "./webSignIn";

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const { user } = await popupSignIn(provider);
  return user;
}
