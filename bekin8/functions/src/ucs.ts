// functions/src/ucs.ts
// COMPLAINT MODE: a post written as a complaint is also recorded on the Universal Complaint System
// (UCS, Brian's other app; its own Firebase project). The app never talks to UCS directly: these two
// callables pass the complaint to UCS's `partner` endpoint with a shared secret, naming the BeKin
// account by uid. UCS turns that into an account of its own with a random public name, so nothing
// about the BeKin user (name, username, friends) ever reaches UCS or its public record.
//
// IDENTITY. What UCS is told is not the BeKin uid itself but `<uid>-g<gen>`, a UCS account with
// its own random public name. UcsIdentity/{uid} (no rules block: server only) holds gen and name.
// Brian's rules for the name (2026-11-25):
//   * They can SHUFFLE it freely while deciding. Until something has been posted under the current
//     name, a pick just renames that UCS account in place.
//   * Once they have posted under it, picking another is held as `pending` and becomes a brand-new
//     UCS account (gen + 1) the next time they write a complaint. Complaints already posted keep
//     the old name; on UCS the two can't be tied together.
//   * ONE new name a day: after a switch, no other switch for 24 hours.
//   * Nothing is lost on BeKin: users/{uid}/complaints is keyed by the BeKin account, so their
//     profile lists every complaint under every name they have used.
//   * An account UCS suspended can't write or switch (no shedding a ban).
// Checks are also counted per BeKin account here, since each new name starts fresh limits on UCS.
//
//   ucsName({options?, choose?})  their complaint name; options: a dozen to shuffle; choose: pick one.
//   ucsAnalyze({text, notSure})   the UCS model reads it. Nothing is public yet.
//   ucsSubmit({draftId, ...})     the author saw the result and confirms: it goes on the record.
//
// What comes back from submit is kept in users/{uid}/complaints/{submissionId} (owner-only): the
// UCS id and link live THERE and never on the Posts doc, because the UCS page shows the author's
// random name, and a friend who learned it could find that person's other complaints.
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const UCS_PARTNER_KEY = defineSecret('UCS_PARTNER_KEY');
const UCS_PARTNER_URL = 'https://us-central1-universal-complaint-system.cloudfunctions.net/partner';

const CODES: Record<number, FunctionsErrorCode> = {
  400: 'invalid-argument',
  403: 'permission-denied',
  404: 'not-found',
  412: 'failed-precondition',
  429: 'resource-exhausted',
  503: 'unavailable',
};

type Identity = {
  gen: number;
  name: string | null;
  /** A name picked after posting under the current one: used from their next complaint on. */
  pending: string | null;
  /** Something has been posted under the current name. */
  posted: boolean;
  switchedAt: number;
  terms: boolean;
  banned: boolean;
  /** Times of recent model checks (BeKin-side daily limit). */
  checks: number[];
};
const DAY = 24 * 3600_000;
const CHECKS_A_DAY = 30;

async function identity(uid: string): Promise<Identity> {
  const d = (await db.doc(`UcsIdentity/${uid}`).get()).data() as any;
  return {
    gen: Number.isInteger(d?.gen) ? d.gen : 0,
    name: typeof d?.name === 'string' && d.name ? d.name : null,
    pending: typeof d?.pending === 'string' && d.pending ? d.pending : null,
    posted: d?.posted === true,
    switchedAt: typeof d?.switchedAt === 'number' ? d.switchedAt : 0,
    terms: d?.terms === true,
    banned: d?.banned === true,
    checks: Array.isArray(d?.checks) ? d.checks.filter((t: any) => typeof t === 'number' && Date.now() - t < DAY) : [],
  };
}
const ucsUid = (uid: string, gen: number) => `${uid}-g${gen}`;

/** UCS suspended this identity: remember it on the BeKin account so a name change can't shed it. */
async function callAs(uid: string, id: Identity, body: Record<string, unknown>): Promise<any> {
  if (id.banned) throw new HttpsError('permission-denied', 'This account was suspended from the Universal Complaint System.');
  try {
    return await callUcs({ ...body, uid: ucsUid(uid, id.gen) });
  } catch (e) {
    if (e instanceof HttpsError && e.code === 'permission-denied') {
      await db.doc(`UcsIdentity/${uid}`).set({ banned: true }, { merge: true });
    }
    throw e;
  }
}

async function callUcs(body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(UCS_PARTNER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-key': UCS_PARTNER_KEY.value() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (e) {
    logger.error('ucs: unreachable', e);
    throw new HttpsError('unavailable', "Couldn't reach the complaint system. Try again in a moment.");
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    // UCS's own messages are written for the person (why it can't post, limits): pass them on.
    const msg = typeof json?.error?.message === 'string' ? json.error.message : 'Something went wrong. Try again.';
    if (res.status === 403 && !/suspended/i.test(msg)) {
      logger.error('ucs: partner key refused');
      throw new HttpsError('internal', 'Something went wrong. Try again.');
    }
    throw new HttpsError(CODES[res.status] ?? 'internal', msg);
  }
  return json;
}

export const ucsAnalyze = onCall({ enforceAppCheck: true, secrets: [UCS_PARTNER_KEY], timeoutSeconds: 120 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const text = typeof req.data?.text === 'string' ? req.data.text.trim().slice(0, 4000) : '';
  if (!text) throw new HttpsError('invalid-argument', 'Write your complaint first.');
  const id = await identity(uid);
  if (id.checks.length >= CHECKS_A_DAY) throw new HttpsError('resource-exhausted', 'You have hit the limit for now. Try again later.');
  const ref = db.doc(`UcsIdentity/${uid}`);
  // A name picked after posting under the last one starts here: a new UCS account, named.
  if (id.pending && !id.banned) {
    id.gen += 1;
    const made = await callAs(uid, id, { action: 'profile', name: id.pending });
    id.name = String(made?.displayName ?? id.pending);
    await ref.set({ gen: id.gen, name: id.name, pending: null, posted: false, switchedAt: Date.now() }, { merge: true });
  }
  await ref.set({ checks: [...id.checks, Date.now()] }, { merge: true });
  const out = await callAs(uid, id, { action: 'analyze', text, notSure: req.data?.notSure === true });
  // They agree to UCS's terms once, here; a later name doesn't ask again.
  return { ...out, termsAccepted: id.terms || out?.termsAccepted === true };
});

export const ucsName = onCall({ enforceAppCheck: true, secrets: [UCS_PARTNER_KEY], timeoutSeconds: 60 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const id = await identity(uid);
  const ref = db.doc(`UcsIdentity/${uid}`);

  if (req.data?.options === true) {
    const out = await callAs(uid, id, { action: 'names' });
    const current = id.pending ?? id.name;
    return { names: (Array.isArray(out?.names) ? out.names : []).filter((n: unknown) => typeof n === 'string' && n !== current) };
  }

  const choose = typeof req.data?.choose === 'string' ? req.data.choose.trim().slice(0, 40) : '';
  if (choose) {
    if (id.banned) throw new HttpsError('permission-denied', 'This account was suspended from the Universal Complaint System.');
    if (choose === (id.pending ?? id.name)) return { name: choose };
    if (!id.posted) {
      // Nothing posted under the current name yet: it is simply renamed.
      const out = await callAs(uid, id, { action: 'profile', name: choose });
      const name = String(out?.displayName ?? choose);
      await ref.set({ gen: id.gen, name, pending: null }, { merge: true });
      return { name };
    }
    if (Date.now() - id.switchedAt < DAY) {
      throw new HttpsError('resource-exhausted', 'You can post under one new name a day. Pick another tomorrow.');
    }
    // UCS checks the name is one of its own when the new account is made (ucsAnalyze); keep junk out now.
    if (!/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(choose)) throw new HttpsError('invalid-argument', 'Pick one of the names offered.');
    await ref.set({ pending: choose }, { merge: true });
    return { name: choose };
  }

  if (id.pending ?? id.name) return { name: id.pending ?? id.name };
  const out = await callAs(uid, id, { action: 'profile' });
  const name = String(out?.displayName ?? '');
  await ref.set({ gen: id.gen, name }, { merge: true });
  return { name };
});

export const ucsSubmit = onCall({ enforceAppCheck: true, secrets: [UCS_PARTNER_KEY], timeoutSeconds: 120 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const d = req.data ?? {};
  const draftId = typeof d.draftId === 'string' ? d.draftId : '';
  if (!draftId) throw new HttpsError('invalid-argument', 'draftId required.');
  const id = await identity(uid);
  if (!id.terms && d.acceptTerms !== true) throw new HttpsError('failed-precondition', 'Agree to the terms of use first.');
  const out = await callAs(uid, id, {
    action: 'submit',
    draftId,
    useRewrite: d.useRewrite === true,
    removePII: d.removePII !== false,
    keepPoints: Array.isArray(d.keepPoints) ? d.keepPoints : undefined,
    acceptTerms: true,
  });
  await db.doc(`UcsIdentity/${uid}`).set({ terms: true, posted: true, ...(typeof out?.authorName === 'string' ? { name: out.authorName } : {}) }, { merge: true });
  const submissionId = String(out?.submissionId ?? '');
  if (submissionId) {
    await db.doc(`users/${uid}/complaints/${submissionId}`).set({
      url: typeof out.url === 'string' ? out.url : null,
      authorName: typeof out.authorName === 'string' ? out.authorName : null,
      joined: Array.isArray(out.matchedPointIds) ? out.matchedPointIds.length : 0,
      added: Array.isArray(out.addedPointIds) ? out.addedPointIds.length : 0,
      visibility: ['feed', 'profile', 'hidden'].includes(d.visibility) ? d.visibility : 'feed',
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return {
    submissionId,
    url: out?.url ?? null,
    authorName: out?.authorName ?? null,
    joined: Array.isArray(out?.matchedPointIds) ? out.matchedPointIds.length : 0,
    added: Array.isArray(out?.addedPointIds) ? out.addedPointIds.length : 0,
  };
});
