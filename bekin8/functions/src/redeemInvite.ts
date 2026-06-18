// functions/src/redeemInvite.ts
// Referral invite codes. Two callables:
//   ensureInviteCode() -> { code }   : returns (or generates) the caller's permanent 6-char code.
//   redeemInvite({code}) -> { ok }   : turns an inviter's code into an accepted friendship.
//
// The friendship writes happen server-side (Admin SDK) so this endpoint is the single source of
// truth for invite-created friendships and stays idempotent across concurrent redeems. It mirrors
// the write shape of handleAddBrian() in app/friends.tsx (the legacy Friends arrayUnion uses
// {uid, username} with no timestamp so the union dedupes correctly — keep the shapes identical).
import { randomBytes } from 'node:crypto';
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const edgeId = (a: string, b: string) => [a, b].sort().join('_');

// Look-alike-free alphabet (no 0/O, 1/I/L). 31 symbols ^ 6 ≈ 887M codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{6}$/;

function genCode(len = 6): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const cleanName = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/** Returns the caller's permanent invite code, generating + persisting one if needed. */
export const ensureInviteCode = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const profRef = db.collection('Profiles').doc(uid);
  const existing = await profRef.get();
  const data = existing.exists ? (existing.data() as any) : null;
  const existingCode = data?.inviteCode;
  if (existingCode && CODE_RE.test(String(existingCode))) {
    return { code: String(existingCode) };
  }

  // A code maps to a friendable identity and the redeem writes the inviter's username into friend
  // docs — so never issue one before the user has a username.
  if (!cleanName(data?.username)) {
    throw new HttpsError('failed-precondition', 'Set a username before sharing an invite.');
  }

  // Generate-and-check, retrying on the rare collision.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode();
    const result = await db.runTransaction(async (tx) => {
      // All reads before any writes.
      const pSnap = await tx.get(profRef);
      const pCode = pSnap.exists ? (pSnap.data() as any)?.inviteCode : null;
      if (pCode && CODE_RE.test(String(pCode))) return String(pCode); // concurrent winner
      const inviteRef = db.collection('Invites').doc(code);
      const invSnap = await tx.get(inviteRef);
      if (invSnap.exists) return null; // collision — retry with a new code
      tx.set(inviteRef, { uid, createdAt: FieldValue.serverTimestamp() });
      tx.set(profRef, { inviteCode: code, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return code;
    });
    if (result === null) continue;
    return { code: result };
  }

  throw new HttpsError('internal', 'Could not generate an invite code. Please try again.');
});

/** Redeems an inviter's code into an instantly-accepted friendship with the caller. */
export const redeemInvite = onCall({ enforceAppCheck: false }, async (req) => {
  const meUid = req.auth?.uid;
  if (!meUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const code = String(req.data?.code ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { ok: false, error: 'BAD_CODE' };

  const invSnap = await db.collection('Invites').doc(code).get();
  if (!invSnap.exists) return { ok: false, error: 'NOT_FOUND' };
  const inviterUid = String((invSnap.data() as any)?.uid || '');
  if (!inviterUid) return { ok: false, error: 'NOT_FOUND' };
  if (inviterUid === meUid) return { ok: false, error: 'SELF' };

  const edgeRef = db.collection('FriendEdges').doc(edgeId(meUid, inviterUid));
  const now = FieldValue.serverTimestamp();

  // Whole thing in one transaction so concurrent redeems for the same pair can't both pass the
  // idempotency guard. Usernames resolved INSIDE the tx (Profiles, falling back to users) for a
  // consistent snapshot — so a username-less inviter doesn't write a blank-vs-uid mismatch.
  const meProfRef = db.collection('Profiles').doc(meUid);
  const meUserRef = db.collection('users').doc(meUid);
  const invProfRef = db.collection('Profiles').doc(inviterUid);
  const invUserRef = db.collection('users').doc(inviterUid);

  const outcome = await db.runTransaction(async (tx) => {
    const edgeSnap = await tx.get(edgeRef);
    if (edgeSnap.exists && (edgeSnap.data() as any)?.state === 'accepted') {
      return { status: 'already' as const, inviterUsername: '' };
    }
    const [meP, meU, invP, invU] = await Promise.all([
      tx.get(meProfRef),
      tx.get(meUserRef),
      tx.get(invProfRef),
      tx.get(invUserRef),
    ]);
    const myUsername = cleanName((meP.data() as any)?.username) || cleanName((meU.data() as any)?.username);
    const inviterUsername =
      cleanName((invP.data() as any)?.username) || cleanName((invU.data() as any)?.username);

    tx.set(edgeRef, { uids: [meUid, inviterUid], state: 'accepted', createdAt: now, updatedAt: now }, { merge: true });
    tx.set(
      db.collection('users').doc(meUid).collection('friends').doc(inviterUid),
      { uid: inviterUid, username: inviterUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('users').doc(inviterUid).collection('friends').doc(meUid),
      { uid: meUid, username: myUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(meUid),
      { friends: FieldValue.arrayUnion({ uid: inviterUid, username: inviterUsername }) },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(inviterUid),
      { friends: FieldValue.arrayUnion({ uid: meUid, username: myUsername }) },
      { merge: true }
    );
    return { status: 'created' as const, inviterUsername };
  });

  if (outcome.status === 'already') return { ok: true, already: true, inviterUid };
  logger.info('redeemInvite: friendship created', { meUid, inviterUid, code });
  return { ok: true, inviterUid, inviterUsername: outcome.inviterUsername };
});
