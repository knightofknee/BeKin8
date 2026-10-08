// functions/src/index.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { acceptedFriendUids } from './audience.js';
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
  expiresAt?: FirebaseFirestore.Timestamp;
  timeHHmm?: string | null;
  /** RALLY: this beacon is its owner rallying friends into ANOTHER beacon's chat (that beacon's id). */
  rallyOf?: string;
};

// ===== Expo client & constants =====
const expo = new Expo();
const TICKET_TTL_HOURS = 48;

// ===== Helpers: content =====
function summarize(beacon: Beacon): string {
  return (beacon.message || beacon.details || 'A new beacon was lit').toString();
}
function titleFor(beacon: Beacon): string {
  return beacon.ownerName ? `${beacon.ownerName} lit a beacon` : 'A friend lit a beacon';
}

// ===== Helpers: "when" copy for pushes =====
// The server runs in UTC but a beacon's day is the OWNER's local day. startAt is always written as
// the owner's local midnight, so its UTC clock time IS the owner's UTC offset (negated): local
// midnight at 05:00Z means UTC-5. Mapped into (-11h, +13h]: that covers New Zealand's daylight
// time and Tonga (+13); the only zones it misreads are UTC-11/-12 (American Samoa, Niue, Baker
// Island) and Kiribati's +14.
function ownerOffsetMin(startAt: FirebaseFirestore.Timestamp): number {
  const d = startAt.toDate();
  let off = -(d.getUTCHours() * 60 + d.getUTCMinutes());
  if (off <= -11 * 60) off += 24 * 60;
  return off;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "18:30" -> "6:30 PM", "19:00" -> "7 PM"; '' when unset or malformed. */
function formatTime12(hhmm?: string | null): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return '';
  const h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h24 > 23 || min > 59) return '';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "Tonight at 8 PM", "Tomorrow", "Friday at 7:30 PM", relative to the owner's local today. */
function whenLabel(b: Beacon, nowMs: number = Date.now()): string {
  if (!b.startAt) return '';
  const off = ownerOffsetMin(b.startAt) * 60_000;
  const startMs = b.startAt.toMillis();
  const localDay = (ms: number) => Math.floor((ms + off) / 86_400_000);
  const diff = localDay(startMs) - localDay(nowMs);
  const time = formatTime12(b.timeHHmm);
  const evening = /^(1[7-9]|2\d):/.test((b.timeHHmm || '').trim());
  let day: string;
  if (diff === 0) day = evening ? 'Tonight' : 'Today';
  else if (diff === -1) day = 'Tonight'; // last night's beacon, inside its after-midnight grace
  else if (diff === 1) day = 'Tomorrow';
  else day = WEEKDAYS[new Date(startMs + off + 12 * 3_600_000).getUTCDay()];
  return time ? `${day} at ${time}` : day;
}

/** Push body for a beacon: "Friday at 7 PM · Hang out at my place?" */
function beaconBody(b: Beacon): string {
  const when = whenLabel(b);
  return when ? `${when} · ${summarize(b)}` : summarize(b);
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
 *            ∩ the owner's actual accepted friends
 *            ∩ users who opted in (new subdoc OR legacy notify flag)
 *            − ownerUid
 *
 * The friend intersection is a hard backstop, not a formality. Two of the three audience sources
 * are client-written and unvalidated: legacy `allowedUids` (the Beacons create rule pins only
 * ownerUid) and FriendGroups.memberUids (the create rule checks only `is list`). The last filter,
 * recipientWantsNotify, passes on the recipient's notify-all toggle with no friendship test. So
 * before this, anyone could create a beacon carrying arbitrary allowedUids and arbitrary message
 * text and push attacker-authored notifications to strangers, repeatably with a fresh beacon each
 * time. Friendship is the one thing the sender cannot forge, so every path is funneled through it.
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
  // Track whether `base` already came straight from the friend list, so the unscoped path doesn't
  // pay for the same lookup twice.
  let baseIsFriendList = false;
  const base: string[] = scoped
    ? normalizedAllowed.length > 0
      ? normalizedAllowed
      : await membersOfGroups(ownerUid, groupIds as string[])
    : normalizedAllowed.length > 0
    ? normalizedAllowed
    : ((baseIsFriendList = true), await friendUidsOf(ownerUid));

  if (base.length === 0) return [];

  // Constrain to real friendships. Skipped only when `base` IS the friend list.
  let audience = base;
  if (!baseIsFriendList) {
    const friendSet = new Set(await friendUidsOf(ownerUid));
    audience = base.filter((uid) => friendSet.has(uid));
    if (audience.length !== base.length) {
      logger.info('eligibleRecipients: dropped non-friend recipients', {
        ownerUid,
        requested: base.length,
        kept: audience.length,
      });
    }
    if (audience.length === 0) return [];
  }

  const baseSet = new Set(audience); // dedupe
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

/** Owner's display name for push titles: Profiles.displayName at send time, else the beacon's copy. */
async function ownerDisplayName(ownerUid: string, b: Beacon): Promise<string> {
  let name = (b.ownerName || '').toString().trim();
  try {
    const dn = (await db.collection('Profiles').doc(ownerUid).get()).data()?.displayName;
    if (typeof dn === 'string' && dn.trim()) name = dn.trim();
  } catch {}
  return name;
}

/**
 * A beacon tells friends it was lit ONCE. lastNotifiedAt marks that first fan-out (server-written
 * only); any later off -> on of the same beacon is a relight and sends nothing, so flicking a beacon
 * on and off can never re-ping everyone. Instead a relight arms the hidden STOKE (stokeReady): a
 * long press on the lit fire lets the owner nudge friends one more time (stokeBeacon). Claimed in a
 * transaction so two near-simultaneous activations can't both fan out.
 */
async function claimFirstFanOut(beaconId: string): Promise<boolean> {
  const ref = db.collection('Beacons').doc(beaconId);
  // The authority is the server-only BeaconNotices doc (the Beacon doc is owner-writable, so a
  // modified client could clear a flag there to re-fan-out). lastNotifiedAt on the beacon still
  // counts so beacons lit before this existed aren't treated as first lights.
  const noticeRef = db.collection('BeaconNotices').doc(beaconId);
  return db.runTransaction(async (tx) => {
    const [snap, notice] = await Promise.all([tx.get(ref), tx.get(noticeRef)]);
    if (!snap.exists) return false;
    const d = snap.data() as any;
    const n = notice.data() as any;
    if (n?.fannedOutAt || d?.lastNotifiedAt) {
      if (!n?.stokedAt && d?.stokeReady !== true) tx.update(ref, { stokeReady: true });
      return false;
    }
    tx.update(ref, { lastNotifiedAt: FieldValue.serverTimestamp() });
    tx.set(
      noticeRef,
      {
        ownerUid: d?.ownerUid ?? null,
        fannedOutAt: FieldValue.serverTimestamp(),
        purgeAt: Timestamp.fromMillis((d?.expiresAt?.toMillis?.() || Date.now() + 24 * 3_600_000) + 2 * 3_600_000),
      },
      { merge: true }
    );
    return true;
  });
}

async function fanOutForBeacon(beaconId: string, b: Beacon) {
  const ownerUid = b.ownerUid;
  if (!ownerUid) return;
  // A RALLY first opens the original beacon's chat to the rallier's friends (idempotent, so every
  // activation re-asserts it). An invalid rally (not allowed to see the original, or it's over)
  // announces nothing at all.
  let rally: { og: Beacon; ogId: string } | null = null;
  if (b.rallyOf) {
    rally = await extendRallyAudience(beaconId, b);
    if (!rally) return;
  }
  let first = false;
  try {
    first = await claimFirstFanOut(beaconId);
  } catch (err) {
    logger.warn('fanOut claim failed, skipping', { beaconId, err });
    return;
  }
  if (!first) {
    logger.info('fanOut skipped: relight (stoke armed)', { beaconId, ownerUid });
    return;
  }
  const name = await ownerDisplayName(ownerUid, b);
  if (rally) {
    // "Sam is rallying" / "For Maya's beacon · Tonight at 8 PM · Pizza at mine": the plan is the
    // ORIGINAL beacon's, and tapping opens the original's chat (the shared room).
    const ogName = (await ownerDisplayName(rally.og.ownerUid, rally.og)) || 'a friend';
    await pushBeaconToFriends(
      beaconId,
      b,
      name ? `${name} is rallying` : 'A friend is rallying',
      `For ${ogName}'s beacon · ${beaconBody(rally.og)}`,
      rally.ogId
    );
    return;
  }
  await pushBeaconToFriends(beaconId, b, name ? `${name} lit a beacon` : 'A friend lit a beacon', beaconBody(b));
}

/**
 * RALLY: owner R lit a beacon with rallyOf = the original beacon (owner O). R's invited friends
 * (R's chosen groups, else all of R's friends) join the ORIGINAL beacon's audience, so they can read
 * and post in its one shared chat: stored as rallyUids on the original (kept through owner restamps,
 * see audience.ts), merged into its audienceUids, and restamped onto its existing messages (the
 * message read rule checks each message's own copy). rallyOf is client-written, so it is verified:
 * R must already be in the original's audience, the original must be live, and nobody blocked by
 * or blocking O gets in. Returns the original, or null if the rally is invalid.
 */
async function extendRallyAudience(rallyId: string, b: Beacon): Promise<{ og: Beacon; ogId: string } | null> {
  const ogId = String(b.rallyOf || '');
  if (!ogId || ogId === rallyId) return null;
  const ogRef = db.collection('Beacons').doc(ogId);
  const ogSnap = await ogRef.get();
  const og = ogSnap.data() as (Beacon & { audienceUids?: string[]; rallyUids?: string[] }) | undefined;
  if (!og || !og.ownerUid || og.ownerUid === b.ownerUid) return null;
  const expMs = og.expiresAt?.toMillis?.() ?? 0;
  if (og.active !== true || (expMs && expMs < Date.now())) return null;
  const ogAudience: string[] = Array.isArray(og.audienceUids) ? og.audienceUids : [];
  if (!ogAudience.includes(b.ownerUid)) {
    logger.warn('rally rejected: rallier not in the original audience', { rallyId, ogId });
    return null;
  }

  const friends = await acceptedFriendUids(b.ownerUid);
  const scoped = Array.isArray(b.groupIds) && b.groupIds.length > 0;
  let invited = friends;
  if (scoped) {
    const members = new Set(await membersOfGroups(b.ownerUid, b.groupIds as string[]));
    invited = friends.filter((u) => members.has(u));
  }
  invited = invited.filter((u) => u !== og.ownerUid && !ogAudience.includes(u));
  const unblocked = (
    await Promise.all(invited.map(async (u) => ((await eitherBlocked(u, og.ownerUid)) ? null : u)))
  ).filter((u): u is string => !!u);

  if (unblocked.length) {
    const rallyUids = Array.from(new Set([...(og.rallyUids || []), ...unblocked]));
    const audience = Array.from(new Set([...ogAudience, ...unblocked]));
    await ogRef.update({ rallyUids, audienceUids: audience });
    const msgs = await ogRef.collection('ChatMessages').get();
    for (const group of chunk(msgs.docs, 450)) {
      const batch = db.batch();
      group.forEach((m) => batch.update(m.ref, { audienceUids: audience }));
      await batch.commit();
    }
    logger.info('rally audience extended', { rallyId, ogId, added: unblocked.length });
  }
  return { og, ogId };
}

/** Send one push about a beacon to its eligible friends (audience, friendship, opt-in, blocks). */
async function pushBeaconToFriends(
  beaconId: string,
  b: Beacon,
  title: string,
  body: string,
  /** Which beacon's chat the push opens (a rally opens the original's). Defaults to beaconId. */
  openId: string = beaconId
): Promise<number> {
  const ownerUid = b.ownerUid;
  const recipients = await eligibleRecipients(b.allowedUids, ownerUid, b.groupIds);
  logger.info('fanOut recipients', {
    beaconId,
    ownerUid,
    allowedCount: Array.isArray(b.allowedUids) ? b.allowedUids.length : 0,
    recipientCount: recipients.length,
  });
  if (recipients.length === 0) return 0;

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
        data: { type: 'beacon', beaconId: openId, ownerUid },
      });
      messageSubscriber.push(recipientUid);
    }
  }

  if (messages.length === 0) return 0;

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
  return recipients.length;
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
  // An RSVP made by RALLYING (the actor also lit their own beacon to bring friends).
  rally?: boolean;
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

/** True the first time `uid` RSVPs (or first rallies) on a beacon; false for any repeat. */
async function claimRsvpPush(beaconId: string, uid: string, rally: boolean): Promise<boolean> {
  const ref = db.collection('BeaconNotices').doc(beaconId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = (snap.data() as any)?.rsvpPushed?.[uid] as 'going' | 'rally' | undefined;
    if (prev === 'rally' || (prev === 'going' && !rally)) return false;
    tx.set(
      ref,
      {
        rsvpPushed: { [uid]: rally ? 'rally' : 'going' },
        // A beacon announced before fannedOutAt existed may have no notice doc yet: give it a sweep
        // date so it can't linger forever (beacons live at most a week ahead + grace).
        ...(snap.exists && (snap.data() as any)?.purgeAt ? {} : { purgeAt: Timestamp.fromMillis(Date.now() + 9 * 86_400_000) }),
      },
      { merge: true }
    );
    return true;
  });
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

    // RSVPs and rallies push ONCE per person per beacon: taking an RSVP back and re-doing it, or
    // un-rallying and rallying again, never re-fires. Going -> rallying is new news and pushes once
    // more. Tracked server-side (BeaconNotices is server-only) in a transaction so a double write
    // can't sneak two pushes through.
    if (isRsvp && !(await claimRsvpPush(beaconId, senderUid, msg.rally === true))) {
      logger.info('rsvp push skipped: already announced', { beaconId, senderUid, rally: msg.rally === true });
      return;
    }

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
      ? msg.rally
        ? `${senderName} is rallying for a beacon`
        : `${senderName} RSVP'd to a beacon`
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

// ===== 4b) Beacon change notices for RSVPers (put out / back on / updated) =====
//
// People who said "I'm in" hear when the beacon goes out, comes back, or its day/time/message
// changes. Expo push can't replace or recall a delivered notification, so instead of sending on
// every write the change is QUEUED in BeaconNotices/{beaconId} and sent after a quiet period. The
// sender then compares the beacon's CURRENT state with what RSVPers were last told (lastSent), so
// an off/on/off/on flurry inside the window nets out to nothing, and a burst of edits becomes one
// push. BeaconNotices is server-only (no client rule matches it).

const NOTICE_QUIET_MS = 5 * 60 * 1000;

function sameMillis(a?: FirebaseFirestore.Timestamp, b?: FirebaseFirestore.Timestamp): boolean {
  return (a?.toMillis?.() ?? 0) === (b?.toMillis?.() ?? 0);
}

export const onBeaconChangedQueueNotice = onDocumentUpdated('Beacons/{beaconId}', async (event) => {
  const before = event.data?.before?.data() as Beacon | undefined;
  const after = event.data?.after?.data() as Beacon | undefined;
  if (!before || !after) return;
  const wasOn = before.active === true;
  const isOn = after.active === true;
  const detailsChanged =
    wasOn &&
    isOn &&
    (!sameMillis(before.startAt, after.startAt) ||
      (before.timeHHmm || '') !== (after.timeHHmm || '') ||
      summarize(before) !== summarize(after));
  if (wasOn === isOn && !detailsChanged) return;

  const beaconId = event.params.beaconId as string;
  await db
    .collection('BeaconNotices')
    .doc(beaconId)
    .set(
      {
        ownerUid: after.ownerUid,
        // Every change restarts the quiet window; dueAt is removed once sent (single-field range
        // query in the processor, no composite index).
        dueAt: Timestamp.fromMillis(Date.now() + NOTICE_QUIET_MS),
        ...(detailsChanged ? { detailsChanged: true } : {}),
        // Swept by the processor once the beacon is long over, so these never pile up.
        purgeAt: Timestamp.fromMillis(
          (after.expiresAt?.toMillis?.() || Date.now() + 24 * 3_600_000) + 2 * 3_600_000
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
});

async function pushToUsers(
  uids: string[],
  msg: { title: string; body: string; data: Record<string, unknown> },
  ctx: { friendUid: string; beaconId: string }
) {
  const messages: ExpoPushMessage[] = [];
  const owners: string[] = [];
  for (const uid of uids) {
    for (const token of await getAllExpoTokens(uid)) {
      messages.push({ to: token, sound: 'default', priority: 'high', channelId: 'default', ...msg });
      owners.push(uid);
    }
  }
  const sent: { id: string; subscriberUid: string; token: string }[] = [];
  let idx = 0;
  for (const msgChunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(msgChunk);
      tickets.forEach((t, i) => {
        if (t && isSuccessTicket(t)) sent.push({ id: t.id, subscriberUid: owners[idx + i], token: msgChunk[i].to as string });
      });
    } catch (err) {
      logger.error('pushToUsers send error', { ...ctx, err });
    }
    idx += msgChunk.length;
  }
  await saveTicketsBatched(sent, ctx.friendUid, ctx.beaconId);
}

async function sendBeaconNotice(beaconId: string) {
  const ref = db.collection('BeaconNotices').doc(beaconId);
  const notice = (await ref.get()).data() as any;
  if (!notice) return;
  const beaconSnap = await db.collection('Beacons').doc(beaconId).get();
  if (!beaconSnap.exists) {
    await ref.delete();
    return;
  }
  const b = beaconSnap.data() as Beacon;
  const expMs = b.expiresAt?.toMillis?.() ?? 0;
  const isOn = b.active === true && (!expMs || expMs > Date.now());
  const lastSent: 'out' | 'on' | undefined = notice.lastSent;

  let kind: 'out' | 'back' | 'updated' | null = null;
  if (!isOn) kind = lastSent === 'out' ? null : 'out';
  else if (lastSent === 'out') kind = 'back';
  else if (notice.detailsChanged) kind = 'updated';

  // Clear the pending state BEFORE sending (so a send failure can't loop the processor every tick),
  // but only if no newer change landed since the read: the trigger moves dueAt on every change, so
  // a different dueAt means a fresh quiet window started and that later tick will send instead.
  const readDue: number = notice.dueAt?.toMillis?.() ?? 0;
  const cleared = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as any;
    if ((cur?.dueAt?.toMillis?.() ?? 0) !== readDue) return false;
    tx.set(
      ref,
      {
        dueAt: FieldValue.delete(),
        detailsChanged: FieldValue.delete(),
        ...(kind ? { lastSent: kind === 'out' ? 'out' : 'on', lastSentAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true }
    );
    return true;
  });
  if (!cleared || !kind) return;

  const ownerUid = b.ownerUid;
  const rsvps = (await getRsvpUids(beaconId)).filter((u) => u && u !== ownerUid);
  if (rsvps.length === 0) return;
  const unblocked = (
    await Promise.all(rsvps.map(async (u) => ((await eitherBlocked(u, ownerUid)) ? null : u)))
  ).filter((u): u is string => !!u);
  if (unblocked.length === 0) return;

  const name = (await ownerDisplayName(ownerUid, b)) || 'Your friend';

  const title =
    kind === 'out'
      ? `${name} put out their beacon`
      : kind === 'back'
      ? `${name}'s beacon is back on`
      : `${name} updated their beacon`;
  const body = kind === 'out' ? "Looks like it's off for now." : beaconBody(b);

  logger.info('beaconNotice send', { beaconId, kind, recipientCount: unblocked.length });
  await pushToUsers(unblocked, { title, body, data: { type: 'beacon', beaconId, ownerUid } }, { friendUid: ownerUid, beaconId });
}

export const processBeaconNotices = onSchedule('every 2 minutes', async () => {
  const due = await db.collection('BeaconNotices').where('dueAt', '<=', Timestamp.now()).limit(200).get();
  for (const d of due.docs) {
    try {
      await sendBeaconNotice(d.id);
    } catch (err) {
      logger.error('processBeaconNotices failed', { beaconId: d.id, err });
    }
  }
  const stale = await db.collection('BeaconNotices').where('purgeAt', '<=', Timestamp.now()).limit(400).get();
  if (!stale.empty) {
    const batch = db.batch();
    stale.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
});

// ===== 4c) Stoke: the hidden one-time re-nudge =====
// A relit beacon never re-pings friends (claimFirstFanOut); instead it arms stokeReady. A long press
// on the lit fire then lets the owner send ONE more push, optionally with a fresh message. Enforced
// here (owner only, beacon live, armed by a relight, never stoked before) in a transaction. The
// once-only cap is BeaconNotices.stokedAt (server-only), so a modified client can't stoke twice;
// the owner-writable stokeReady on the beacon only drives the hidden long press.
export const stokeBeacon = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const beaconId = String(req.data?.beaconId || '');
  const message = String(req.data?.message || '').trim().slice(0, 200);
  if (!beaconId) throw new HttpsError('invalid-argument', 'Missing beacon.');

  const ref = db.collection('Beacons').doc(beaconId);
  const noticeRef = db.collection('BeaconNotices').doc(beaconId);
  const b = await db.runTransaction(async (tx) => {
    const [snap, notice] = await Promise.all([tx.get(ref), tx.get(noticeRef)]);
    const d = snap.data() as (Beacon & { stokeReady?: boolean; lastNotifiedAt?: unknown }) | undefined;
    if (!d || d.ownerUid !== uid) throw new HttpsError('permission-denied', 'Not your beacon.');
    const expMs = d.expiresAt?.toMillis?.() ?? 0;
    if (d.active !== true || (expMs && expMs < Date.now())) throw new HttpsError('failed-precondition', 'Your beacon is out.');
    // Armed only by a relight (claimFirstFanOut); the once-only cap lives server-side.
    if (d.stokeReady !== true || !d.lastNotifiedAt) throw new HttpsError('failed-precondition', 'Nothing to stoke.');
    if ((notice.data() as any)?.stokedAt) throw new HttpsError('failed-precondition', 'Already stoked.');
    tx.update(ref, { stokeReady: false });
    tx.set(noticeRef, { ownerUid: uid, stokedAt: FieldValue.serverTimestamp() }, { merge: true });
    return d;
  });

  const name = await ownerDisplayName(uid, b);
  const when = whenLabel(b);
  const text = message || summarize(b);
  const sent = await pushBeaconToFriends(
    beaconId,
    b,
    name ? `${name} stoked their beacon` : 'A friend stoked their beacon',
    when ? `${when} · ${text}` : text,
    b.rallyOf || beaconId // a rally's nudge opens the shared (original) chat
  );
  logger.info('stokeBeacon sent', { beaconId, recipients: sent });
  return { ok: true };
});

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

/**
 * Delete EVERY FriendRequests doc between two users, in both directions, at any status.
 *
 * This used to only flip `pending` requests to `cancelled`, which left two problems behind:
 *
 * 1) Security: an `accepted` request is what the FriendEdges create rule accepts as proof of
 *    consent (see `acceptedRequestFrom` in firestore.rules). Because nothing ever removed it,
 *    consent was permanent: a user who was unfriended or blocked could re-create the edge
 *    document from a modified client at any time and reappear in the other user's friend list,
 *    beacon push fanout, and friends-of-friends graph. Consent must be consumed, not archived.
 *
 * 2) Re-friending was impossible. app/friends.tsx re-sends with setDoc(merge), which is an
 *    UPDATE against a surviving doc, and the update rule only permits transitions OUT of
 *    `pending`. So any leftover doc at accepted/cancelled/rejected permanently blocked a new
 *    request between that pair, and a leftover `accepted` also made the client report
 *    "Already friends." after an unfriend.
 *
 * Both listeners in the friends screen filter on status == 'pending', so non-pending docs are
 * residue nothing reads. Deleting is the correct disposal.
 */
async function clearFriendRequestsBetween(uidA: string, uidB: string) {
  const reqs = db.collection('FriendRequests');
  // Query by field rather than by the `{sender}_{receiver}` doc id, so legacy
  // random-id request docs are cleaned up too.
  const [aToB, bToA] = await Promise.all([
    reqs.where('senderUid', '==', uidA).where('receiverUid', '==', uidB).get(),
    reqs.where('senderUid', '==', uidB).where('receiverUid', '==', uidA).get(),
  ]);
  const batch = db.batch();
  let touched = 0;
  for (const snap of [aToB, bToA]) {
    snap.forEach((d) => {
      batch.delete(d.ref);
      touched++;
    });
  }
  if (touched > 0) await batch.commit();
  return touched;
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

      // 4) Delete every request between them, in either direction, at any status. An `accepted`
      //    one left behind is standing consent the blocked party can use to rebuild the edge.
      await clearFriendRequestsBetween(ownerUid, blockedUid);

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

      // Consume the consent that created this edge. The accepted FriendRequests doc is what the
      // FriendEdges create rule checks, so leaving it behind let the removed party re-create the
      // edge and undo their own removal. It also blocked re-friending: the client's re-send is a
      // setDoc(merge) = update, which the rules only permit on a `pending` doc.
      const requestsCleared = await clearFriendRequestsBetween(a, b);

      logger.info('onFriendEdgeDeleted: cleanup complete', { a, b, requestsCleared });
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
 *
 * This used to be `where('usernameLower','==','brain').limit(1)`. A single-equality query with no
 * ordering returns the lowest document id, and Profiles usernames are NOT validated against the
 * Usernames reservation (app/friends.tsx enforces uniqueness with a client-side getDocs that a
 * direct SDK call skips). So any user could set their own usernameLower to 'brain' and, if their
 * uid sorted below the real one, silently receive every new user's Add-Brian friendship. Retryable
 * with fresh accounts until a low-sorting uid came up.
 *
 * Resolution order, most trustworthy first:
 *   1. BEKIN_BRIAN_UID env var. Authoritative and unspoofable; set this to close the hole outright.
 *   2. The Usernames/brain reservation. Rules allow create and owner-delete but never update, so
 *      first-writer-wins makes this doc trustworthy when it exists.
 *   3. A Profiles scan that FAILS CLOSED on ambiguity. If two profiles claim the name we cannot
 *      tell which is real, so we refuse rather than guess by document id. An impostor can then
 *      break the Add-Brian card, but can never be substituted for its target.
 */
async function resolveBrianUid(): Promise<string | null> {
  const pinned = (process.env.BEKIN_BRIAN_UID ?? '').trim();
  if (pinned) return pinned;

  const reservation = await db.collection('Usernames').doc('brain').get();
  const reservedUid = reservation.exists ? cleanUsername(reservation.data()?.uid) : '';
  if (reservedUid) return reservedUid;

  const profiles = db.collection('Profiles');
  let snap = await profiles.where('usernameLower', '==', 'brain').limit(2).get();
  if (snap.empty) snap = await profiles.where('username', '==', 'brain').limit(2).get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    logger.error(
      'addFriendMutual: multiple profiles claim the username "brain", refusing to guess. ' +
        'Set BEKIN_BRIAN_UID to pin the real target.',
      { candidateUids: snap.docs.map((d) => d.id) }
    );
    return null;
  }
  return snap.docs[0].id;
}

export const addFriendMutual = onCall({ enforceAppCheck: false }, async (req) => {
  const meUid = req.auth?.uid;
  if (!meUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  // targetUid is now OPTIONAL. Profiles are audience-scoped, so the client can no longer resolve
  // Brian's uid with its own Profiles query; it just calls this with no argument and the server
  // resolves. Builds already in the wild still pass a targetUid, which is honored only if it agrees
  // with the server's answer (checked below).
  const targetUid = String((req.data as any)?.targetUid ?? '').trim();
  if (targetUid && targetUid === meUid) return { ok: false, error: 'SELF' };

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
  // An explicitly-passed target must agree with the server's answer; omitting it means "whoever the
  // server says", which is what current builds do.
  if (targetUid && targetUid !== brianUid) {
    logger.warn('addFriendMutual: rejected non-Brian target', { meUid, targetUid });
    return { ok: false, error: 'BAD_TARGET' };
  }
  const resolvedTarget = brianUid;
  if (resolvedTarget === meUid) return { ok: false, error: 'SELF' };

  const edgeRef = db.collection('FriendEdges').doc(mutualEdgeId(meUid, resolvedTarget));
  const now = FieldValue.serverTimestamp();

  const meProfRef = db.collection('Profiles').doc(meUid);
  const meUserRef = db.collection('users').doc(meUid);
  const tgtProfRef = db.collection('Profiles').doc(resolvedTarget);
  const tgtUserRef = db.collection('users').doc(resolvedTarget);
  const meBlockRef = db.collection('users').doc(meUid).collection('blocks').doc(resolvedTarget);
  const tgtBlockRef = db.collection('users').doc(resolvedTarget).collection('blocks').doc(meUid);

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

    tx.set(edgeRef, { uids: [meUid, resolvedTarget], state: 'accepted', createdAt: now, updatedAt: now }, { merge: true });
    // Deliberately NO notify default here: this is the Add-Brian first-friend path, and a new
    // user should not be signed up for the creator's beacon pings (nor Brian for thousands of
    // first-friend users'). Every OTHER way a friendship forms defaults notify ON.
    tx.set(
      db.collection('users').doc(meUid).collection('friends').doc(resolvedTarget),
      { uid: resolvedTarget, username: targetUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('users').doc(resolvedTarget).collection('friends').doc(meUid),
      { uid: meUid, username: myUsername, status: 'accepted', acceptedAt: now },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(meUid),
      { friends: FieldValue.arrayUnion({ uid: resolvedTarget, username: targetUsername }) },
      { merge: true }
    );
    tx.set(
      db.collection('Friends').doc(resolvedTarget),
      { friends: FieldValue.arrayUnion({ uid: meUid, username: myUsername }) },
      { merge: true }
    );
    return { status: 'created' as const };
  });

  if (outcome.status === 'blocked') return { ok: false, error: 'BLOCKED' };
  // Response key stays `targetUid` so existing clients reading it are unaffected.
  if (outcome.status === 'already') return { ok: true, already: true, targetUid: resolvedTarget };
  logger.info('addFriendMutual: friendship created', { meUid, targetUid: resolvedTarget });
  return { ok: true, targetUid: resolvedTarget };
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
// Username -> uid for add-friend / unblock, now that Profiles are audience-scoped and a client can
// no longer query a stranger's profile. Returns uid + display name only.
export { resolveUsername } from './resolveUsername.js';
// Read-audience denormalization (see audience.ts). Stamps `audienceUids` on Posts/Beacons and keeps
// it current as friendships change, so reads can be scoped to the audience instead of to "any
// signed-in user". Data-only for now; the rules that enforce it land after the backfill.
export {
  onPostCreatedStampAudience,
  onBeaconCreatedStampAudience,
  onChatMessageCreatedStampAudience,
  onFriendEdgeCreatedSyncAudience,
  onFriendEdgeDeletedSyncAudience,
  onProfileFofToggled,
} from './audience.js';