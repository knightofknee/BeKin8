// lib/webSignIn.ts
// Shared tail of the web Google/Apple sign-ins: Firebase popup, then the same first-time user doc
// the native flows write (structure matches signup.tsx / googleAuth.ts / appleAuth.ts).
import { signInWithPopup, type AuthProvider } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";

export async function popupSignIn(provider: AuthProvider) {
  const { user } = await signInWithPopup(auth, provider);
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const isNewUser = !snap.exists();
  if (isNewUser) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      username: null,
      hasUsername: false,
      bonusPosts: 3,
      createdAt: serverTimestamp(),
    });
  }
  return { user, isNewUser };
}
