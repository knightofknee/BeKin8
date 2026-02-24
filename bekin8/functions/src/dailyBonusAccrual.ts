// functions/src/dailyBonusAccrual.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

// ── Central-time helpers ──────────────────────────────────────────────────────
const CENTRAL_OFFSET_MS = 6 * 60 * 60 * 1000;

function startOfCentralDay(offsetDays = 0): number {
  const nowCentral = Date.now() - CENTRAL_OFFSET_MS;
  const d = new Date(nowCentral);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.getTime() + CENTRAL_OFFSET_MS;
}

/** Returns today's date string in Central time as "YYYY-MM-DD". */
function todayCentralStr(): string {
  const nowCentral = Date.now() - CENTRAL_OFFSET_MS;
  const d = new Date(nowCentral);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Calendar days between two "YYYY-MM-DD" strings. */
function calendarDaysBetween(earlier: string, later: string): number {
  const a = new Date(`${earlier}T00:00:00Z`).getTime();
  const b = new Date(`${later}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Runs at 6:00 UTC = midnight Central Standard Time.
// During CDT (summer) this fires at 1am Central, which is acceptable.
export const dailyBonusAccrual = onSchedule('0 6 * * *', async () => {
  const todayStr = todayCentralStr();

  // "Day before yesterday" start — used as the 2-day post lookback window
  const startDayBeforeYesterday = startOfCentralDay(-2);

  logger.info('dailyBonusAccrual: starting', { todayStr, startDayBeforeYesterday });

  const PAGE_SIZE = 500;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let totalSeeded = 0;
  let totalIncremented = 0;
  let totalSkipped = 0;

  while (true) {
    // Page through users collection
    let q = db.collection('users').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc) as typeof q;

    const usersSnap = await q.get();
    if (usersSnap.empty) break;

    // Collect updates for this page
    const batch = db.batch();
    let batchHasWrites = false;

    await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const uid = userDoc.id;
        const data = userDoc.data() as any;
        const bonusPosts: number | undefined = data?.bonusPosts;
        const lastAccrual: string | undefined = data?.lastBonusAccrualDate;

        // ── Seed case: bonusPosts missing ───────────────────────────────────
        if (bonusPosts === undefined || bonusPosts === null) {
          batch.set(userDoc.ref, {
            bonusPosts: 3,
            lastBonusAccrualDate: todayStr,
          }, { merge: true });
          batchHasWrites = true;
          totalSeeded++;
          return; // no additional increment on seed day
        }

        // ── Already accrued today ──────────────────────────────────────────
        if (lastAccrual === todayStr) {
          totalSkipped++;
          return;
        }

        // ── 2-day cadence check ────────────────────────────────────────────
        if (lastAccrual) {
          const daysSinceLast = calendarDaysBetween(lastAccrual, todayStr);
          if (daysSinceLast < 2) {
            totalSkipped++;
            return;
          }
        }
        // If lastAccrual is missing but bonusPosts exists (edge case): treat as
        // never accrued → allow if post window is clear.

        // ── Post lookback: did they post in the past 2 calendar days? ──────
        const recentPostsSnap = await db
          .collection('Posts')
          .where('author', '==', uid)
          .where('timestamp', '>=', startDayBeforeYesterday)
          .limit(1)
          .get();

        if (!recentPostsSnap.empty) {
          totalSkipped++;
          return; // posted recently — don't accrue
        }

        // ── Both conditions satisfied → increment ──────────────────────────
        const newBonus = Math.min((bonusPosts as number) + 1, 10);
        batch.set(userDoc.ref, {
          bonusPosts: newBonus,
          lastBonusAccrualDate: todayStr,
        }, { merge: true });
        batchHasWrites = true;
        totalIncremented++;
      })
    );

    if (batchHasWrites) await batch.commit();

    lastDoc = usersSnap.docs[usersSnap.docs.length - 1];
    if (usersSnap.size < PAGE_SIZE) break;
  }

  logger.info('dailyBonusAccrual: done', { todayStr, totalSeeded, totalIncremented, totalSkipped });
});
