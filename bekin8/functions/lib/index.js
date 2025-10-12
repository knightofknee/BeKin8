// functions/src/index.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Expo, } from 'expo-server-sdk';
// ---- Modular Admin init (Node 20 + ESM) ----
const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
// ===== Expo client & constants =====
const expo = new Expo({ useFcmV1: false });
const TICKET_TTL_HOURS = 48;
// ===== Helpers: content =====
function summarize(beacon) {
    return (beacon.message || beacon.details || 'A new beacon was lit').toString();
}
function titleFor(beacon) {
    return beacon.ownerName ? `${beacon.ownerName} lit a beacon` : 'A friend lit a beacon';
}
// ===== Helpers: preferences & subscribers =====
/** Legacy UI pref: users/{recipientUid}/friends/{ownerUid}.notify === true */
async function legacyNotifyEnabled(recipientUid, ownerUid) {
    const prefDoc = await db
        .collection('users')
        .doc(recipientUid)
        .collection('friends')
        .doc(ownerUid)
        .get();
    return prefDoc.exists ? !!prefDoc.data()?.notify : false;
}
/** New opt-in store: users/{recipientUid}/friendSubscriptions/{ownerUid}.enabled === true */
async function subDocEnabled(recipientUid, ownerUid) {
    const d = await db
        .collection('users')
        .doc(recipientUid)
        .collection('friendSubscriptions')
        .doc(ownerUid)
        .get();
    return d.exists ? !!d.data()?.enabled : false;
}
/** Decide if a recipient should get pushes for ownerUid (new OR legacy flag). */
async function recipientWantsNotify(recipientUid, ownerUid) {
    const [a, b] = await Promise.all([
        subDocEnabled(recipientUid, ownerUid),
        legacyNotifyEnabled(recipientUid, ownerUid),
    ]);
    return a || b;
}
/** intersection(allowedUids, subscribers/legacy-notify) */
async function eligibleRecipients(allowed, ownerUid) {
    const allowSet = new Set((allowed || []).filter(Boolean));
    if (allowSet.size === 0)
        return [];
    const out = [];
    await Promise.all(Array.from(allowSet).map(async (uid) => {
        if (uid === ownerUid)
            return;
        if (await recipientWantsNotify(uid, ownerUid))
            out.push(uid);
    }));
    return out;
}
// ===== Helpers: tokens =====
/** Preferred: users/{uid}/pushTokens/{installationId}.token */
async function getPushTokensFromSubcollection(uid) {
    const ss = await db.collection('users').doc(uid).collection('pushTokens').get();
    const set = new Set();
    ss.forEach((d) => {
        const tok = String(d.data()?.token || '');
        if (Expo.isExpoPushToken(tok))
            set.add(tok);
    });
    return Array.from(set);
}
/** Legacy fallbacks: Profiles/{uid}.expoPushToken and users/{uid}.expoPushToken */
async function getLegacySingleToken(uid) {
    const out = [];
    const prof = await db.collection('Profiles').doc(uid).get();
    const t1 = prof.exists ? prof.data()?.expoPushToken : undefined;
    if (t1 && Expo.isExpoPushToken(t1))
        out.push(t1);
    const u = await db.collection('users').doc(uid).get();
    const t2 = u.exists ? u.data()?.expoPushToken : undefined;
    if (t2 && Expo.isExpoPushToken(t2))
        out.push(t2);
    return out;
}
/** Gather all unique Expo tokens for a user (new + legacy). */
async function getAllExpoTokens(uid) {
    const [multi, legacy] = await Promise.all([
        getPushTokensFromSubcollection(uid),
        getLegacySingleToken(uid),
    ]);
    return Array.from(new Set([...multi, ...legacy]));
}
/** Remove a token from users/{uid}/pushTokens/* where it matches .token */
async function removeTokenEverywhere(userUid, token) {
    const col = db.collection('users').doc(userUid).collection('pushTokens');
    const snaps = await col.get();
    const batch = db.batch();
    snaps.forEach((docSnap) => {
        if (docSnap.data()?.token === token)
            batch.delete(docSnap.ref);
    });
    await batch.commit();
}
// ===== Helpers: tickets storage & receipts =====
function isSuccessTicket(t) {
    return t.status === 'ok';
}
async function saveTickets(tickets, ctx) {
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const t of tickets) {
        if (!isSuccessTicket(t))
            continue; // only success tickets have an id
        const ref = db.collection('expoPushTickets').doc(t.id);
        batch.set(ref, {
            createdAt: now,
            updatedAt: now,
            status: 'pending',
            subscriberUid: ctx.subscriberUid,
            friendUid: ctx.friendUid,
            beaconId: ctx.beaconId,
            token: ctx.token,
        }, { merge: true });
    }
    await batch.commit();
}
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
// ===== Core sender =====
async function fanOutForBeacon(beaconId, b) {
    const ownerUid = b.ownerUid;
    if (!ownerUid)
        return;
    const recipients = await eligibleRecipients(b.allowedUids, ownerUid);
    if (recipients.length === 0)
        return;
    const title = titleFor(b);
    const body = summarize(b);
    for (const recipientUid of recipients) {
        const tokens = await getAllExpoTokens(recipientUid);
        if (tokens.length === 0)
            continue;
        const messages = tokens.map((token) => ({
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
                    const tok = msgs[i].to;
                    await saveTickets([t], {
                        subscriberUid: recipientUid,
                        friendUid: ownerUid,
                        token: tok,
                        beaconId,
                    });
                }
            }
            catch (err) {
                logger.error('Expo send error', { recipientUid, ownerUid, beaconId, err });
            }
        }
    }
}
// ===== Triggers (v2) =====
// 1) Brand new beacon that starts active
export const onBeaconCreatedNotify = onDocumentCreated('Beacons/{beaconId}', async (event) => {
    const b = event.data?.data() ?? undefined;
    if (!b || b.active !== true)
        return;
    const beaconId = event.params.beaconId;
    await fanOutForBeacon(beaconId, b);
});
// 2) Existing beacon flipping inactive -> active
export const onBeaconActivatedNotify = onDocumentUpdated('Beacons/{beaconId}', async (event) => {
    const before = event.data?.before?.data() ?? undefined;
    const after = event.data?.after?.data() ?? undefined;
    if (!after)
        return;
    const wasActive = before?.active === true;
    const nowActive = after.active === true;
    if (!(nowActive && !wasActive))
        return;
    const beaconId = event.params.beaconId;
    await fanOutForBeacon(beaconId, after);
});
// 3) Receipt checker & token pruning (v2 scheduler)
export const checkExpoReceipts = onSchedule('every 15 minutes', async () => {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - TICKET_TTL_HOURS * 60 * 60 * 1000));
    const pending = await db
        .collection('expoPushTickets')
        .where('status', '==', 'pending')
        .where('createdAt', '>', cutoff)
        .limit(2000)
        .get();
    if (pending.empty)
        return;
    const ids = [];
    const metaById = {};
    pending.forEach((d) => {
        ids.push(d.id);
        const data = d.data();
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
                if (!meta)
                    continue;
                if (rec.status === 'ok') {
                    batch.update(meta.ref, {
                        status: 'ok',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                else {
                    batch.update(meta.ref, {
                        status: 'error',
                        error: rec.message ?? null,
                        details: rec.details ?? null,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                    const code = rec.details?.error;
                    if (code === 'DeviceNotRegistered') {
                        await removeTokenEverywhere(meta.subscriberUid, meta.token);
                    }
                }
            }
            await batch.commit();
        }
        catch (err) {
            logger.error('Receipt check error', err);
        }
    }
});
// Keep callable export (ESM requires .js suffix)
export { deleteAccountDataV2 } from './deleteAccountV2.js';
