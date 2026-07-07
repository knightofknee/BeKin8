// functions/src/redeemInvite.ts
// Referral invite codes. Two callables:
//   ensureInviteCode() -> { code }   : returns (or generates) the caller's permanent 6-char code.
//   redeemInvite({code}) -> { ok }   : turns an inviter's code into an accepted friendship.
//
// The friendship writes happen server-side (Admin SDK) so this endpoint is the single source of
// truth for invite-created friendships and stays idempotent across concurrent redeems. It mirrors
// the write shape of handleAddBrian() in app/friends.tsx (the legacy Friends arrayUnion uses
// {uid, username} with no timestamp so the union dedupes correctly, keep the shapes identical).
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

/** Returns the caller's permanent invite code, generating + persisting one if needed.
 *  Stored on users/{uid} (OWNER-ONLY readable) + mirrored to Invites/{code} (the code->uid map the
 *  Admin-SDK redeem path reads). Deliberately NOT on the world-readable Profiles doc anymore: a
 *  public invite code is a "force-friend-me" token anyone could read and redeem. A legacy code on
 *  Profiles is migrated here and the public copy cleared. Lock the Invites collection in the console
 *  rules (allow read: if false) so the map can't be enumerated; the Admin SDK bypasses rules. */
export const ensureInviteCode = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const userRef = db.collection('users').doc(uid);
  const profRef = db.collection('Profiles').doc(uid);
  const [userSnap, profSnap] = await Promise.all([userRef.get(), profRef.get()]);
  const userData = userSnap.exists ? (userSnap.data() as any) : null;
  const profData = profSnap.exists ? (profSnap.data() as any) : null;

  // Migrate a legacy world-readable Profiles.inviteCode into the owner-only users doc, then always
  // strip the public copy (the Profile exists here, so the field-delete removes only the field).
  let existingCode: string | undefined =
    userData?.inviteCode && CODE_RE.test(String(userData.inviteCode)) ? String(userData.inviteCode) : undefined;
  const legacyCode =
    profData?.inviteCode && CODE_RE.test(String(profData.inviteCode)) ? String(profData.inviteCode) : undefined;
  if (!existingCode && legacyCode) {
    existingCode = legacyCode;
    await userRef.set({ inviteCode: existingCode }, { merge: true });
  }
  if (profSnap.exists && profData?.inviteCode) {
    await profRef.set({ inviteCode: FieldValue.delete() }, { merge: true }).catch(() => {});
  }
  if (existingCode) {
    return { code: existingCode };
  }

  // A code maps to a friendable identity and the redeem writes the inviter's username into friend
  // docs, so never issue one before the user has a username.
  if (!cleanName(profData?.username) && !cleanName(userData?.username)) {
    throw new HttpsError('failed-precondition', 'Set a username before sharing an invite.');
  }

  // Generate-and-check, retrying on the rare collision.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode();
    const result = await db.runTransaction(async (tx) => {
      // All reads before any writes.
      const uSnap = await tx.get(userRef);
      const uCode = uSnap.exists ? (uSnap.data() as any)?.inviteCode : null;
      if (uCode && CODE_RE.test(String(uCode))) return String(uCode); // concurrent winner
      const inviteRef = db.collection('Invites').doc(code);
      const invSnap = await tx.get(inviteRef);
      if (invSnap.exists) return null; // collision, retry with a new code
      tx.set(inviteRef, { uid, createdAt: FieldValue.serverTimestamp() });
      tx.set(userRef, { inviteCode: code, inviteCodeAt: FieldValue.serverTimestamp() }, { merge: true });
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
  // consistent snapshot, so a username-less inviter doesn't write a blank-vs-uid mismatch.
  const meProfRef = db.collection('Profiles').doc(meUid);
  const meUserRef = db.collection('users').doc(meUid);
  const invProfRef = db.collection('Profiles').doc(inviterUid);
  const invUserRef = db.collection('users').doc(inviterUid);

  // Block docs: sharing the code is consent, but a block in EITHER direction overrides
  // it. Read both inside the transaction (all reads before writes) so a concurrent block
  // can't race in after the check.
  const meBlockRef = db.collection('users').doc(meUid).collection('blocks').doc(inviterUid);
  const invBlockRef = db.collection('users').doc(inviterUid).collection('blocks').doc(meUid);

  const outcome = await db.runTransaction(async (tx) => {
    const edgeSnap = await tx.get(edgeRef);
    if (edgeSnap.exists && (edgeSnap.data() as any)?.state === 'accepted') {
      return { status: 'already' as const, inviterUsername: '' };
    }
    const [meBlock, invBlock] = await Promise.all([
      tx.get(meBlockRef),
      tx.get(invBlockRef),
    ]);
    if (meBlock.exists || invBlock.exists) {
      return { status: 'blocked' as const, inviterUsername: '' };
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

  if (outcome.status === 'blocked') return { ok: false, error: 'BLOCKED' };
  if (outcome.status === 'already') return { ok: true, already: true, inviterUid };
  logger.info('redeemInvite: friendship created', { meUid, inviterUid, code });
  return { ok: true, inviterUid, inviterUsername: outcome.inviterUsername };
});
