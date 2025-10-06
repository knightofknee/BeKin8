// functions/src/index.ts
import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

admin.initializeApp();
const db = admin.firestore();

type Beacon = {
  ownerUid: string;
  ownerName?: string | null;
  message?: string;
  details?: string;
  active?: boolean;
  allowedUids?: string[];
  startAt?: FirebaseFirestore.Timestamp;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Helper: get a user's Expo token (adjust to your storage path if different)
async function getExpoToken(uid: string): Promise<string | null> {
  // Try Profiles/{uid}.expoPushToken first
  const prof = await db.collection('Profiles').doc(uid).get();
  const t1 = prof.exists ? (prof.data()?.expoPushToken as string | undefined) : undefined;
  if (t1 && /^ExponentPushToken/.test(t1)) return t1;

  // Fallback to users/{uid}.expoPushToken
  const u = await db.collection('users').doc(uid).get();
  const t2 = u.exists ? (u.data()?.expoPushToken as string | undefined) : undefined;
  if (t2 && /^ExponentPushToken/.test(t2)) return t2;

  return null;
}

// Helper: has recipient enabled notify for this owner?
async function recipientWantsNotify(recipientUid: string, ownerUid: string): Promise<boolean> {
  // We check: users/{recipientUid}/friends/{ownerUid}.notify === true
  const prefDoc = await db
    .collection('users')
    .doc(recipientUid)
    .collection('friends')
    .doc(ownerUid)
    .get();

  const notify = prefDoc.exists ? !!prefDoc.data()?.notify : false;
  return notify;
}

// Compose body text
function summarize(beacon: Beacon): string {
  return (beacon.message || beacon.details || 'A new beacon was lit').toString();
}

// --- Trigger: when an existing Beacon flips from inactive -> active ---
export const onBeaconActivatedNotify = onDocumentUpdated('Beacons/{beaconId}', async (event) => {
  const before = (event.data?.before?.data() as Beacon | undefined) ?? undefined;
  const after = (event.data?.after?.data() as Beacon | undefined) ?? undefined;
  if (!after) return;

  const wasActive = before?.active === true;
  const nowActive = after.active === true;

  // Only fire when it transitions to active
  if (!(nowActive && !wasActive)) return;

  const beaconId = event.params.beaconId;
  const ownerUid = after.ownerUid;
  const allowed = Array.isArray(after.allowedUids) ? after.allowedUids : [];
  const recipients = allowed.filter((u) => u && u !== ownerUid);
  if (recipients.length === 0) return;

  // Filter by per-recipient preferences and fetch tokens
  const eligible: { uid: string; token: string }[] = [];
  await Promise.all(
    recipients.map(async (uid) => {
      const wants = await recipientWantsNotify(uid, ownerUid);
      if (!wants) return;
      const token = await getExpoToken(uid);
      if (token) eligible.push({ uid, token });
    })
  );
  if (eligible.length === 0) return;

  const title = after.ownerName ? `${after.ownerName} lit a beacon` : `A friend lit a beacon`;
  const body = summarize(after);

  await Promise.all(
    eligible.map(async ({ token }) => {
      try {
        const res = await (globalThis as any).fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: token,
            title,
            body,
            data: {
              type: 'beacon',
              beaconId,
              ownerUid,
            },
            sound: 'default',
            priority: 'high',
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          logger.error('Expo push send failed (update)', res.status, txt);
        }
      } catch (err) {
        logger.error('Expo push network error (update)', err);
      }
    })
  );
});

// --- Trigger: when a brand new active Beacon is created ---
export const onBeaconCreatedNotify = onDocumentCreated('Beacons/{beaconId}', async (event) => {
  const b = (event.data?.data() as Beacon | undefined) ?? undefined;
  if (!b || b.active !== true) return;

  const beaconId = event.params.beaconId;
  const ownerUid = b.ownerUid;
  const allowed = Array.isArray(b.allowedUids) ? b.allowedUids : [];
  const recipients = allowed.filter((u) => u && u !== ownerUid);
  if (recipients.length === 0) return;

  // Filter by per-recipient preferences and fetch tokens
  const eligible: { uid: string; token: string }[] = [];
  await Promise.all(
    recipients.map(async (uid) => {
      const wants = await recipientWantsNotify(uid, ownerUid);
      if (!wants) return;
      const token = await getExpoToken(uid);
      if (token) eligible.push({ uid, token });
    })
  );
  if (eligible.length === 0) return;

  const title = b.ownerName ? `${b.ownerName} lit a beacon` : `A friend lit a beacon`;
  const body = summarize(b);

  // Send to Expo
  await Promise.all(
    eligible.map(async ({ token }) => {
      try {
        const res = await (globalThis as any).fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: token,
            title,
            body,
            data: {
              type: 'beacon',
              beaconId,
              ownerUid,
            },
            sound: 'default',
            priority: 'high',
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          logger.error('Expo push send failed (create)', res.status, txt);
        }
      } catch (err) {
        logger.error('Expo push network error (create)', err);
      }
    })
  );
});

export { deleteAccountData } from "./deleteAccount";