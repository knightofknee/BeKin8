// lib/analytics.ts
// Funnel events to Firebase Analytics (native). One entry point, track(), that can never throw or
// block: a build without the native module, or analytics being unavailable, just drops the event.
// The web build uses analytics.web.ts. The durable funnel (who invited whom, first friend, first
// beacon) lives server-side on users/{uid}; these events are for ad platforms and day-to-day charts.
type Params = Record<string, string | number | boolean | null | undefined>;

let mod: any | null | undefined; // undefined = not tried yet, null = unavailable
function load(): any | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@react-native-firebase/analytics");
    m.getAnalytics(); // throws here when the native module is missing (old dev client)
    mod = m;
  } catch {
    mod = null;
  }
  return mod;
}

const cleanParams = (p?: Params) => {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return out;
};

export type FunnelEvent =
  | "welcome_view"
  | "sign_up"
  | "login"
  | "username_assigned"
  | "tutorial_begin"
  | "tutorial_complete"
  | "practice_light"
  | "notif_permission"
  | "friend_added"
  | "invite_share"
  | "invite_redeemed"
  | "beacon_lit"
  | "beacon_share_open"
  | "beacon_share_text"
  | "beacon_share_link"
  | "text_friend_added"
  | "rsvp"
  | "beacon_opened_from_link"
  | "beacon_opened_from_push";

export function track(event: FunnelEvent, params?: Params): void {
  const m = load();
  if (!m) return;
  try {
    m.logEvent(m.getAnalytics(), event, cleanParams(params)).catch(() => {});
  } catch {
    /* never let analytics break a flow */
  }
}

export function trackScreen(name: string): void {
  const m = load();
  if (!m) return;
  try {
    m.logScreenView(m.getAnalytics(), { screen_name: name, screen_class: name }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function setAnalyticsUser(uid: string | null): void {
  const m = load();
  if (!m) return;
  try {
    m.setUserId(m.getAnalytics(), uid).catch(() => {});
  } catch {
    /* ignore */
  }
}
