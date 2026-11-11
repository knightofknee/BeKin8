// firebase.config.web.ts
// Web build of firebase.config.ts (Metro picks *.web.ts for the web export). Same project and
// singletons; the differences are browser auth persistence (IndexedDB/localStorage instead of
// AsyncStorage), and App Check uses reCAPTCHA Enterprise (lib/appCheck.web.ts) instead of the
// native attestation bridge.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { startAppCheck } from "./lib/appCheck";

const g = globalThis as any;
g.__BEKIN_FIREBASE__ ||= {};

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app: FirebaseApp =
  g.__BEKIN_FIREBASE__.app ??
  (g.__BEKIN_FIREBASE__.app = (getApps().length ? getApps()[0] : initializeApp(firebaseConfig)));

// App Check before Auth/Firestore so their very first requests already carry a token.
startAppCheck(app);

const auth: Auth =
  g.__BEKIN_FIREBASE__.auth ??
  (g.__BEKIN_FIREBASE__.auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    // Required for signInWithPopup (Google/Apple): unlike getAuth(), initializeAuth() does not
    // include the popup handler, and without it the popup throws auth/argument-error.
    popupRedirectResolver: browserPopupRedirectResolver,
  }));

const db: Firestore = g.__BEKIN_FIREBASE__.db ?? (g.__BEKIN_FIREBASE__.db = getFirestore(app));

export { app, auth, db };
