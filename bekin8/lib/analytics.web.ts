// lib/analytics.web.ts
// Web build of lib/analytics.ts: the Firebase JS SDK's analytics (GA4), when the browser supports
// it and a measurement id is configured. Same never-throws contract.
import { getAnalytics, isSupported, logEvent, setUserId, type Analytics } from "firebase/analytics";
import { app } from "../firebase.config";

type Params = Record<string, string | number | boolean | null | undefined>;
export type FunnelEvent = string;

let ready: Promise<Analytics | null> | null = null;
function analytics(): Promise<Analytics | null> {
  if (!ready) {
    ready = isSupported()
      .then((ok) => (ok && process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ? getAnalytics(app) : null))
      .catch(() => null);
  }
  return ready;
}

export function track(event: FunnelEvent, params?: Params): void {
  analytics()
    .then((a) => {
      if (!a) return;
      const clean: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(params ?? {})) {
        if (v === null || v === undefined) continue;
        clean[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
      }
      logEvent(a, event, clean);
    })
    .catch(() => {});
}

export function trackScreen(name: string): void {
  track("screen_view", { screen_name: name });
}

export function setAnalyticsUser(uid: string | null): void {
  analytics()
    .then((a) => a && setUserId(a, uid))
    .catch(() => {});
}
