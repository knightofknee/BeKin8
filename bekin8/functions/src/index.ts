// functions/src/index.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
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
  groupIds?: string[];
  startAt?: FirebaseFirestore.Timestamp;
};

// ===== Expo client & constants =====
const expo = new Expo();
const TICKET_TTL_HOURS = 48;
// Rapid off/on toggles of the same beacon shouldn't re-notify. If the last activation
// push for a beacon went out within this window, skip re-fanout.
const BEACON_NOTIFY_COOLDOWN_MS = 3 * 60 * 1000;

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

/** Check if recipient has the master "notify all beacons" toggle enabled. */
async function notifyAllEnabled(recipientUid: string): Promise<boolean> {
  const profileDoc = await db.collection('Profiles').doc(recipientUid).get();
  return profileDoc.exists ? !!profileDoc.data()?.notifyAllBeacons : false;
}

/** Decide if a recipient should get pushes for ownerUid (master toggle, new, OR legacy flag). */
async function recipientWantsNotify(recipientUid: string, ownerUid: string): Promise<boolean> {
  const [all, a, b] = await Promise.all([
    notifyAllEnabled(recipientUid),
    subDocEnabled(recipientUid, ownerUid),
    legacyNotifyEnabled(recipientUid, ownerUid),
  ]);
  return all || a || b;
}

/**
 * True if EITHER user has blocked the other (users/{a}/blocks/{b} OR users/{b}/blocks/{a}).
 * A block in either direction suppresses notifications between the pair.
 */
async function eitherBlocked(a: string, b: string): Promise<boolean> {
  const [aBlocksB, bBlocksA] = await db.getAll(
    db.collection('users').doc(a).collection('blocks').doc(b),
    db.collection('users').doc(b).collection('blocks').doc(a)
  );
  return aBlocksB.exists || bBlocksA.exists;
}

/**
 * All ACCEPTED friend UIDs for an owner (from FriendEdges).
 * Mirrors acceptedFriendUidsOf in friendsOfFriends.ts: notifications must not reach
 * pending/blocked/legacy edges. We query by membership only (no state filter, to avoid
 * a required composite index) and treat a MISSING state field as accepted for backward
 * compat with legacy edges that predate the `state` field. Edges with an explicit
 * non-accepted state are dropped.
 */
async function friendUidsOf(ownerUid: string): Promise<string[]> {
  const qs = await db
    .collection('FriendEdges')
    .where('uids', 'array-contains', ownerUid)
    .get();

  const out = new Set<string>();
  qs.forEach((doc) => {
    const data = doc.data() as any;
    const state = data?.state;
    // Missing state => legacy edge, treat as accepted. Present state must equal 'accepted'.
    if (state !== undefined && state !== 'accepted') return;
    const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const other = uids[0] === ownerUid ? uids[1] : uids[0];
    if (other && other !== ownerUid) out.add(other);
  });

  return Array.from(out);
}

/** Resolve the member uids of the owner's OWN groups, server-side (Admin SDK). This is what lets the
 *  client stop publishing the friend uid list (allowedUids) into the world-readable Beacon doc: the
 *  audience is derived here from the private FriendGroups instead. Only the owner's own groups count,
 *  and the owner is never a recipient. An empty/missing group (e.g. the tutorial test group) yields
 *  no one. */
async function membersOfGroups(ownerUid: string, groupIds: string[]): Promise<string[]> {
  const out = new Set<string>();
  await Promise.all(
    groupIds.map(async (gid) => {
      if (!gid) return;
      try {
        const snap = await db.collection('FriendGroups').doc(gid).get();
        if (!snap.exists) return;
        const data = snap.data() as any;
        if (data?.ownerUid !== ownerUid) return; // never let another owner's group widen the audience
        const members: any[] = Array.isArray(data?.memberUids) ? data.memberUids : [];
        members.forEach((u) => {
          const s = String(u || '');
          if (s && s !== ownerUid) out.add(s);
        });
      } catch (e) {
        logger.warn('membersOfGroups: failed reading group', { gid, e });
      }
    })
  );
  return Array.from(out);
}

/**
 * Eligible = (group members resolved server-side, OR all accepted friends if unscoped)
 *            ∩ users who opted in (new subdoc OR legacy notify flag)
 *            − ownerUid
 */
async function eligibleRecipients(
  allowed: string[] | undefined,
  ownerUid: string,
  groupIds?: string[]
): Promise<string[]> {
  // Normalize any legacy client-written allowed list (remove falsy, remove owner). New beacons no
  // longer write allowedUids (it leaked the friend graph in a world-readable doc), so this is only a
  // back-compat path for beacon docs written before the switch.
  const normalizedAllowed: string[] = Array.isArray(allowed)
    ? allowed.filter((u): u is string => !!u).filter((u) => u !== ownerUid)
    : [];

  // A beacon with groupIds is SCOPED to exactly those groups. Resolve the audience from the owner's
  // FriendGroups here (private) rather than trusting a client-published uid list, so an empty group
  // (e.g. the "test" group with no members) notifies NO ONE. Only an UNSCOPED beacon (no groups =
  // "all friends") falls back to the full friend list. Legacy docs that still carry allowedUids are
  // honored verbatim.
  const scoped = Array.isArray(groupIds) && groupIds.length > 0;
  const base: string[] = scoped
    ? normalizedAllowed.length > 0
      ? normalizedAllowed
      : await membersOfGroups(ownerUid, groupIds as string[])
    : normalizedAllowed.length > 0
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

/**
 * Gather all unique Expo tokens for a user.
 * Reads only from the canonical per-installation subcollection. Legacy single-token
 * fields (Profiles.expoPushToken, users.expoPushToken, users.pushToken) are no longer
 * read, they were causing duplicate sends when a uid had stale entries in multiple
 * legacy locations alongside the modern subcollection token.
 */
async function getAllExpoTokens(uid: string): Promise<string[]> {
  return getPushTokensFromSubcollection(uid);
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

/**
 * Write Expo push tickets in chunked batches (<=500 writes per commit) instead of one
 * commit per ticket. Callers pass pre-filtered success entries (only success tickets carry
 * an id). Document shape matches saveTickets() exactly.
 */
async function saveTicketsBatched(
  items: { id: string; subscriberUid: string; token: string }[],
  friendUid: string,
  beaconId: string
) {
  if (items.length === 0) return;
  const now = FieldValue.serverTimestamp();
  for (const group of chunk(items, 500)) {
    const batch = db.batch();
    for (const it of group) {
      batch.set(
        db.collection('expoPushTickets').doc(it.id),
        {
          createdAt: now,
          updatedAt: now,
          status: 'pending',
          subscriberUid: it.subscriberUid,
          friendUid,
          beaconId,
          token: it.token,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

// ===== Core sender =====

async function fanOutForBeacon(beaconId: string, b: Beacon) {
  const ownerUid = b.ownerUid;
  if (!ownerUid) return;

  // Cooldown: skip if this beacon already fanned out within the window (guards against
  // rapid off/on toggles re-notifying everyone). Read lastNotifiedAt fresh, then stamp it
  // before sending so concurrent/immediate re-triggers see it.
  const beaconRef = db.collection('Beacons').doc(beaconId);
  try {
    const snap = await beaconRef.get();
    const last = snap.exists ? (snap.data() as any)?.lastNotifiedAt : undefined;
    const lastMs =
      last && typeof last.toMillis === 'function' ? last.toMillis() : 0;
    if (lastMs && Date.now() - lastMs < BEACON_NOTIFY_COOLDOWN_MS) {
      logger.info('fanOut skipped by cooldown', { beaconId, ownerUid });
      return;
    }
  } catch (err) {
    logger.warn('fanOut cooldown read failed, proceeding', { beaconId, err });
  }
  // Stamp before sending so a near-simultaneous re-activation is suppressed.
  try {
    await beaconRef.set({ lastNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (err) {
    logger.warn('fanOut cooldown stamp failed, proceeding', { beaconId, err });
  }

  const recipients = await eligibleRecipients(b.allowedUids, ownerUid, b.groupIds);
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

  // Build one flat message list across every recipient/token, then send + write tickets in
  // batches. This packs up to 100 messages per Expo HTTP round trip (via chunkPushNotifications)
  // instead of one round trip per token, and commits tickets in <=500-op batches instead of one
  // commit per ticket. It does NOT change who receives, only how the sends are packed.
  const messages: ExpoPushMessage[] = [];
  const messageSubscriber: string[] = []; // parallel to messages: subscriberUid per message

  for (const recipientUid of recipients) {
    const tokens = await getAllExpoTokens(recipientUid);
    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
        data: { type: 'beacon', beaconId, ownerUid },
      });
      messageSubscriber.push(recipientUid);
    }
  }

  if (messages.length === 0) return;

  // chunkPushNotifications preserves message order, so a running index maps each returned
  // ticket back to the subscriber/token that produced it.
  const sent: { id: string; subscriberUid: string; token: string }[] = [];
  let sentIndex = 0;
  for (const msgChunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(msgChunk);
      for (let i = 0; i < msgChunk.length; i++) {
        const t = tickets[i];
        if (t && isSuccessTicket(t)) {
          sent.push({
            id: t.id,
            subscriberUid: messageSubscriber[sentIndex + i],
            token: msgChunk[i].to as string,
          });
        }
      }
    } catch (err) {
      logger.error('Expo send error', { ownerUid, beaconId, err });
    }
    sentIndex += msgChunk.length;
  }

  await saveTicketsBatched(sent, ownerUid, beaconId);
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

// ===== 4) Beacon chatroom notifications: new comment OR new RSVP =====

type ChatMessage = {
  text?: string;
  authorUid?: string;
  authorName?: string;
  type?: 'user' | 'system';
  subtype?: string;
  // RSVP system messages ('im-in') carry the actor instead of an author.
  actorUid?: string;
  actorName?: string;
  // GIF messages carry no text; the push body is generated from the kind.
  kind?: 'text' | 'gif';
};

/** RSVP comment notify: users/{uid}.commentNotify */
async function wantsCommentNotify(uid: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? !!(snap.data() as any)?.commentNotify : false;
}

/** Own-post comment notify: Profiles/{uid}.postCommentNotify */
async function wantsPostCommentNotify(uid: string): Promise<boolean> {
  const snap = await db.collection('Profiles').doc(uid).get();
  return snap.exists ? !!(snap.data() as any)?.postCommentNotify : false;
}

/** Comments-on-comments notify: Profiles/{uid}.commentOnCommentNotify */
async function wantsCommentOnCommentNotify(uid: string): Promise<boolean> {
  const snap = await db.collection('Profiles').doc(uid).get();
  return snap.exists ? !!(snap.data() as any)?.commentOnCommentNotify : false;
}

/** New-post notify: Profiles/{uid}.newPostNotify */
async function wantsNewPostNotify(uid: string): Promise<boolean> {
  const snap = await db.collection('Profiles').doc(uid).get();
  return snap.exists ? !!(snap.data() as any)?.newPostNotify : false;
}

/** Check if user has silenced notifications for a specific post. */
async function hasSilencedPost(uid: string, postId: string): Promise<boolean> {
  const snap = await db.collection('users').doc(uid).collection('silencedPosts').doc(postId).get();
  return snap.exists;
}

/** Get UIDs who have commented on a post (deduped, excludes deleted comments). */
async function getCommentAuthorUids(postId: string): Promise<string[]> {
  const qs = await db
    .collection('Posts')
    .doc(postId)
    .collection('comments')
    .get();
  const uids = new Set<string>();
  qs.forEach((d) => {
    const data = d.data() as any;
    if (data?.deleted === true) return;
    const uid = typeof data?.authorUid === 'string' ? data.authorUid : null;
    if (uid) uids.add(uid);
  });
  return Array.from(uids);
}

/** Get UIDs who RSVP'd ("I'm in") on a beacon. */
async function getRsvpUids(beaconId: string): Promise<string[]> {
  const qs = await db
    .collection('Beacons')
    .doc(beaconId)
    .collection('ChatMessages')
    .where('type', '==', 'system')
    .where('subtype', '==', 'im-in')
    .get();

  const uids = new Set<string>();
  qs.forEach((d) => {
    const actorUid = (d.data() as any)?.actorUid;
    if (typeof actorUid === 'string' && actorUid) uids.add(actorUid);
  });
  return Array.from(uids);
}

export const onBeaconCommentNotify = onDocumentCreated(
  'Beacons/{beaconId}/ChatMessages/{messageId}',
  async (event) => {
    const msg = (event.data?.data() as ChatMessage | undefined) ?? undefined;
    if (!msg) return;

    // Two kinds of events fire notifications:
    //   - regular user comment (msg.type !== 'system')
    //   - RSVP system message ('im-in')
    // Other system messages are ignored.
    const isRsvp = msg.type === 'system' && msg.subtype === 'im-in';
    const isComment = msg.type !== 'system';
    if (!isRsvp && !isComment) return;

    // The "sender" is whoever triggered the message:
    //   - for comments, the author
    //   - for RSVPs, the actor (the person saying "I'm in")
    const senderUid = isRsvp ? msg.actorUid : msg.authorUid;
    const senderName = (isRsvp ? msg.actorName : msg.authorName) || 'Someone';
    if (!senderUid) return;

    const beaconId = event.params.beaconId as string;
    const messageId = event.params.messageId as string;

    // Get beacon to find owner
    const beaconSnap = await db.collection('Beacons').doc(beaconId).get();
    if (!beaconSnap.exists) return;
    const beacon = beaconSnap.data() as Beacon;
    const ownerUid = beacon.ownerUid;

    // Collect candidate recipients
    const rsvpUids = await getRsvpUids(beaconId);
    const rsvpSet = new Set(rsvpUids);
    rsvpSet.delete(senderUid); // never notify whoever triggered this

    const recipients: string[] = [];

    // Beacon owner: default-on. They created the beacon, they get notified
    // about all activity on it regardless of their commentNotify pref.
    if (ownerUid && ownerUid !== senderUid) {
      recipients.push(ownerUid);
    }

    // Other RSVPers: gated by their commentNotify pref.
    const rsvpCandidates = Array.from(rsvpSet).filter((uid) => uid !== ownerUid);
    await Promise.all(
      rsvpCandidates.map(async (uid) => {
        if (await wantsCommentNotify(uid)) recipients.push(uid);
      })
    );

    if (recipients.length === 0) return;

    // Drop any recipient who has blocked the sender or is blocked by them (either direction).
    const blockChecked = await Promise.all(
      recipients.map(async (uid) => ((await eitherBlocked(uid, senderUid)) ? null : uid))
    );
    const finalRecipients = blockChecked.filter((u): u is string => !!u);
    if (finalRecipients.length === 0) return;
    recipients.length = 0;
    recipients.push(...finalRecipients);

    logger.info('beaconChat fanOut', {
      beaconId,
      kind: isRsvp ? 'rsvp' : 'comment',
      senderUid,
      recipientCount: recipients.length,
    });

    const title = isRsvp
      ? `${senderName} is in for a beacon`
      : `${senderName} commented on a beacon`;
    const body = isRsvp
      ? `Tap to see who's coming.`
      : msg.kind === 'gif'
      ? '🎬 GIF'
      : ((msg.text || '').toString().slice(0, 200) || 'New comment');

    for (const recipientUid of recipients) {
      const tokens = await getAllExpoTokens(recipientUid);
      if (tokens.length === 0) continue;

      const messages: ExpoPushMessage[] = tokens.map((token) => ({
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
        // Both comment + RSVP route to the same chatroom, so the client uses
        // the same deep-link handler. messageId is still useful for RSVPs so
        // the client could in theory scroll to the RSVP line, but most users
        // will just want the room to be open.
        data: { type: 'beacon_comment', beaconId, messageId, authorUid: senderUid },
      }));

      const chunks = expo.chunkPushNotifications(messages);
      for (const msgs of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(msgs);
          for (let i = 0; i < tickets.length; i++) {
            const t = tickets[i];
            const tok = msgs[i].to as string;
            await saveTickets([t], {
              subscriberUid: recipientUid,
              friendUid: senderUid,
              token: tok,
              beaconId,
            });
          }
        } catch (err) {
          logger.error('Beacon chat notify send error', { recipientUid, senderUid, beaconId, err });
        }
      }
    }
  }
);

// ===== 5) Post comment notifications =====

type PostComment = {
  text?: string;
  authorUid?: string;
  authorName?: string;
  deleted?: boolean;
};

export const onPostCommentNotify = onDocumentCreated(
  'Posts/{postId}/comments/{commentId}',
  async (event) => {
    const comment = (event.data?.data() as PostComment | undefined) ?? undefined;
    if (!comment) return;
    if (comment.deleted === true) return;

    const authorUid = comment.authorUid;
    if (!authorUid) return;

    const postId = event.params.postId as string;
    const commentId = event.params.commentId as string;

    // Get post to find owner
    const postSnap = await db.collection('Posts').doc(postId).get();
    if (!postSnap.exists) return;
    const postData = postSnap.data() as any;
    const ownerUid: string | undefined = postData?.author || postData?.authorUid;

    // Honor the post owner's global comments switch: if the owner's Profile explicitly
    // has commentsEnabled === false, comments are off for their posts, so suppress the
    // comment-notification fanout entirely. (Missing/true => allowed.)
    if (ownerUid) {
      try {
        const ownerProf = await db.collection('Profiles').doc(ownerUid).get();
        if (ownerProf.exists && (ownerProf.data() as any)?.commentsEnabled === false) {
          return;
        }
      } catch {
        // best-effort, proceed on read failure
      }
    }

    const recipients: string[] = [];

    // 1) Post owner, uses postCommentNotify pref
    if (ownerUid && ownerUid !== authorUid) {
      if (await wantsPostCommentNotify(ownerUid)) recipients.push(ownerUid);
    }

    // 2) Prior commenters, uses commentOnCommentNotify pref, minus silenced
    const commenterUids = await getCommentAuthorUids(postId);
    const commenterCandidates = commenterUids.filter(
      (uid) => uid !== authorUid && uid !== ownerUid // owner already handled
    );
    await Promise.all(
      commenterCandidates.map(async (uid) => {
        if (!await wantsCommentOnCommentNotify(uid)) return;
        if (await hasSilencedPost(uid, postId)) return;
        recipients.push(uid);
      })
    );

    if (recipients.length === 0) return;

    // Drop any recipient blocked in either direction relative to the comment author.
    const blockChecked = await Promise.all(
      recipients.map(async (uid) => ((await eitherBlocked(uid, authorUid)) ? null : uid))
    );
    const finalRecipients = blockChecked.filter((u): u is string => !!u);
    if (finalRecipients.length === 0) return;
    recipients.length = 0;
    recipients.push(...finalRecipients);

    logger.info('postCommentNotify fanOut', {
      postId,
      authorUid,
      recipientCount: recipients.length,
    });

    const authorName = comment.authorName || 'Someone';
    const body = (comment.text || '').toString().slice(0, 200) || 'New comment';
    const title = `${authorName} commented on a post`;

    for (const recipientUid of recipients) {
      const tokens = await getAllExpoTokens(recipientUid);
      if (tokens.length === 0) continue;

      for (const token of tokens) {
        try {
          const tickets = await expo.sendPushNotificationsAsync([{
            to: token,
            title,
            body,
            sound: 'default',
            priority: 'high',
            channelId: 'default',
            data: { type: 'post_comment', postId, commentId, authorUid },
          }]);
          await saveTickets(tickets, {
            subscriberUid: recipientUid,
            friendUid: authorUid,
            token,
            beaconId: postId, // reusing field for postId
          });
        } catch (err) {
          logger.error('Post comment notify send error', { recipientUid, authorUid, postId, err });
        }
      }
    }
  }
);

// ===== 6) New post notifications =====
// Notify friends who have notifications turned on for the post author.

export const onPostCreatedNotify = onDocumentCreated('Posts/{postId}', async (event) => {
  const postData = (event.data?.data() as any) ?? undefined;
  if (!postData) return;

  const authorUid: string | undefined = postData.author || postData.authorUid;
  if (!authorUid) return;

  const postId = event.params.postId as string;

  // Get all friends, then filter to those who opted in for this author's notifications
  const allFriends = await friendUidsOf(authorUid);
  if (allFriends.length === 0) return;

  // Filter: must have global newPostNotify ON *and* per-friend notifications ON for this author
  const recipients: string[] = [];
  await Promise.all(
    allFriends.map(async (uid) => {
      const [wantsGlobal, wantsFriend] = await Promise.all([
        wantsNewPostNotify(uid),
        recipientWantsNotify(uid, authorUid),
      ]);
      if (wantsGlobal && wantsFriend) recipients.push(uid);
    })
  );

  if (recipients.length === 0) return;

  // Resolve author display name
  let authorName = '';
  try {
    const profSnap = await db.collection('Profiles').doc(authorUid).get();
    if (profSnap.exists) {
      const dn = (profSnap.data() as any)?.displayName;
      if (typeof dn === 'string' && dn.trim()) authorName = dn.trim();
    }
  } catch {}
  if (!authorName) authorName = 'A friend';

  const title = `${authorName} shared a new post`;
  const content = (postData.content || '').toString().slice(0, 200);
  const body = content || 'Check it out';

  logger.info('postCreatedNotify fanOut', {
    postId,
    authorUid,
    recipientCount: recipients.length,
  });

  for (const recipientUid of recipients) {
    const tokens = await getAllExpoTokens(recipientUid);
    if (tokens.length === 0) continue;

    for (const token of tokens) {
      try {
        const tickets = await expo.sendPushNotificationsAsync([{
          to: token,
          title,
          body,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data: { type: 'new_post', postId, authorUid },
        }]);
        await saveTickets(tickets, {
          subscriberUid: recipientUid,
          friendUid: authorUid,
          token,
          beaconId: postId, // reusing field for postId
        });
      } catch (err) {
        logger.error('Post created notify send error', { recipientUid, authorUid, postId, err });
      }
    }
  }
});

// ===== 7) Block user, end friendship bilaterally =====
//
// Trigger: a new doc appears at users/{ownerUid}/blocks/{blockedUid}.
//
// What this does:
//   - Removes the canonical FriendEdge between the pair (so neither side sees
//     the other as a friend, beacon notifications stop, feed query drops them).
//   - Cleans the legacy denorm sources on BOTH sides:
//       users/{ownerUid}/friends/{blockedUid}
//       users/{blockedUid}/friends/{ownerUid}
//       Friends/{ownerUid}.friends array (remove blockedUid)
//       Friends/{blockedUid}.friends array (remove ownerUid)
//   - Cancels any pending FriendRequests in either direction (sets status
//     to 'cancelled' so the client UI hides them).
//
// The block doc itself stays put, that's the source of truth for "owner has
// blocked this uid". To unblock, the owner sends a fresh friend request
// (handled client-side in app/friends.tsx, which deletes the block doc as
// part of the send).

async function removeUidFromFriendsArray(ownerUid: string, uidToRemove: string) {
  const ref = db.collection('Friends').doc(ownerUid);
  const snap = await ref.get();
  if (!snap.exists) return;
  const arr = (snap.data() as any)?.friends;
  if (!Array.isArray(arr)) return;
  const filtered = arr.filter((f: any) => {
    const fUid = typeof f === 'string' ? f : f?.uid;
    return fUid !== uidToRemove;
  });
  if (filtered.length !== arr.length) {
    await ref.set({ friends: filtered }, { merge: true });
  }
}

async function cancelPendingFriendRequests(uidA: string, uidB: string) {
  const reqs = db.collection('FriendRequests');
  const [aToB, bToA] = await Promise.all([
    reqs
      .where('senderUid', '==', uidA)
      .where('receiverUid', '==', uidB)
      .where('status', '==', 'pending')
      .get(),
    reqs
      .where('senderUid', '==', uidB)
      .where('receiverUid', '==', uidA)
      .where('status', '==', 'pending')
      .get(),
  ]);
  const batch = db.batch();
  let touched = 0;
  for (const snap of [aToB, bToA]) {
    snap.forEach((d) => {
      batch.update(d.ref, {
        status: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
        cancelReason: 'user_blocked',
      });
      touched++;
    });
  }
  if (touched > 0) await batch.commit();
}

export const onUserBlocked = onDocumentCreated(
  'users/{ownerUid}/blocks/{blockedUid}',
  async (event) => {
    const ownerUid = event.params.ownerUid as string;
    const blockedUid = event.params.blockedUid as string;
    if (!ownerUid || !blockedUid || ownerUid === blockedUid) return;

    try {
      // 1) Delete every FriendEdge that contains both uids (usually 1, but be defensive).
      const edgesSnap = await db
        .collection('FriendEdges')
        .where('uids', 'array-contains', ownerUid)
        .get();

      const batch = db.batch();
      let edgesToDelete = 0;
      edgesSnap.forEach((doc) => {
        const uids: unknown = (doc.data() as any).uids;
        if (Array.isArray(uids) && uids.includes(blockedUid)) {
          batch.delete(doc.ref);
          edgesToDelete++;
        }
      });

      // 2) Delete the per-side denorm subcollection docs.
      batch.delete(
        db.collection('users').doc(ownerUid).collection('friends').doc(blockedUid)
      );
      batch.delete(
        db.collection('users').doc(blockedUid).collection('friends').doc(ownerUid)
      );

      await batch.commit();

      // 3) Update Friends/{uid}.friends arrays on both sides (sequential because
      //    each is a read-modify-write and Firestore batches don't compose with reads).
      await Promise.all([
        removeUidFromFriendsArray(ownerUid, blockedUid),
        removeUidFromFriendsArray(blockedUid, ownerUid),
      ]);

      // 4) Cancel any pending requests in either direction.
      await cancelPendingFriendRequests(ownerUid, blockedUid);

      logger.info('onUserBlocked: cleanup complete', {
        ownerUid,
        blockedUid,
        edgesDeleted: edgesToDelete,
      });
    } catch (err) {
      logger.error('onUserBlocked: cleanup failed', { ownerUid, blockedUid, err });
    }
  }
);

// ===== 8) New friend request -> push the receiver =====
//
// FriendRequests docs are created client-side (app/friends.tsx) with:
//   { senderUid, receiverUid, status: 'pending', senderUsername, receiverUsername, ... }
// and a deterministic id `${senderUid}_${receiverUid}`. Only fire on a genuinely new
// pending request. Requests are low-volume, so we always send (no per-user opt-in gate),
// but we still respect blocks and never notify a self-request.

export const onFriendRequestCreated = onDocumentCreated(
  'FriendRequests/{requestId}',
  async (event) => {
    const data = (event.data?.data() as any) ?? undefined;
    if (!data) return;
    if (data.status && data.status !== 'pending') return;

    const senderUid: string | undefined =
      typeof data.senderUid === 'string' ? data.senderUid : undefined;
    const receiverUid: string | undefined =
      typeof data.receiverUid === 'string' ? data.receiverUid : undefined;
    if (!senderUid || !receiverUid) return;
    if (senderUid === receiverUid) return; // guard against self

    // Respect blocks in either direction.
    if (await eitherBlocked(receiverUid, senderUid)) return;

    // Resolve a friendly sender name (prefer stamped username, fall back to Profile).
    let senderName = (data.senderUsername || '').toString().trim();
    if (!senderName) {
      try {
        const prof = await db.collection('Profiles').doc(senderUid).get();
        const dn =
          (prof.exists && ((prof.data() as any)?.displayName || (prof.data() as any)?.username)) ||
          '';
        if (typeof dn === 'string' && dn.trim()) senderName = dn.trim();
      } catch {}
    }
    if (!senderName) senderName = 'Someone';

    const tokens = await getAllExpoTokens(receiverUid);
    if (tokens.length === 0) return;

    const title = 'New friend request';
    const body = `${senderName} wants to be friends`;

    logger.info('friendRequest notify', { senderUid, receiverUid });

    for (const token of tokens) {
      try {
        const tickets = await expo.sendPushNotificationsAsync([{
          to: token,
          title,
          body,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data: { type: 'friend_request', senderUid },
        }]);
        await saveTickets(tickets, {
          subscriberUid: receiverUid,
          friendUid: senderUid,
          token,
          beaconId: event.params.requestId as string, // reusing field for requestId
        });
      } catch (err) {
        logger.error('Friend request notify send error', { senderUid, receiverUid, token, err });
      }
    }
  }
);

// ===== 9) FriendEdge deleted -> two-sided denorm cleanup =====
//
// When a FriendEdge is removed (client removeFriend deletes only the edge + its own
// denorms), clean BOTH users' denorm sources so neither side is left with a stale friend:
//   users/{a}/friends/{b} and users/{b}/friends/{a}
//   Friends/{a}.friends arrayRemove b, Friends/{b}.friends arrayRemove a
// Mirrors onUserBlocked's two-sided cleanup.

export const onFriendEdgeDeleted = onDocumentDeleted(
  'FriendEdges/{edgeId}',
  async (event) => {
    const data = (event.data?.data() as any) ?? undefined;
    const uids: string[] = Array.isArray(data?.uids) ? data.uids : [];
    if (uids.length !== 2) return;
    const [a, b] = uids;
    if (!a || !b || a === b) return;

    try {
      const batch = db.batch();
      batch.delete(db.collection('users').doc(a).collection('friends').doc(b));
      batch.delete(db.collection('users').doc(b).collection('friends').doc(a));
      await batch.commit();

      // Friends/{uid}.friends arrays are read-modify-write, so run them after the batch.
      await Promise.all([
        removeUidFromFriendsArray(a, b),
        removeUidFromFriendsArray(b, a),
      ]);

      logger.info('onFriendEdgeDeleted: cleanup complete', { a, b });
    } catch (err) {
      logger.error('onFriendEdgeDeleted: cleanup failed', { a, b, err });
    }
  }
);

// ===== 10) addFriendMutual callable =====
//
// Server-side mutual-friend creation (used by the Add-Brian path). Mirrors redeemInvite's
// write shape: accepted FriendEdge + both users/{x}/friends/{y} docs + both Friends/{x}
// arrayUnion entries. Idempotent (safe to call when already friends) and rejects self.
// Blocks in EITHER direction abort the whole thing.

const mutualEdgeId = (a: string, b: string) => [a, b].sort().join('_');
const cleanUsername = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Resolve the "Add Brian" card's target server-side, so the caller cannot choose it.
 * Mirrors the lookup app/friends.tsx does for display: usernameLower first, then username.
 */
async function resolveBrianUid(): Promise<string | null> {
  const profiles = db.collection('Profiles');
  let snap = await profiles.where('usernameLower', '==', 'brain').limit(1).get();
  if (snap.empty) snap = await profiles.where('username', '==', 'brain').limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

export const addFriendMutual = onCall({ enforceAppCheck: false }, async (req) => {
  const meUid = req.auth?.uid;
  if (!meUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const targetUid = String((req.data as any)?.targetUid ?? '').trim();
  if (!targetUid) return { ok: false, error: 'BAD_TARGET' };
  if (targetUid === meUid) return { ok: false, error: 'SELF' };

  // This callable exists ONLY to back the "Add Brian" first-friend card, which needs the Admin SDK
  // because a client cannot write Brian's owner-only denorms (users/{brian}/friends, Friends/{brian}).
  // It used to accept ANY targetUid, which made it a force-friending vector that no security rule
  // could stop: Profiles are keyed by uid and readable to every signed-in user, so anyone could
  // enumerate the entire user base and unilaterally friend all of it, bypassing FriendRequests
  // consent entirely. The target is now resolved server-side and the caller's targetUid is honored
  // only if it agrees. Every other pairing gets consent from FriendRequests (enforced by the
  // FriendEdges create rule) or from redeemInvite (sharing your code IS the consent).
  // Kept accepting targetUid rather than dropping the arg so builds already in the wild, which
  // pass Brian's uid, keep working unchanged.
  const brianUid = await resolveBrianUid();
  if (!brianUid) {
    logger.error('addFriendMutual: could not resolve the Brian profile');
    return { ok: false, error: 'BAD_TARGET' };
  }
  if (targetUid !== brianUid) {
    logger.warn('addFriendMutual: rejected non-Brian target', { meUid, targetUid });
    return { ok: false, error: 'BAD_TARGET' };
  }

  const edgeRef = db.collection('FriendEdges').doc(mutualEdgeId(meUid, targetUid));
  const now = FieldValue.serverTimestamp();

  const meProfRef = db.collection('Profiles').doc(meUid);
  const meUserRef = db.collection('users').doc(meUid);
  const tgtProfRef = db.collection('Profiles').doc(targetUid);
  const tgtUserRef = db.collection('users').doc(targetUid);
  const meBlockRef = db.collection('users').doc(meUid).collection('blocks').doc(targetUid);
  const tgtBlockRef = db.collection('users').doc(targetUid).collection('blocks').doc(meUid);

  const outcome = await db.runTransaction(async (tx) => {
    // All reads before writes.
    const edgeSnap = await tx.get(edgeRef);
    if (edgeSnap.exists && (edgeSnap.data() as any)?.state === 'accepted') {
      return { status: 'already' as const };
    }
    const [meBlock, tgtBlock] = await Promise.all([
      tx.get(meBlockRef),
      tx.get(tgtBlockRef),
    ]);
    if (meBlock.exists || tgtBlock.exists) {
      return { status: 'blocked' as const };
    }
    const [meP, meU, tgtP, tgtU] = await Promise.all([
      tx.get(meProfRef),
      tx.get(meUserRef),
      tx.get(tgtProfRef),
      tx.get(tgtUserRef),
    ]);
    const myUsername =
      cleanUsername((meP.data() as any)?.username) || cleanUsername((meU.data() as any)?.username);
    const targetUsername =
      cleanUsername((tgtP.data() as any)?.username) || cleanUsername((tgtU.data() as any)?.username);

    tx.set(edgeRef, { uids: [meUid, targetUid], state: 'accepted', createdAt: now, updatedAt: now }, { merge: true });
    // Deliberately NO notify default here: this is the Add-Brian first-friend path, and a new
    // user should not be signed up for the creator's beacon pings (nor Brian for thousands of
    // first-friend users'). Every OTHER way a friendship forms defaults notify ON.
    tx.set(
      db.collection('users').doc(meUid).collection('friends').doc(targetUid),
      { uid: targetUid, username: targetUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('users').doc(targetUid).collection('friends').doc(meUid),
      { uid: meUid, username: myUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(meUid),
      { friends: FieldValue.arrayUnion({ uid: targetUid, username: targetUsername }) },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(targetUid),
      { friends: FieldValue.arrayUnion({ uid: meUid, username: myUsername }) },
      { merge: true }
    );
    return { status: 'created' as const };
  });

  if (outcome.status === 'blocked') return { ok: false, error: 'BLOCKED' };
  if (outcome.status === 'already') return { ok: true, already: true, targetUid };
  logger.info('addFriendMutual: friendship created', { meUid, targetUid });
  return { ok: true, targetUid };
});

/**
 * When a friend request flips to accepted, default BOTH sides' per-friend beacon notifications ON
 * (users/{x}/friends/{y}.notify). The accepting client can only write its own side, and the
 * sender's side otherwise stayed silently OFF. New friendships should notify until turned off.
 */
export const onFriendRequestAccepted = onDocumentUpdated('FriendRequests/{id}', async (event) => {
  const before = event.data?.before?.data() as any;
  const after = event.data?.after?.data() as any;
  if (!before || !after) return;
  if (before.status === 'accepted' || after.status !== 'accepted') return;
  const a = String(after.senderUid ?? '');
  const b = String(after.receiverUid ?? '');
  if (!a || !b) return;
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    db.collection('users').doc(a).collection('friends').doc(b).set({ uid: b, notify: true, updatedAt: now }, { merge: true }),
    db.collection('users').doc(b).collection('friends').doc(a).set({ uid: a, notify: true, updatedAt: now }, { merge: true }),
  ]);
  logger.info('onFriendRequestAccepted: defaulted notify on', { a, b });
});

// Keep callable exports (ESM requires .js suffix)
export { deleteAccountDataV2 } from './deleteAccountV2.js';
export { checkPostAllowed } from './checkPostAllowed.js';
export { dailyBonusAccrual } from './dailyBonusAccrual.js';
// portAccountData is intentionally NOT exported: the client porting UI was removed, so
// leaving it deployed is a needless attack surface. Re-add this export only if that UI
// returns. (See functions/src/portAccount.ts, kept dormant.)
export { ensureInviteCode, redeemInvite } from './redeemInvite.js';
export { recordInviteVisit, claimInviteVisit } from './deferredInvite.js';
export { getFriendsOfFriends } from './friendsOfFriends.js';
export { fetchLinkPreview } from './fetchLinkPreview.js';