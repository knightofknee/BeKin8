// lib/emailVerification.ts
// Deferred email verification for email/password accounts (7-day grace period).
// Policy: only accounts created via the 'password' provider ON OR AFTER the epoch below are
// subject to verification. Existing users are fully exempt. SSO-only users are never gated.
import { sendEmailVerification, type User } from "firebase/auth";

/** Accounts created before this instant are exempt from the verification requirement. */
export const VERIFICATION_EPOCH_MS = Date.parse("2026-07-08T00:00:00Z");

/** Days after account creation before the app hard-gates unverified email/password users. */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fire-and-forget send of the initial verification email at signup.
 * Never throws: signup must not gain friction from a failed send (resend covers recovery).
 */
export async function sendInitialVerification(user: User): Promise<void> {
  try {
    await sendEmailVerification(user);
  } catch (err) {
    if (__DEV__) console.warn("[emailVerification] initial send failed:", err);
  }
}

/** Parsed creation time in ms, or null when unavailable/unparseable. */
function creationMs(user: User | null): number | null {
  const raw = user?.metadata?.creationTime;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True only when ALL hold: user exists, has the 'password' provider, is not verified,
 * and was created on/after VERIFICATION_EPOCH_MS (existing users fully exempt).
 */
export function needsVerification(user: User | null): boolean {
  if (!user) return false;
  if (user.emailVerified) return false;
  const hasPassword = user.providerData?.some((p) => p?.providerId === "password") ?? false;
  if (!hasPassword) return false;
  const created = creationMs(user);
  return created !== null && created >= VERIFICATION_EPOCH_MS;
}

/** Absolute deadline (ms since epoch) after which the user is hard-gated, or null if unknown. */
export function verificationDeadlineMs(user: User | null): number | null {
  const created = creationMs(user);
  return created === null ? null : created + GRACE_DAYS * DAY_MS;
}

/** True when the user needs verification AND the grace period has elapsed. */
export function isGated(user: User | null, nowMs: number = Date.now()): boolean {
  if (!needsVerification(user)) return false;
  const deadline = verificationDeadlineMs(user);
  return deadline !== null && nowMs > deadline;
}

/** Whole days remaining in the grace period (ceiling, never negative). */
export function daysLeft(user: User | null, nowMs: number = Date.now()): number {
  const deadline = verificationDeadlineMs(user);
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - nowMs) / DAY_MS));
}

// Simple in-module resend throttle: one send per 60s per JS session.
const RESEND_THROTTLE_MS = 60_000;
let lastResendAtMs = 0;

/**
 * Resend the verification email, throttled to once per 60 seconds.
 * Returns { ok: true } on send, or { ok: false, waitSeconds } while throttled,
 * or { ok: false } if the send itself failed.
 */
export async function resendVerification(user: User): Promise<{ ok: boolean; waitSeconds?: number }> {
  const now = Date.now();
  const sinceLast = now - lastResendAtMs;
  if (lastResendAtMs > 0 && sinceLast < RESEND_THROTTLE_MS) {
    return { ok: false, waitSeconds: Math.ceil((RESEND_THROTTLE_MS - sinceLast) / 1000) };
  }
  try {
    await sendEmailVerification(user);
    lastResendAtMs = now;
    return { ok: true };
  } catch (err) {
    if (__DEV__) console.warn("[emailVerification] resend failed:", err);
    return { ok: false };
  }
}
