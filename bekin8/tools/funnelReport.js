#!/usr/bin/env node
// tools/funnelReport.js
//
// The new-user funnel, read straight from Firestore (no analytics console needed). For everyone
// who signed up in the last N days it prints, per weekly cohort and per signup source:
//
//   signups -> has username -> first friend (and within 24h) -> lit a beacon
//           -> a beacon that reached someone -> invited at least one person -> came back day 1 / day 7
//
// plus who the top inviters are. The stamps come from functions/src/funnel.ts and redeemInvite.ts
// (firstFriendAt, firstBeaconAt, firstBeaconReachedAt, invitedBy, inviteCount), lib/signupMeta.ts
// (signupMethod, signupPlatform, installReferrer) and the daily activeDays stamp in app/_layout.tsx.
// Accounts created before those shipped only have createdAt, so their later columns read low.
//
//   node tools/funnelReport.js            last 30 days
//   node tools/funnelReport.js 90         last 90 days
//   node tools/funnelReport.js 90 --backfill   first fill in older accounts from existing data
//
// Auth: application default credentials, same as the other tools here
// (gcloud auth application-default login).
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

admin.initializeApp({ projectId: 'waldgrave-profiles' });
const db = admin.firestore();

const days = Math.max(1, parseInt(process.argv[2] || '30', 10) || 30);
const DAY = 86_400_000;
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%`.padStart(4) : '   -');
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

/** Where an account came from, as far as we can tell. */
function sourceOf(u) {
  if (u.invitedBy) return u.invitedToBeacon ? 'friend (beacon link)' : 'friend (invite link)';
  const ref = String(u.installReferrer || '');
  const utm = /utm_source=([^&]+)/.exec(ref);
  if (/gclid=/.test(ref)) return 'ad (google)';
  if (utm && !/google-play|\(not set\)/.test(utm[1])) return `ad/campaign (${decodeURIComponent(utm[1])})`;
  return 'direct / unknown';
}

function row(label, list) {
  const n = list.length;
  const c = (f) => list.filter(f).length;
  const friend = c((u) => u.firstFriendAt);
  const friend24 = c((u) => u.firstFriendAt && ms(u.firstFriendAt) - ms(u.createdAt) <= DAY);
  const lit = c((u) => u.firstBeaconAt);
  const reached = c((u) => u.firstBeaconReachedAt);
  const inviter = c((u) => (u.inviteCount || 0) > 0);
  const back = (k) =>
    c((u) => Array.isArray(u.activeDays) && u.activeDays.some((d) => d >= dayStr(ms(u.createdAt) + k * DAY)));
  // Day-7 retention only means something for accounts at least 7 days old.
  const old7 = list.filter((u) => Date.now() - ms(u.createdAt) >= 7 * DAY);
  const back7 = old7.filter(
    (u) => Array.isArray(u.activeDays) && u.activeDays.some((d) => d >= dayStr(ms(u.createdAt) + 7 * DAY))
  ).length;
  console.log(
    `${label.padEnd(26)} ${String(n).padStart(5)}  ${pct(c((u) => u.hasUsername || u.username), n)}  ${pct(friend, n)}  ${pct(friend24, n)}  ${pct(lit, n)}  ${pct(reached, n)}  ${pct(inviter, n)}  ${pct(back(1), n)}  ${pct(back7, old7.length)}`
  );
}

/**
 * --backfill: accounts that predate the server stamps get firstFriendAt / firstBeaconAt filled in
 * from what Firestore already holds (their earliest friendship and earliest beacon), plus
 * hasUsername from their profile. Additive only: an existing stamp is never touched.
 */
async function backfill(users) {
  let wrote = 0;
  for (const u of users) {
    const patch = {};
    if (!u.firstFriendAt) {
      const edges = await db.collection('FriendEdges').where('uids', 'array-contains', u.id).get();
      const times = edges.docs.map((d) => ms(d.data().createdAt)).filter(Boolean);
      if (times.length) patch.firstFriendAt = admin.firestore.Timestamp.fromMillis(Math.min(...times));
      else if (!edges.empty) patch.firstFriendAt = u.createdAt; // legacy edge with no timestamp
    }
    if (!u.firstBeaconAt) {
      const beacons = await db.collection('Beacons').where('ownerUid', '==', u.id).get();
      const times = beacons.docs.map((d) => ms(d.data().createdAt)).filter(Boolean);
      if (times.length) patch.firstBeaconAt = admin.firestore.Timestamp.fromMillis(Math.min(...times));
    }
    if (!u.hasUsername) {
      const p = (await db.collection('Profiles').doc(u.id).get()).data() || {};
      if (typeof p.username === 'string' && p.username.trim()) patch.hasUsername = true;
    }
    if (Object.keys(patch).length) {
      await db.collection('users').doc(u.id).set(patch, { merge: true });
      Object.assign(u, patch);
      wrote += 1;
    }
  }
  console.log(`backfill: filled in ${wrote} of ${users.length} accounts`);
}

(async () => {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - days * DAY);
  const snap = await db.collection('users').where('createdAt', '>=', since).get();
  const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (process.argv.includes('--backfill')) await backfill(users);
  console.log(`\nBeKin new-user funnel: ${users.length} signups in the last ${days} days\n`);
  const head = `${''.padEnd(26)} ${'new'.padStart(5)}  name  frnd  <24h   lit  rchd  invt    d1    d7`;

  console.log('BY WEEK (signup date)');
  console.log(head);
  const weeks = new Map();
  for (const u of users) {
    const d = new Date(ms(u.createdAt));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const k = dayStr(d.getTime());
    weeks.set(k, [...(weeks.get(k) || []), u]);
  }
  [...weeks.keys()].sort().forEach((k) => row(`week of ${k}`, weeks.get(k)));
  row('ALL', users);

  console.log('\nBY SOURCE');
  console.log(head);
  const sources = new Map();
  for (const u of users) sources.set(sourceOf(u), [...(sources.get(sourceOf(u)) || []), u]);
  [...sources.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([k, l]) => row(k, l));

  console.log('\nBY SIGNUP METHOD / PLATFORM');
  console.log(head);
  const methods = new Map();
  for (const u of users) {
    const k = `${u.signupMethod || '?'} / ${u.signupPlatform || '?'}`;
    methods.set(k, [...(methods.get(k) || []), u]);
  }
  [...methods.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([k, l]) => row(k, l));

  // Invites: how many of these signups were brought in by someone, and by whom.
  const invited = users.filter((u) => u.invitedBy);
  console.log(`\nINVITES: ${invited.length} of ${users.length} signups came through a friend's link` +
    ` (${invited.filter((u) => u.invitedToBeacon).length} from a shared beacon).`);
  const byInviter = new Map();
  for (const u of invited) byInviter.set(u.invitedBy, (byInviter.get(u.invitedBy) || 0) + 1);
  const top = [...byInviter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [uid, n] of top) {
    const p = (await db.collection('Profiles').doc(uid).get()).data() || {};
    console.log(`  ${String(n).padStart(3)}  ${p.displayName || p.username || uid}`);
  }
  console.log(
    '\nColumns: name = has a username, frnd = got a friend, <24h = within a day of signing up,\n' +
      'lit = lit a beacon, rchd = a beacon reached at least one friend, invt = brought someone in,\n' +
      'd1 / d7 = opened the app again on or after day 1 / day 7 (d7 counts only accounts 7+ days old).\n'
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
