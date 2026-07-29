// lib/googleAuth.ts
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { syncPushTokenIfGranted } from "./push";

// Configure once at module load, idempotent, safe to call early
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
});

/**
 * Performs native Google Sign-In, bridges to Firebase Auth,
 * and creates the Firestore user doc if this is a new user.
 *
 * Returns the Firebase User on success.
 * Throws on cancellation or error, caller should catch.
 */
export async function signInWithGoogle() {
  // 1. Check Play Services availability (Android; no-op on iOS)
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  try {
    // 2. Trigger native Google Sign-In UI
    const signInResult = await GoogleSignin.signIn();

    // 3. Handle a user-cancelled picker BEFORE the token check.
    //    v13+ of this library RESOLVES with { type: 'cancelled', data: null } instead of rejecting
    //    with SIGN_IN_CANCELLED (we're on 16.1.2). Without this branch, backing out of the account
    //    picker fell through to the "no ID token" throw below and the user got a red
    //    "Google sign-in failed" banner for an action they deliberately took. The callers' existing
    //    `e?.code === statusCodes.SIGN_IN_CANCELLED` early-returns were dead code.
    //    Rethrown with that same code so those callers keep working untouched, and so this stays
    //    correct if a future version goes back to rejecting.
    if ((signInResult as any)?.type === "cancelled") {
      const cancelled: any = new Error("Google Sign-In was cancelled by the user.");
      cancelled.code = statusCodes.SIGN_IN_CANCELLED;
      throw cancelled;
    }

    // 4. Extract the ID token
    const idToken = signInResult.data?.idToken;
    if (!idToken) {
      throw new Error("Google Sign-In succeeded but no ID token was returned.");
    }

    // 5. Create Firebase credential from Google ID token
    const credential = GoogleAuthProvider.credential(idToken);

    // 6. Sign in to Firebase
    const userCredential = await signInWithCredential(auth, credential);
    const user = userCredential.user;

    // 7. Check if this is a first-time user, create Firestore doc if needed.
    //    We check the doc directly (not additionalUserInfo.isNewUser) because
    //    a prior crashed attempt could leave an Auth user without a Firestore doc.
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      // Match the exact structure from signup.tsx
      await setDoc(userDocRef, {
        uid: user.uid,
        email: user.email,
        username: null,
        hasUsername: false,
        bonusPosts: 3,
        createdAt: serverTimestamp(),
      });
    }

    // 8. Sync push token (same as email login does)
    await syncPushTokenIfGranted();

    return user;
  } catch (err) {
    // A failure can leave the native module holding a half-open Google session; a retry
    // then short-circuits against that dead state and the button looks broken. Clear it
    // so the next tap starts a fresh sign-in (account picker and all), then rethrow.
    await GoogleSignin.signOut().catch(() => {});
    throw err;
  }
}
