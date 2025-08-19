import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ["EXPO_PUBLIC_FIREBASE_API_KEY","EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN","EXPO_PUBLIC_FIREBASE_PROJECT_ID","EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET","EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID","EXPO_PUBLIC_FIREBASE_APP_ID"]
//   .forEach((k) => { if (!process.env[k]) throw new Error(`Missing env var: ${k}`); });

// // Optional: quick visibility while debugging
// console.table({
//   API_KEY: (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "").slice(0,6) + "…",
//   AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
//   PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
// });

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID
});

export const auth = getAuth(app);      // in-memory (resets on restart)
export const db = getFirestore(app);