// functions/src/deferredInvite.ts
// iOS deferred attribution for friend links. Apple passes NOTHING through an App Store install,
// so the waldgrave.com landing page records each invite-link visit here (code + hashed IP), and
// the app claims it on its first signed-in launch by matching the caller's IP. The app shows a
// "Connect with @X?" confirm before redeeming: an IP match is strong evidence, not proof (shared
// WiFi). Android does not use this path (the Play Install Referrer is deterministic there).
//
//   recordInviteVisit  (HTTPS POST, called by the landing page; no auth)
//   claimInviteVisit   (callable, auth required; one-shot per visit doc)
//
// InviteVisits docs are keyed ipHash_code (each new tap refreshes the pair's timestamp), carry a
// 2h expiry, and are cleaned up lazily on expiry. A visit is NOT consumed on claim: a group
// sharing one link in a room means several installs from the same network, and every one of them
// should auto-connect for as long as the visit lives. Clients never touch the collection (rules
// catch-all denies; the Admin SDK here bypasses rules). Raw IPs are never stored, only salted hashes.
import { createHash } from 'node:crypto';
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const CODE_RE = /^[A-Z0-9]{6}$/;
// 24h: long enough that "tapped the link, installed the next morning" still auto-connects, short
// enough that a cafe/office network doesn't keep auto-friending strangers indefinitely.
const VISIT_TTL_MS = 24 * 60 * 60 * 1000;
const cleanName = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Salted hash so the collection never holds raw IPs. The salt is a constant, not a secret vault
// entry: the collection is Admin-only, the hash just keeps addresses out of plain sight.
const ipHash = (ip: string) => createHash('sha256').update(`bekin-invite-visit|${ip}`).digest('hex');

function callerIp(headers: Record<string, unknown>, fallback?: string): string {
  const fwd = String(headers['x-forwarded-for'] ?? '');
  const first = fwd.split(',')[0]?.trim();
  return first || fallback || '';
}

/** Landing-page beacon: remember that this IP saw this invite code just now. */
export const recordInviteVisit = onRequest(
  { cors: ['https://www.waldgrave.com', 'https://waldgrave.com'] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    const code = String((req.body as any)?.code ?? '').trim().toUpperCase();
    const ip = callerIp(req.headers as Record<string, unknown>, req.ip);
    // Silently accept junk: this is a fire-and-forget beacon, nothing useful to report back.
    if (!CODE_RE.test(code) || !ip) {
      res.status(204).end();
      return;
    }
    const hash = ipHash(ip);
    await db.collection('InviteVisits').doc(`${hash}_${code}`).set({
      code,
      ipHash: hash,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + VISIT_TTL_MS),
    });
    res.status(204).end();
  }
);

/** First-launch claim: EVERY live visit matching the caller's IP is returned (claim-all). In a
 *  room where several people share their links, the newcomer connects with all of the sharers,
 *  not a timing-lucky one. Visits stay live for further claimers until they expire. */
export const claimInviteVisit = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const ip = callerIp(req.rawRequest.headers as Record<string, unknown>, req.rawRequest.ip);
  if (!ip) return { invites: [] };

  // No orderBy: keeps this index-free. The per-IP doc count is tiny (one per code visited);
  // newest-first ordering is applied in memory below.
  const snap = await db.collection('InviteVisits').where('ipHash', '==', ipHash(ip)).limit(10).get();
  if (snap.empty) return { invites: [] };

  const nowMs = Date.now();
  const docs = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as any }))
    .sort((a, b) => (b.data?.createdAt?.toMillis?.() ?? 0) - (a.data?.createdAt?.toMillis?.() ?? 0));

  const invites: Array<{ code: string; inviterUsername: string }> = [];
  const seenCodes = new Set<string>();
  for (const { ref, data } of docs) {
    const expMs = data?.expiresAt?.toMillis?.() ?? 0;
    if (expMs < nowMs) {
      ref.delete().catch(() => {}); // lazy expiry cleanup
      continue;
    }
    const code = String(data?.code ?? '');
    if (!CODE_RE.test(code) || seenCodes.has(code)) continue;
    seenCodes.add(code);

    // Resolve the inviter; skip dead codes and self-invites (the inviter reinstalling on the
    // same network must not be offered their own link).
    const invSnap = await db.collection('Invites').doc(code).get();
    const inviterUid = invSnap.exists ? String((invSnap.data() as any)?.uid ?? '') : '';
    if (!inviterUid || inviterUid === uid) continue;
    const profSnap = await db.collection('Profiles').doc(inviterUid).get();
    const inviterUsername = cleanName((profSnap.data() as any)?.username);

    // Visits are deliberately NOT deleted on claim: they serve every install from this network
    // until expiry, so a whole group tapping one link all auto-connect (redeem is idempotent).
    invites.push({ code, inviterUsername });
    if (invites.length >= 5) break; // sanity cap
  }
  if (invites.length) logger.info('claimInviteVisit: match', { uid, codes: invites.map((i) => i.code) });
  return { invites };
});
