// functions/src/guestBeacon.ts
// The web side of sharing a beacon with people who are not on BeKin yet.
//
//   ensureBeaconShare({beaconId})  callable, owner only: mints the beacon's share token.
//   invitePreview   GET  ?code=&b=   who invited you + their open beacon, for the invite web page.
//   guestRsvp       POST {code,b?,guestId,name,on}   "I'm in" from the web, no account.
//   guestChat       GET  ?code=&b=&guestId=   /  POST {code,b,guestId,name,text}
//
// A share link is the owner's friend link plus the token: /bekin/invite/CODE?b=TOKEN. The token is
// what proves the OWNER chose to show this beacon outside the app, so it unlocks more than a bare
// friend link does:
//   bare friend link  -> shows the inviter's open beacon only when it is for ALL their friends
//                        (whoever taps the link becomes a friend and would see it anyway); RSVP only.
//   link with a token -> shows that beacon whatever its audience, and opens its chat to the guest.
//
// Guests are written into the beacon's ChatMessages by the Admin SDK with uid "guest_<id>" (the id
// is a random string the browser keeps), so the app shows them in the going line and the chat like
// anyone else, and the existing chat/RSVP push trigger tells the owner. BeaconShares and GuestRate
// have no rules block: clients can never touch them.
import { createHash, randomBytes } from 'node:crypto';
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { whenLabel } from './beaconWhen.js';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const CORS = ['https://www.waldgrave.com', 'https://waldgrave.com', 'http://localhost:3000'];
const CODE_RE = /^[A-Z0-9]{6}$/;
export const TOKEN_RE = /^[a-z0-9]{16}$/;
const GUEST_RE = /^[a-z0-9]{12,32}$/;
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** One line, no control characters, capped. */
const tidy = (v: unknown, max: number): string =>
  clean(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, max);

function genToken(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

// ---- share token ----

export const ensureBeaconShare = onCall({ enforceAppCheck: true }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const beaconId = clean(req.data?.beaconId);
  if (!beaconId) throw new HttpsError('invalid-argument', 'beaconId required.');
  const beacon = await db.collection('Beacons').doc(beaconId).get();
  if (!beacon.exists || (beacon.data() as any)?.ownerUid !== uid) {
    throw new HttpsError('permission-denied', 'Only the owner can share a beacon.');
  }
  const existing = await db.collection('BeaconShares').where('beaconId', '==', beaconId).limit(1).get();
  if (!existing.empty) return { token: existing.docs[0].id };
  const token = genToken();
  await db.collection('BeaconShares').doc(token).set({
    beaconId,
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { token };
});

/** The beacon a share token points at, when the token belongs to `ownerUid`. */
export async function sharedBeaconId(token: string, ownerUid: string): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  const snap = await db.collection('BeaconShares').doc(token).get();
  const d = snap.data() as any;
  return snap.exists && d?.ownerUid === ownerUid && typeof d?.beaconId === 'string' ? d.beaconId : null;
}

// ---- resolving what a link may show ----

type Resolved = {
  inviterUid: string;
  inviterName: string;
  /** The beacon this link shows, if any. */
  beacon: { id: string; data: any } | null;
  /** The link carried a valid share token (chat allowed). */
  shared: boolean;
  /** A shared beacon that has since been put out or expired. */
  ended: boolean;
};

const isLive = (b: any, nowMs: number): boolean => {
  const exp = b?.expiresAt?.toMillis?.() ?? 0;
  return b?.active === true && (!exp || exp > nowMs);
};

async function resolveLink(codeRaw: unknown, tokenRaw: unknown): Promise<Resolved | null> {
  const code = clean(codeRaw).toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const inv = await db.collection('Invites').doc(code).get();
  const inviterUid = inv.exists ? clean((inv.data() as any)?.uid) : '';
  if (!inviterUid) return null;

  const prof = ((await db.collection('Profiles').doc(inviterUid).get()).data() as any) ?? {};
  const inviterName = clean(prof.displayName) || clean(prof.username) || 'A friend';
  const nowMs = Date.now();
  const out: Resolved = { inviterUid, inviterName, beacon: null, shared: false, ended: false };

  const token = clean(tokenRaw);
  if (token) {
    const beaconId = await sharedBeaconId(token, inviterUid);
    if (beaconId) {
      const snap = await db.collection('Beacons').doc(beaconId).get();
      if (snap.exists && isLive(snap.data(), nowMs)) {
        out.beacon = { id: snap.id, data: snap.data() };
        out.shared = true;
      } else {
        out.ended = true;
      }
      return out;
    }
  }

  // No token: the inviter's own open beacon, only when it is for all of their friends.
  const qs = await db.collection('Beacons').where('ownerUid', '==', inviterUid).where('active', '==', true).get();
  const open = qs.docs
    .map((d) => ({ id: d.id, data: d.data() as any }))
    .filter(({ data }) => {
      const scoped =
        (Array.isArray(data.groupIds) && data.groupIds.length > 0) ||
        (Array.isArray(data.friendUids) && data.friendUids.length > 0) ||
        (Array.isArray(data.allowedUids) && data.allowedUids.length > 0);
      return isLive(data, nowMs) && !data.rallyOf && !scoped;
    })
    .sort((a, b) => (a.data.startAt?.toMillis?.() ?? 0) - (b.data.startAt?.toMillis?.() ?? 0));
  out.beacon = open[0] ?? null;
  return out;
}

async function goingNames(beaconId: string, ownerUid: string): Promise<string[]> {
  const qs = await db
    .collection('Beacons')
    .doc(beaconId)
    .collection('ChatMessages')
    .where('type', '==', 'system')
    .where('subtype', '==', 'im-in')
    .get();
  const byActor = new Map<string, { name: string; at: number }>();
  qs.forEach((d) => {
    const m = d.data() as any;
    const actor = clean(m.actorUid);
    if (!actor || actor === ownerUid || byActor.has(actor)) return;
    byActor.set(actor, { name: (clean(m.actorName) || 'Someone').split(' ')[0], at: m.createdAt?.toMillis?.() ?? 0 });
  });
  return Array.from(byActor.values())
    .sort((a, b) => a.at - b.at)
    .map((g) => g.name);
}

// ---- rate limiting (per network, since guests have no account) ----

const ipHash = (ip: string) => createHash('sha256').update(`bekin-guest|${ip}`).digest('hex');
function callerIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const first = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return first || req.ip || '';
}
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_WRITES = 40;

/** Counts one guest write against this network. False = over budget, refuse. */
async function allowWrite(ip: string): Promise<boolean> {
  if (!ip) return false;
  const ref = db.collection('GuestRate').doc(ipHash(ip));
  return db.runTransaction(async (tx) => {
    const d = ((await tx.get(ref)).data() as any) ?? {};
    const now = Date.now();
    const fresh = now - (Number(d.windowStart) || 0) > RATE_WINDOW_MS;
    const count = fresh ? 0 : Number(d.count) || 0;
    if (count >= RATE_MAX_WRITES) return false;
    tx.set(ref, {
      windowStart: fresh ? now : d.windowStart,
      count: count + 1,
      expiresAt: Timestamp.fromMillis(now + 2 * RATE_WINDOW_MS),
    });
    return true;
  });
}

// ---- endpoints ----

export const invitePreview = onRequest({ cors: CORS }, async (req, res) => {
  const link = await resolveLink(req.query.code, req.query.b);
  if (!link) {
    res.status(404).json({ ok: false });
    return;
  }
  let beacon: Record<string, unknown> | null = null;
  if (link.beacon) {
    const b = link.beacon.data;
    const going = await goingNames(link.beacon.id, link.inviterUid);
    const pollOpen = b?.timePoll?.status === 'open';
    beacon = {
      when: pollOpen ? '' : whenLabel(b),
      pollOpen,
      message: tidy(b.message || b.details, 300),
      going: going.slice(0, 12),
      goingCount: going.length,
      canChat: link.shared,
    };
  }
  res.set('Cache-Control', 'public, max-age=15');
  res.json({ ok: true, inviterName: link.inviterName, beacon, ended: link.ended });
});

export const guestRsvp = onRequest({ cors: CORS }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  const body = (req.body ?? {}) as any;
  const guestId = clean(body.guestId);
  const name = tidy(body.name, 30);
  const on = body.on !== false;
  if (!GUEST_RE.test(guestId) || (on && !name)) {
    res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    return;
  }
  const link = await resolveLink(body.code, body.b);
  if (!link?.beacon) {
    res.status(404).json({ ok: false, error: 'NO_BEACON' });
    return;
  }
  if (!(await allowWrite(callerIp(req as any)))) {
    res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    return;
  }
  const b = link.beacon.data;
  const actorUid = `guest_${guestId}`;
  // One fixed doc per guest: re-sending is an overwrite, so the "RSVP'd" push fires once.
  const ref = db.collection('Beacons').doc(link.beacon.id).collection('ChatMessages').doc(`${actorUid}_rsvp`);
  if (!on) {
    await ref.delete();
    res.json({ ok: true, on: false });
    return;
  }
  const exists = (await ref.get()).exists;
  await ref.set(
    {
      type: 'system',
      subtype: 'im-in',
      guest: true,
      actorUid,
      actorName: name,
      authorUid: actorUid,
      text: `${name} RSVP'd`,
      ...(Array.isArray(b.audienceUids) && b.audienceUids.length ? { audienceUids: b.audienceUids } : {}),
      ...(exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      ...(b.expiresAt instanceof Timestamp ? { expiresAt: b.expiresAt } : {}),
    },
    { merge: true }
  );
  if (!exists) logger.info('guestRsvp', { beaconId: link.beacon.id, shared: link.shared });
  res.json({ ok: true, on: true });
});

export const guestChat = onRequest({ cors: CORS }, async (req, res) => {
  const src = (req.method === 'POST' ? req.body : req.query) as any;
  const guestId = clean(src?.guestId);
  if (!GUEST_RE.test(guestId)) {
    res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    return;
  }
  const link = await resolveLink(src?.code, src?.b);
  // Chat needs the share token: a bare friend link never opens anyone's conversation.
  if (!link?.beacon || !link.shared) {
    res.status(404).json({ ok: false, error: 'NO_BEACON' });
    return;
  }
  const b = link.beacon.data;
  const col = db.collection('Beacons').doc(link.beacon.id).collection('ChatMessages');
  const me = `guest_${guestId}`;

  if (req.method === 'POST') {
    const name = tidy(src.name, 30);
    const text = clean(src.text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').slice(0, 500);
    if (!name || !text) {
      res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
      return;
    }
    if (!(await allowWrite(callerIp(req as any)))) {
      res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
      return;
    }
    await col.add({
      type: 'user',
      guest: true,
      text,
      authorUid: me,
      authorName: `${name} (guest)`,
      ...(Array.isArray(b.audienceUids) && b.audienceUids.length ? { audienceUids: b.audienceUids } : {}),
      createdAt: FieldValue.serverTimestamp(),
      ...(b.expiresAt instanceof Timestamp ? { expiresAt: b.expiresAt } : {}),
    });
  } else if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const qs = await col.orderBy('createdAt', 'desc').limit(60).get();
  const messages = qs.docs
    .map((d) => ({ id: d.id, m: d.data() as any }))
    .filter(({ m }) => m.type !== 'system' || m.subtype === 'im-in')
    .reverse()
    .map(({ id, m }) => {
      const system = m.type === 'system';
      return {
        id,
        system,
        name: clean(system ? m.actorName : m.authorName) || 'Someone',
        text: system ? (m.rally ? 'is rallying' : 'is in') : m.kind === 'gif' ? 'sent a GIF' : clean(m.text),
        at: m.createdAt?.toMillis?.() ?? 0,
        mine: (system ? m.actorUid : m.authorUid) === me,
      };
    });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, messages });
});
