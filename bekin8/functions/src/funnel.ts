// functions/src/funnel.ts
// New-user funnel stamps on users/{uid}, written once each by the server so they can't be forged
// or lost to a client that never came back:
//   firstFriendAt          first accepted friendship (any path: link, request, Add Brian)
//   firstBeaconAt          first beacon ever lit
//   firstBeaconReachedAt   first beacon whose push reached at least one friend (+ firstBeaconReach)
//   invitedBy / invitedAt  who brought them in (redeemInvite.ts)
// tools/funnelReport.js reads these into a signup-cohort funnel.
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

/** Set `field` to now on users/{uid} unless it is already set. Never throws. */
export async function markOnce(uid: string, field: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!uid || uid.startsWith('guest_')) return;
  const ref = db.collection('users').doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      // No users doc = not a real account (or deleted): never create one from here.
      if (!snap.exists || (snap.data() as any)?.[field]) return;
      tx.set(ref, { [field]: FieldValue.serverTimestamp(), ...extra }, { merge: true });
    });
  } catch (err) {
    logger.warn('funnel markOnce failed', { uid, field, err });
  }
}
