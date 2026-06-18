// lib/inviteLink.ts
// Client helpers for the referral invite flow: build/parse the smart link, stash an incoming
// code across the signup boundary, and redeem it server-side once authenticated.
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
