// lib/googleAuth.ts
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { syncPushTokenIfGranted } from "./push";

// Configure once at module load — idempotent, safe to call early
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
});

/**
 * Performs native Google Sign-In, bridges to Firebase Auth,
 * and creates the Firestore user doc if this is a new user.
 *
 * Returns the Firebase User on success.
 * Throws on cancellation or error — caller should catch.
 */
export async function signInWithGoogle() {
  // 1. Check Play Services availability (Android; no-op on iOS)
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // 2. Trigger native Google Sign-In UI
  const signInResult = await GoogleSignin.signIn();

  // 3. Extract the ID token
  const idToken = signInResult.data?.idToken;
  if (!idToken) {
    throw new Error("Google Sign-In succeeded but no ID token was returned.");
  }

  // 4. Create Firebase credential from Google ID token
  const credential = GoogleAuthProvider.credential(idToken);

  // 5. Sign in to Firebase
  const userCredential = await signInWithCredential(auth, credential);
  const user = userCredential.user;

  // 6. Check if this is a first-time user — create Firestore doc if needed.
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
      createdAt: serverTimestamp(),
    });
  }

  // 7. Sync push token (same as email login does)
  await syncPushTokenIfGranted();

  return user;
}
