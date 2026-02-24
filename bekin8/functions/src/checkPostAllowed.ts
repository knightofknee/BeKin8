// functions/src/checkPostAllowed.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

// ── Central-time helpers ──────────────────────────────────────────────────────
// Fixed UTC-6 offset (Central Standard Time). DST shifts this by 1 hour but
// that's acceptable for a midnight-boundary feature.
const CENTRAL_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the UTC epoch ms for the start of a calendar day in Central time.
 * offsetDays = 0 → today, -1 → yesterday, -2 → day before yesterday, +1 → tomorrow, etc.
 */
function startOfCentralDay(offsetDays = 0): number {
  const nowCentral = Date.now() - CENTRAL_OFFSET_MS;
  const d = new Date(nowCentral);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.getTime() + CENTRAL_OFFSET_MS; // convert back to UTC epoch ms
}

/** Returns the day-of-week name (e.g. "Thursday") for a UTC epoch ms timestamp. */
function dayOfWeekName(utcMs: number): string {
  const centralMs = utcMs - CENTRAL_OFFSET_MS;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date(centralMs).getUTCDay()];
}

// ── Types ─────────────────────────────────────────────────────────────────────
type CheckPostAllowedRequest = {
  useBonus: boolean;
};

type CheckPostAllowedResponse =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited' | 'daily_cap' | 'no_bonus'; availableDay?: string };

// ── Callable ──────────────────────────────────────────────────────────────────
export const checkPostAllowed = onCall<CheckPostAllowedRequest, Promise<CheckPostAllowedResponse>>(
  { enforceAppCheck: false },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const useBonus = !!req.data?.useBonus;

    // Compute day boundaries in Central time (UTC epoch ms)
    const startToday     = startOfCentralDay(0);
    const startYesterday = startOfCentralDay(-1);

    // Count posts today
    const todaySnap = await db
      .collection('Posts')
      .where('author', '==', uid)
      .where('timestamp', '>=', startToday)
      .get();
    const todayCount = todaySnap.size;

    // Count posts yesterday
    const yesterdaySnap = await db
      .collection('Posts')
      .where('author', '==', uid)
      .where('timestamp', '>=', startYesterday)
      .where('timestamp', '<', startToday)
      .get();
    const yesterdayCount = yesterdaySnap.size;

    // ── 5/day hard cap ────────────────────────────────────────────────────────
    if (todayCount >= 5) {
      logger.info('checkPostAllowed: daily cap hit', { uid, todayCount });
      return { allowed: false, reason: 'daily_cap' };
    }

    // ── Rate limit check ──────────────────────────────────────────────────────
    const isRateLimited = todayCount > 0 || yesterdayCount > 0;

    if (isRateLimited) {
      if (!useBonus) {
        // Compute next available day label
        // If posted today → available day after tomorrow; if only yesterday → available tomorrow
        const availableDay = todayCount > 0
          ? dayOfWeekName(startOfCentralDay(2))   // day after tomorrow
          : 'Tomorrow';

        logger.info('checkPostAllowed: rate limited', { uid, todayCount, yesterdayCount, availableDay });
        return { allowed: false, reason: 'rate_limited', availableDay };
      }

      // useBonus === true — attempt atomic bonus deduction
      const userRef = db.collection('users').doc(uid);

      try {
        await db.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);
          const current: number = userSnap.exists
            ? ((userSnap.data() as any)?.bonusPosts ?? 3)
            : 3;

          if (current <= 0) {
            throw new HttpsError('resource-exhausted', 'no_bonus');
          }

          // Also enforce the 5/day cap for bonus posts
          if (todayCount >= 5) {
            throw new HttpsError('resource-exhausted', 'daily_cap');
          }

          tx.set(userRef, { bonusPosts: current - 1 }, { merge: true });
        });
      } catch (e: any) {
        if (e instanceof HttpsError) {
          const reason = e.message === 'no_bonus' ? 'no_bonus' : 'daily_cap';
          logger.info('checkPostAllowed: bonus blocked', { uid, reason });
          return { allowed: false, reason };
        }
        logger.error('checkPostAllowed: transaction error', { uid, e });
        throw new HttpsError('internal', 'Could not process bonus post.');
      }

      logger.info('checkPostAllowed: bonus used', { uid });
      return { allowed: true };
    }

    // ── Not rate-limited — free post ──────────────────────────────────────────
    logger.info('checkPostAllowed: allowed (free)', { uid, todayCount, yesterdayCount });
    return { allowed: true };
  }
);
