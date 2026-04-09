// lib/appleAuth.ts
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { OAuthProvider, signInWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { syncPushTokenIfGranted } from "./push";

/**
 * Performs native Apple Sign-In, bridges to Firebase Auth,
 * and creates the Firestore user doc if this is a new user.
 *
 * Returns `{ user, isRelayEmail }` on success.
 * `isRelayEmail` is true when Apple's "Hide My Email" was used (first sign-in only).
 * Throws on cancellation or error — caller should catch.
 */
export async function signInWithApple() {
  // 1. Generate a cryptographic nonce (required by Firebase for Apple OAuth)
  const rawNonce = generateNonce(32);
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  // 2. Trigger native Apple Sign-In UI
  const appleCredential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
    ],
    nonce: hashedNonce,
  });

  const identityToken = appleCredential.identityToken;
  if (!identityToken) {
    throw new Error("Apple Sign-In succeeded but no identity token was returned.");
  }

  // 3. Create Firebase credential from Apple identity token + raw nonce
  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: identityToken,
    rawNonce,
  });

  // 4. Sign in to Firebase
  const userCredential = await signInWithCredential(auth, credential);
  const user = userCredential.user;

  // 5. Check if this is a first-time user — create Firestore doc if needed.
  const userDocRef = doc(db, "users", user.uid);
  const userDoc = await getDoc(userDocRef);

  const isNewUser = !userDoc.exists();

  if (isNewUser) {
    // Apple may provide name on first sign-in only; email may be hidden (relay).
    // Match the exact structure from signup.tsx / googleAuth.ts
    await setDoc(userDocRef, {
      uid: user.uid,
      email: user.email,
      username: null,
      hasUsername: false,
      bonusPosts: 3,
      createdAt: serverTimestamp(),
    });
  }

  // 6. Sync push token (same as other sign-in methods)
  await syncPushTokenIfGranted();

  const isRelayEmail =
    isNewUser && !!user.email?.endsWith("@privaterelay.appleid.com");

  return { user, isRelayEmail };
}

/**
 * Generate a random alphanumeric nonce string.
 * Uses expo-crypto since Web Crypto API isn't available in Hermes.
 */
function generateNonce(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = Crypto.getRandomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}
