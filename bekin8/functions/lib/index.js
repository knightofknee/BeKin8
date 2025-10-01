"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBeaconCreatedNotify = exports.onBeaconActivatedNotify = void 0;
// functions/src/index.ts
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_functions_1 = require("firebase-functions");
admin.initializeApp();
const db = admin.firestore();
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Helper: get a user's Expo token (adjust to your storage path if different)
async function getExpoToken(uid) {
    // Try Profiles/{uid}.expoPushToken first
    const prof = await db.collection('Profiles').doc(uid).get();
    const t1 = prof.exists ? prof.data()?.expoPushToken : undefined;
    if (t1 && /^ExponentPushToken/.test(t1))
        return t1;
    // Fallback to users/{uid}.expoPushToken
    const u = await db.collection('users').doc(uid).get();
    const t2 = u.exists ? u.data()?.expoPushToken : undefined;
    if (t2 && /^ExponentPushToken/.test(t2))
        return t2;
    return null;
}
// Helper: has recipient enabled notify for this owner?
async function recipientWantsNotify(recipientUid, ownerUid) {
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
function summarize(beacon) {
    return (beacon.message || beacon.details || 'A new beacon was lit').toString();
}
// --- Trigger: when an existing Beacon flips from inactive -> active ---
exports.onBeaconActivatedNotify = (0, firestore_1.onDocumentUpdated)('Beacons/{beaconId}', async (event) => {
    const before = event.data?.before?.data() ?? undefined;
    const after = event.data?.after?.data() ?? undefined;
    if (!after)
        return;
    const wasActive = before?.active === true;
    const nowActive = after.active === true;
    // Only fire when it transitions to active
    if (!(nowActive && !wasActive))
        return;
    const beaconId = event.params.beaconId;
    const ownerUid = after.ownerUid;
    const allowed = Array.isArray(after.allowedUids) ? after.allowedUids : [];
    const recipients = allowed.filter((u) => u && u !== ownerUid);
    if (recipients.length === 0)
        return;
    // Filter by per-recipient preferences and fetch tokens
    const eligible = [];
    await Promise.all(recipients.map(async (uid) => {
        const wants = await recipientWantsNotify(uid, ownerUid);
        if (!wants)
            return;
        const token = await getExpoToken(uid);
        if (token)
            eligible.push({ uid, token });
    }));
    if (eligible.length === 0)
        return;
    const title = after.ownerName ? `${after.ownerName} lit a beacon` : `A friend lit a beacon`;
    const body = summarize(after);
    await Promise.all(eligible.map(async ({ token }) => {
        try {
            const res = await globalThis.fetch(EXPO_PUSH_URL, {
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
                firebase_functions_1.logger.error('Expo push send failed (update)', res.status, txt);
            }
        }
        catch (err) {
            firebase_functions_1.logger.error('Expo push network error (update)', err);
        }
    }));
});
// --- Trigger: when a brand new active Beacon is created ---
exports.onBeaconCreatedNotify = (0, firestore_1.onDocumentCreated)('Beacons/{beaconId}', async (event) => {
    const b = event.data?.data() ?? undefined;
    if (!b || b.active !== true)
        return;
    const beaconId = event.params.beaconId;
    const ownerUid = b.ownerUid;
    const allowed = Array.isArray(b.allowedUids) ? b.allowedUids : [];
    const recipients = allowed.filter((u) => u && u !== ownerUid);
    if (recipients.length === 0)
        return;
    // Filter by per-recipient preferences and fetch tokens
    const eligible = [];
    await Promise.all(recipients.map(async (uid) => {
        const wants = await recipientWantsNotify(uid, ownerUid);
        if (!wants)
            return;
        const token = await getExpoToken(uid);
        if (token)
            eligible.push({ uid, token });
    }));
    if (eligible.length === 0)
        return;
    const title = b.ownerName ? `${b.ownerName} lit a beacon` : `A friend lit a beacon`;
    const body = summarize(b);
    // Send to Expo
    await Promise.all(eligible.map(async ({ token }) => {
        try {
            const res = await globalThis.fetch(EXPO_PUSH_URL, {
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
                firebase_functions_1.logger.error('Expo push send failed (create)', res.status, txt);
            }
        }
        catch (err) {
            firebase_functions_1.logger.error('Expo push network error (create)', err);
        }
    }));
});
//# sourceMappingURL=index.js.map