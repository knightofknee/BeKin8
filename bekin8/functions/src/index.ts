// functions/src/index.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import {
  Expo,
  ExpoPushMessage,
  ExpoPushTicket,
  ExpoPushSuccessTicket,
} from 'expo-server-sdk';

// ---- Modular Admin init (Node 20 + ESM) ----
const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

// ================== Types ==================
type Beacon = {
  ownerUid: string;
  ownerName?: string | null;
  message?: string;
  details?: string;
  active?: boolean;
  allowedUids?: string[];
  startAt?: FirebaseFirestore.Timestamp;
};

// ===== Expo client & constants =====
const expo = new Expo({ useFcmV1: false });
const TICKET_TTL_HOURS = 48;

// ===== Helpers: content =====
function summarize(beacon: Beacon): string {
  return (beacon.message || beacon.details || 'A new beacon was lit').toString();
}
function titleFor(beacon: Beacon): string {
  return beacon.ownerName ? `${beacon.ownerName} lit a beacon` : 'A friend lit a beacon';
}

// ===== Helpers: preferences & subscribers =====

/** Legacy UI pref: users/{recipientUid}/friends/{ownerUid}.notify === true */
async function legacyNotifyEnabled(recipientUid: string, ownerUid: string): Promise<boolean> {
  const prefDoc = await db
    .collection('users')
    .doc(recipientUid)
    .collection('friends')
    .doc(ownerUid)
    .get();
  return prefDoc.exists ? !!prefDoc.data()?.notify : false;
}

/** New opt-in store: users/{recipientUid}/friendSubscriptions/{ownerUid}.enabled === true */
async function subDocEnabled(recipientUid: string, ownerUid: string): Promise<boolean> {
  const d = await db
    .collection('users')
    .doc(recipientUid)
    .collection('friendSubscriptions')
    .doc(ownerUid)
    .get();
  return d.exists ? !!d.data()?.enabled : false;
}

/** Decide if a recipient should get pushes for ownerUid (new OR legacy flag). */
async function recipientWantsNotify(recipientUid: string, ownerUid: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    subDocEnabled(recipientUid, ownerUid),
    legacyNotifyEnabled(recipientUid, ownerUid),
  ]);
  return a || b;
}

/** All friend UIDs for an owner (from FriendEdges, regardless of state). */
async function friendUidsOf(ownerUid: string): Promise<string[]> {
  // Some documents use `state: 'accepted'`, others have no state at all.
  // Query only by membership and validate client-side.
  const qs = await db
    .collection('FriendEdges')
    .where('uids', 'array-contains', ownerUid)
    .get();

  const out = new Set<string>();
  qs.forEach((doc) => {
    const data = doc.data() as any;
    const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const other = uids[0] === ownerUid ? uids[1] : uids[0];
    if (other && other !== ownerUid) out.add(other);
  });

  return Array.from(out);
}

/** 
 * Eligible = (allowedUids OR all accepted friends if none provided)
 *            ∩ users who opted in (new subdoc OR legacy notify flag)
 *            − ownerUid
 */
async function eligibleRecipients(allowed: string[] | undefined, ownerUid: string): Promise<string[]> {
  // Normalize allowed list (remove falsy, remove owner)
  const normalizedAllowed: string[] = Array.isArray(allowed)
    ? allowed.filter((u): u is string => !!u).filter((u) => u !== ownerUid)
    : [];

  // If no allowed list, fall back to all accepted friends
  const base: string[] = normalizedAllowed.length > 0
    ? normalizedAllowed
    : await friendUidsOf(ownerUid);

  if (base.length === 0) return [];

  const baseSet = new Set(base); // dedupe
  const out: string[] = [];

  await Promise.all(
    Array.from(baseSet).map(async (uid) => {
      if (await recipientWantsNotify(uid, ownerUid)) out.push(uid);
    })
  );

  return out;
}

// ===== Helpers: tokens =====

/** Preferred: users/{uid}/pushTokens/{installationId}.token */
async function getPushTokensFromSubcollection(uid: string): Promise<string[]> {
  const ss = await db.collection('users').doc(uid).collection('pushTokens').get();
  const set = new Set<string>();
  ss.forEach((d) => {
    const tok = String((d.data() as any)?.token || '');
    if (Expo.isExpoPushToken(tok)) set.add(tok);
  });
  return Array.from(set);
}

/** Legacy fallbacks: Profiles/{uid}.expoPushToken, users/{uid}.expoPushToken, users/{uid}.pushToken */
async function getLegacySingleToken(uid: string): Promise<string[]> {
  const out: string[] = [];

  // Profiles/{uid}.expoPushToken
  const prof = await db.collection('Profiles').doc(uid).get();
  const pTok = prof.exists ? (prof.data()?.expoPushToken as string | undefined) : undefined;
  if (pTok && Expo.isExpoPushToken(pTok)) out.push(pTok);

  // users/{uid}.expoPushToken and users/{uid}.pushToken (older)
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const u = userDoc.data() || {};
    const uExpo = u.expoPushToken as string | undefined;
    const uOld  = u.pushToken as string | undefined; // ← State A fallback
    if (uExpo && Expo.isExpoPushToken(uExpo)) out.push(uExpo);
    if (uOld  && Expo.isExpoPushToken(uOld))  out.push(uOld);
  }

  return out;
}

/** Gather all unique Expo tokens for a user (new + legacy). */
async function getAllExpoTokens(uid: string): Promise<string[]> {
  const [multi, legacy] = await Promise.all([
    getPushTokensFromSubcollection(uid),
    getLegacySingleToken(uid),
  ]);
  return Array.from(new Set([...multi, ...legacy]));
}

/** Remove a token from users/{uid}/pushTokens/* and clear legacy single-token fields if they match. */
async function removeTokenEverywhere(userUid: string, token: string) {
  const col = db.collection('users').doc(userUid).collection('pushTokens');
  const snaps = await col.get();

  const batch = db.batch();

  // Delete any subcollection docs that hold this token
  snaps.forEach((docSnap) => {
    if ((docSnap.data() as any)?.token === token) batch.delete(docSnap.ref);
  });

  // Clear legacy fields on users/{uid} if they equal this token
  const userRef = db.collection('users').doc(userUid);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    const u = userSnap.data() || {};
    const userUpdates: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
    if (u.expoPushToken === token) userUpdates['expoPushToken'] = FieldValue.delete();
    if (u.pushToken === token)      userUpdates['pushToken'] = FieldValue.delete();
    if (Object.keys(userUpdates).length > 0) {
      batch.update(userRef, userUpdates);
    }
  }

  // Clear legacy field on Profiles/{uid} if it equals this token
  const profRef = db.collection('Profiles').doc(userUid);
  const profSnap = await profRef.get();
  if (profSnap.exists) {
    const p = profSnap.data() || {};
    const profUpdates: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
    if (p.expoPushToken === token) profUpdates['expoPushToken'] = FieldValue.delete();
    if (Object.keys(profUpdates).length > 0) {
      batch.update(profRef, profUpdates);
    }
  }

  await batch.commit();
}

// ===== Helpers: tickets storage & receipts =====

function isSuccessTicket(t: ExpoPushTicket): t is ExpoPushSuccessTicket {
  return t.status === 'ok';
}

async function saveTickets(
  tickets: ExpoPushTicket[],
  ctx: { subscriberUid: string; friendUid: string; token: string; beaconId: string }
) {
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const t of tickets) {
    if (!isSuccessTicket(t)) continue; // only success tickets have an id
    const ref = db.collection('expoPushTickets').doc(t.id);
    batch.set(
      ref,
      {
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        subscriberUid: ctx.subscriberUid,
        friendUid: ctx.friendUid,
        beaconId: ctx.beaconId,
        token: ctx.token,
      },
      { merge: true }
    );
  }

  await batch.commit();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ===== Core sender =====

async function fanOutForBeacon(beaconId: string, b: Beacon) {
  const ownerUid = b.ownerUid;
  if (!ownerUid) return;

  const recipients = await eligibleRecipients(b.allowedUids, ownerUid);
  logger.info('fanOut recipients', {
    beaconId,
    ownerUid,
    allowedCount: Array.isArray(b.allowedUids) ? b.allowedUids.length : 0,
    recipientCount: recipients.length,
  });
  if (recipients.length === 0) return;

  const body = summarize(b);

  // Prefer Profiles.displayName at send time for the title
  let ownerDisplay = (b.ownerName || "").toString().trim();
  try {
    const profSnap = await db.collection("Profiles").doc(ownerUid).get();
    const dn = profSnap.exists ? (profSnap.data() as any)?.displayName : undefined;
    if (typeof dn === "string" && dn.trim().length > 0) ownerDisplay = dn.trim();
  } catch {}
  const title = ownerDisplay ? `${ownerDisplay} lit a beacon` : "A friend lit a beacon";

  for (const recipientUid of recipients) {
    const tokens = await getAllExpoTokens(recipientUid);
    if (tokens.length === 0) continue;

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      sound: 'default',
      priority: 'high',
      data: { type: 'beacon', beaconId, ownerUid },
    }));

    const chunks = expo.chunkPushNotifications(messages);
    for (const msgs of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(msgs);
        // Align ticket to token (index matched)
        for (let i = 0; i < tickets.length; i++) {
          const t = tickets[i];
          const tok = msgs[i].to as string;
          await saveTickets([t], {
            subscriberUid: recipientUid,
            friendUid: ownerUid,
            token: tok,
            beaconId,
          });
        }
      } catch (err) {
        logger.error('Expo send error', { recipientUid, ownerUid, beaconId, err });
      }
    }
  }
}

// ===== Triggers (v2) =====

// 1) Brand new beacon that starts active
export const onBeaconCreatedNotify = onDocumentCreated('Beacons/{beaconId}', async (event) => {
  const b = (event.data?.data() as Beacon | undefined) ?? undefined;
  if (!b || b.active !== true) return;
  const beaconId = event.params.beaconId as string;
  await fanOutForBeacon(beaconId, b);
});

// 2) Existing beacon flipping inactive -> active
export const onBeaconActivatedNotify = onDocumentUpdated('Beacons/{beaconId}', async (event) => {
  const before = (event.data?.before?.data() as Beacon | undefined) ?? undefined;
  const after = (event.data?.after?.data() as Beacon | undefined) ?? undefined;
  if (!after) return;

  const wasActive = before?.active === true;
  const nowActive = after.active === true;
  if (!(nowActive && !wasActive)) return;

  const beaconId = event.params.beaconId as string;
  await fanOutForBeacon(beaconId, after);
});

// 3) Receipt checker & token pruning (v2 scheduler)
export const checkExpoReceipts = onSchedule('every 15 minutes', async () => {
  const cutoff = Timestamp.fromDate(
    new Date(Date.now() - TICKET_TTL_HOURS * 60 * 60 * 1000)
  );

  const pending = await db
    .collection('expoPushTickets')
    .where('status', '==', 'pending')
    .where('createdAt', '>', cutoff)
    .limit(2000)
    .get();

  if (pending.empty) return;

  const ids: string[] = [];
  const metaById: Record<
    string,
    { ref: FirebaseFirestore.DocumentReference; subscriberUid: string; token: string }
  > = {};

  pending.forEach((d) => {
    ids.push(d.id);
    const data = d.data() as any;
    metaById[d.id] = {
      ref: d.ref,
      subscriberUid: String(data.subscriberUid),
      token: String(data.token),
    };
  });

  for (const idChunk of chunk(ids, 300)) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(idChunk);
      const batch = db.batch();

      for (const id of Object.keys(receipts)) {
        const rec = receipts[id];
        const meta = metaById[id];
        if (!meta) continue;

        if (rec.status === 'ok') {
          batch.update(meta.ref, {
            status: 'ok',
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          batch.update(meta.ref, {
            status: 'error',
            error: rec.message ?? null,
            details: rec.details ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          });

          const code = (rec.details as any)?.error;
          if (code === 'DeviceNotRegistered') {
            await removeTokenEverywhere(meta.subscriberUid, meta.token);
          }
        }
      }

      await batch.commit();
    } catch (err) {
      logger.error('Receipt check error', err);
    }
  }
});

// Keep callable export (ESM requires .js suffix)
export { deleteAccountDataV2 } from './deleteAccountV2.js';