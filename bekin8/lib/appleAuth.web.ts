// lib/appleAuth.web.ts
// Web build of lib/appleAuth.ts: Firebase's Apple popup instead of the native Apple sheet.
import { OAuthProvider } from "firebase/auth";
import { popupSignIn } from "./webSignIn";

export async function signInWithApple() {
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  const { user, isNewUser } = await popupSignIn(provider);
  const isRelayEmail = isNewUser && !!user.email?.endsWith("@privaterelay.appleid.com");
  return { user, isRelayEmail };
}
