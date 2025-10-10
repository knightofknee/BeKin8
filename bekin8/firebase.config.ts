// firebase.config.ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---- Avoid duplicate inits across Fast Refresh (HMR) ----
declare global {
  // eslint-disable-next-line no-var
  var __BEKIN_FIREBASE__: {
    app?: FirebaseApp;
    auth?: Auth;
    db?: Firestore;
  } | undefined;
}
const g = globalThis as any;
g.__BEKIN_FIREBASE__ ||= {};

// ---- Your env-based config (unchanged) ----
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// ---- App singleton ----
const app: FirebaseApp =
  g.__BEKIN_FIREBASE__.app ??
  (g.__BEKIN_FIREBASE__.app = (getApps().length ? getApps()[0] : initializeApp(firebaseConfig)));

// ---- Auth singleton (RN persistence) ----
const auth: Auth =
  g.__BEKIN_FIREBASE__.auth ??
  (g.__BEKIN_FIREBASE__.auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  }));

// ---- Firestore singleton ----
const db: Firestore = g.__BEKIN_FIREBASE__.db ?? (g.__BEKIN_FIREBASE__.db = getFirestore(app));

export { app, auth, db }; // note: we do NOT export onAuthStateChanged