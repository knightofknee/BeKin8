// functions/src/username.ts
// assignDefaultUsername(): gives a brand-new account a username straight away, so the friend link
// and add-by-username work from the first second and setup has one less chore. The name comes from
// the person's real name (Google / Apple) or, failing that, the front of their email. A taken name
// gets the next number: Brian, Brian2, Brian3, so the number says how many came before. It is a
// starting point only: the Friends screen lets them change it.
//
// Uniqueness is the same Usernames/{lower} reservation the client rename path uses (first writer
// wins); UsernameCounters/{baseLower}.next remembers where each base name's numbering is up to.
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const MAX_BASE = 16; // leaves room for a number inside the app's 20-char username limit
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const alnum = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '');
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Brian Carlisle" -> "Brian"; a very short first name borrows the last ("Al Green" -> "AlGreen"). */
function baseFromName(fullName: string): string {
  const parts = fullName.split(/\s+/).map(alnum).filter(Boolean);
  if (!parts.length) return '';
  let base = cap(parts[0]);
  if (base.length < 3 && parts.length > 1) base += cap(parts[parts.length - 1]);
  return base.length >= 3 && !/^\d+$/.test(base) ? base.slice(0, MAX_BASE) : '';
}

/** "john.smith+x@mail.com" -> "john_smith". Apple's relay addresses are random, so never used. */
function baseFromEmail(email: string): string {
  if (!email || /@privaterelay\.appleid\.com$/i.test(email)) return '';
  const local = email.split('@')[0].split('+')[0];
  const base = local
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_BASE)
    .replace(/_+$/g, '');
  return base.length >= 3 && !/^\d+$/.test(base) ? base : '';
}

export const assignDefaultUsername = onCall({ enforceAppCheck: true }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const profRef = db.collection('Profiles').doc(uid);
  const userRef = db.collection('users').doc(uid);

  // The name hint is client-supplied (Apple only hands the name to the device, once). It only ever
  // names the caller's own account and still passes through the same cleaning, so it grants nothing.
  const tokenName = clean((req.auth?.token as any)?.name);
  const hint = clean(req.data?.nameHint).slice(0, 60);
  const fullName = tokenName || hint;
  const email = clean((req.auth?.token as any)?.email);
  const base = baseFromName(fullName) || baseFromEmail(email) || 'Friend';
  const baseLower = base.toLowerCase();
  const counterRef = db.collection('UsernameCounters').doc(baseLower);

  const result = await db.runTransaction(async (tx) => {
    const [profSnap, userSnap, counterSnap] = await Promise.all([tx.get(profRef), tx.get(userRef), tx.get(counterRef)]);
    const prof = (profSnap.data() as any) ?? {};
    const existing = clean(prof.username) || clean((userSnap.data() as any)?.username);
    if (existing) return { username: existing, assigned: false };

    const start = Math.max(1, Number((counterSnap.data() as any)?.next) || 1);
    for (let n = start; n < start + 40; n++) {
      const cand = n === 1 ? base : `${base}${n}`;
      const candLower = cand.toLowerCase();
      const resRef = db.collection('Usernames').doc(candLower);
      // Taken = reserved, OR held by a profile from before reservations existed.
      const [resSnap, legacy] = await Promise.all([
        tx.get(resRef),
        tx.get(db.collection('Profiles').where('usernameLower', '==', candLower).limit(1)),
      ]);
      if (resSnap.exists || !legacy.empty) continue;

      tx.set(resRef, { uid, username: cand, auto: true, createdAt: FieldValue.serverTimestamp() });
      tx.set(counterRef, { next: n + 1 }, { merge: true });
      tx.set(
        profRef,
        {
          username: cand,
          usernameLower: candLower,
          // A real name, when we have one, becomes the display name friends see (editable).
          ...(fullName && !clean(prof.displayName) ? { displayName: fullName.slice(0, 40) } : {}),
        },
        { merge: true }
      );
      tx.set(userRef, { username: cand, hasUsername: true, usernameAuto: true }, { merge: true });
      return { username: cand, assigned: true };
    }
    return null;
  });

  if (!result) throw new HttpsError('resource-exhausted', 'Could not find a free username.');
  if (result.assigned) logger.info('assignDefaultUsername', { uid, username: result.username });
  return result;
});
