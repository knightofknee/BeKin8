// lib/inviteLink.ts
// Client helpers for the referral invite flow: build/parse the smart link, stash an incoming
// code across the signup boundary, and redeem it server-side once authenticated.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFunctions, httpsCallable } from "firebase/functions";

// The smart https link. Lives on waldgrave.com so a single link works whether or not the app
// is installed (Universal/App Links open the app; otherwise the page redirects to the store).
export const INVITE_WEB_BASE = "https://www.waldgrave.com/bekin/invite";

const PENDING_KEY = "@bekin_pending_invite";
const CODE_RE = /^[A-Z0-9]{6}$/;

export function buildInviteUrl(code: string): string {
  return `${INVITE_WEB_BASE}/${code}`;
}

/**
 * Extract a 6-char invite code from a deep link or web URL.
 * Matches both `bekin8://invite/<code>` and `https://waldgrave.com/bekin/invite/<code>`.
 */
export function parseInviteCode(url: string | null | undefined): string | null {
  if (!url) return null;
  // Anchor to the two shapes we actually issue so a hostile page can't fire
  // bekin8://anything/invite/XXXXXX and silently friend the user via the custom scheme.
  const m = url.match(
    /^(?:bekin8:\/\/invite\/|https:\/\/www\.waldgrave\.com\/bekin\/invite\/)([A-Za-z0-9]{6})(?:[/?#]|$)/i
  );
  if (!m) return null;
  const code = m[1].toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/**
 * Coerce arbitrary text (e.g. clipboard contents) into an invite code.
 * Accepts a bare 6-char code or a full invite URL. Returns null if neither matches.
 */
export function coerceInviteCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (CODE_RE.test(t.toUpperCase())) return t.toUpperCase();
  return parseInviteCode(t);
}

/** Persist a pending invite code so it survives the signup round-trip. */
export async function stashPendingInvite(code: string): Promise<void> {
  const c = (code || "").trim().toUpperCase();
  if (!CODE_RE.test(c)) return;
  try {
    await AsyncStorage.setItem(PENDING_KEY, c);
  } catch {
    /* ignore */
  }
}

export async function getPendingInvite(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    return v && CODE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export type RedeemResult = {
  ok: boolean;
  error?: "BAD_CODE" | "NOT_FOUND" | "SELF" | string;
  already?: boolean;
  inviterUid?: string;
  inviterUsername?: string;
};

/** Call the server to redeem a code into an accepted friendship. */
export async function redeemInviteCode(code: string): Promise<RedeemResult> {
  const fn = httpsCallable(getFunctions(), "redeemInvite");
  const res = await fn({ code });
  return ((res.data as RedeemResult) ?? { ok: false });
}

// ---- My own permanent code (the payload of my friend link) ----
// Cached per uid so the Share button is live the moment Friends renders, instead of waiting on a
// cold ensureInviteCode call. The code never changes, so the cache never goes stale.
const MY_CODE_KEY_PREFIX = "@bekin_my_invite_code:";

export async function getCachedMyInviteCode(uid: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(MY_CODE_KEY_PREFIX + uid);
    return v && CODE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Return my code, minting + caching it if needed. Safe to fire-and-forget at app start; fails
 *  quietly when no username exists yet (the server refuses to mint until then). */
export async function prefetchMyInviteCode(uid: string): Promise<string | null> {
  const cached = await getCachedMyInviteCode(uid);
  if (cached) return cached;
  try {
    const res = await httpsCallable(getFunctions(), "ensureInviteCode")({});
    const code = String((res.data as any)?.code ?? "").toUpperCase();
    if (CODE_RE.test(code)) {
      AsyncStorage.setItem(MY_CODE_KEY_PREFIX + uid, code).catch(() => {});
      return code;
    }
  } catch {
    // no username yet, or offline; callers retry on demand
  }
  return null;
}

// ---- Deferred attribution: carry an invite THROUGH an app-store install ----

// Android: the Play Store officially passes the store link's `referrer` param to the app on first
// launch. The waldgrave landing page sets referrer=bekin_invite%3D<CODE>; read it once, stash the
// code, and the normal redeem flow connects the pair at signup. Returns true if a code was found.
const REFERRER_CHECKED_KEY = "@bekin_install_referrer_checked";
export async function captureInstallReferrerInvite(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    if (await AsyncStorage.getItem(REFERRER_CHECKED_KEY)) return false;
    const Application = await import("expo-application");
    const ref = (await Application.getInstallReferrerAsync()) || "";
    // Burn the one-shot only after a successful read, so a dev client without the native module
    // (pre-rebuild) doesn't permanently skip the check.
    AsyncStorage.setItem(REFERRER_CHECKED_KEY, "1").catch(() => {});
    const m = /(?:^|[&?])bekin_invite=([A-Za-z0-9]{6})(?:&|$)/.exec(ref);
    if (!m) return false;
    await stashPendingInvite(m[1].toUpperCase());
    return true;
  } catch {
    return false; // module missing or referrer unavailable; retry next launch is fine
  }
}

// iOS: Apple passes nothing through an App Store install, so the landing page records the visit
// (code + hashed IP) server-side and the app claims it here on first launch. CLAIM-ALL: every
// live visit on this network comes back, so a room of sharers all connect with the newcomer.
export type DeferredInvite = { code: string; inviterUsername?: string };
export async function claimDeferredInvites(): Promise<DeferredInvite[]> {
  const fn = httpsCallable(getFunctions(), "claimInviteVisit");
  const res = await fn({});
  const raw = (res.data as any)?.invites;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i: any) => typeof i?.code === "string" && CODE_RE.test(i.code))
    .map((i: any) => ({
      code: String(i.code),
      inviterUsername: typeof i.inviterUsername === "string" && i.inviterUsername ? i.inviterUsername : undefined,
    }));
}
