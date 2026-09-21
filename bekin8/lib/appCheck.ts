// lib/appCheck.ts
// Firebase App Check for a JS-SDK app.
//
// BeKin talks to Firebase through the firebase JS SDK, which has no attestation provider on React
// Native (its built-in providers are reCAPTCHA = web only). So the NATIVE side is handled by
// @react-native-firebase/app-check (App Attest on iOS, Play Integrity on Android), and its tokens
// are bridged into the JS SDK through a CustomProvider. Once that is in place the JS SDK attaches
// the token to every Firestore, Auth and callable-function request on its own.
//
// ROLLOUT: this ships in MONITOR mode. Nothing is enforced (Firestore enforcement is off in the
// console and every callable still has enforceAppCheck: false), so a failed attestation changes
// nothing for the user. Watch the verified-request share in Firebase console > App Check, and only
// enforce once nearly all traffic comes from builds that contain this file.
//
// SAFETY: every step is wrapped. A missing native module (an old dev client), a simulator, or an
// attestation outage must never stop the app from starting or a request from being sent.
import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, CustomProvider, type AppCheck } from "firebase/app-check";
import * as Device from "expo-device";

// Inlined at bundle time. It is ONLY ever set in a local shell for simulator verification; it must
// never be added to .env or to EAS env, because anything EXPO_PUBLIC_ is readable in the shipped
// bundle and a leaked debug token is a master key past App Check.
const DEBUG_TOKEN = process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN || undefined;

const FALLBACK_TTL_MS = 30 * 60 * 1000;

/** App Check tokens are JWTs; read `exp` so the JS SDK refreshes on the real schedule. */
function expiryOf(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload || typeof globalThis.atob !== "function") return Date.now() + FALLBACK_TTL_MS;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(globalThis.atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    const expMs = Number(json?.exp) * 1000;
    return Number.isFinite(expMs) && expMs > Date.now() ? expMs : Date.now() + FALLBACK_TTL_MS;
  } catch {
    return Date.now() + FALLBACK_TTL_MS;
  }
}

let started: AppCheck | null | undefined;

export function startAppCheck(app: FirebaseApp): AppCheck | null {
  if (started !== undefined) return started;
  started = null;
  try {
    // require(), not import: an import of a missing native module throws at module-evaluation time,
    // which would take firebase.config (and so the whole app) down with it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnfb = require("@react-native-firebase/app-check") as typeof import("@react-native-firebase/app-check");

    // Real attestation only exists on real hardware. Simulators/emulators and dev builds use the
    // debug provider, which only yields a valid token if its debug token is registered in the console.
    const useDebug = __DEV__ || !Device.isDevice;
    const provider = new rnfb.ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      apple: { provider: useDebug ? "debug" : "appAttest", debugToken: useDebug ? DEBUG_TOKEN : undefined },
      android: { provider: useDebug ? "debug" : "playIntegrity", debugToken: useDebug ? DEBUG_TOKEN : undefined },
    });
    const native = rnfb.initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });

    started = initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => {
          const { token } = await rnfb.getToken(native, false);
          return { token, expireTimeMillis: expiryOf(token) };
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    if (__DEV__) console.warn("[appCheck] not started", e);
  }
  return started;
}
