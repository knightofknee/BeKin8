#!/usr/bin/env node
// tools/setLatestVersion.js
//
// The update dials on Config/app. iOS uses the BINARY version scheme (the one
// EAS stamps from app.json); Android uses the build number (versionCode),
// since Android builds share a version name (see lib/appUpdate.ts):
//
//   WARN   latestVersion / androidLatestBuild  older builds get UpdateModal's
//                                              snoozable nudge
//   BLOCK  minVersion / androidMinBuild        older builds get
//                                              UpdateRequiredGate's full-screen
//                                              block (no skip)
//
// The block also needs required: true, which this script keeps true while
// either floor is set and clears once neither is, so it can never drift.
//
//   node tools/setLatestVersion.js 1.2.28                          iOS warn only
//   node tools/setLatestVersion.js 1.2.28 --min-version 1.2.28     iOS warn + block
//   node tools/setLatestVersion.js --min-version ""                lift the iOS block
//   node tools/setLatestVersion.js --android-latest 14             Android warn
//   node tools/setLatestVersion.js --android-min 14                Android block ("" lifts)
//   ... --message "Text shown on the card and block screen"        optional copy
//
// Each store's dial moves on its own: flip it once THAT store serves the build,
// so nobody is sent to a page with nothing to install. The iOS block reaches
// every build from 1.2.25 on (the first to ship UpdateRequiredGate); older
// builds have no gate code. Android builds up to versionCode 13 predate the
// build dials and still read latestVersion / minVersion. A floor may never sit
// above its platform's latest.
//
// Auth: uses Application Default Credentials (gcloud auth application-default login).

const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'waldgrave-profiles';
const DOTTED = /^\d+(\.\d+)*$/;

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? '') : null;
}
const version = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const minVersion = flag('min-version');
const androidLatest = flag('android-latest');
const androidMin = flag('android-min');
const message = flag('message');
const WHOLE = /^[1-9]\d*$/;

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'Usage: node tools/setLatestVersion.js [<latest, e.g. 1.2.28>] [--min-version <floor>|""]' +
      ' [--android-latest <build>] [--android-min <build>|""] [--message "..."]'
  );
  process.exit(1);
}
if (!version && minVersion === null && androidLatest === null && androidMin === null && message === null) usage();
if (version && !DOTTED.test(version)) usage(`Not a dotted version: ${version}`);
if (minVersion && !DOTTED.test(minVersion)) usage(`Not a dotted version: ${minVersion}`);
if (androidLatest !== null && !WHOLE.test(androidLatest)) usage(`Not a build number: ${androidLatest}`);
if (androidMin && !WHOLE.test(androidMin)) usage(`Not a build number: ${androidMin}`);

function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

admin.initializeApp({ projectId: PROJECT_ID });
const ref = admin.firestore().doc('Config/app');

(async () => {
  const current = (await ref.get()).data() || {};
  const latest = version || current.latestVersion || '';
  const floor = minVersion !== null ? minVersion : current.minVersion || '';
  if (floor && latest && compare(floor, latest) > 0) {
    usage(`minVersion ${floor} is above latestVersion ${latest}: that would block the current release.`);
  }
  const whole = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  const aLatest = androidLatest !== null ? Number(androidLatest) : whole(current.androidLatestBuild);
  const aFloor = androidMin !== null ? Number(androidMin || 0) : whole(current.androidMinBuild);
  if (aFloor && aLatest && aFloor > aLatest) {
    usage(`androidMinBuild ${aFloor} is above androidLatestBuild ${aLatest}: that would block the current release.`);
  }
  const update = {};
  if (version) update.latestVersion = version;
  if (minVersion !== null) {
    update.minVersion = minVersion || admin.firestore.FieldValue.delete();
  }
  if (androidLatest !== null) update.androidLatestBuild = Number(androidLatest);
  if (androidMin !== null) {
    update.androidMinBuild = androidMin ? Number(androidMin) : admin.firestore.FieldValue.delete();
  }
  // One `required` covers both floors: true while either is set, false once neither is.
  if (minVersion !== null || androidMin !== null) update.required = Boolean(floor || aFloor);
  if (message !== null) update.message = message || admin.firestore.FieldValue.delete();
  await ref.set(update, { merge: true });
  console.log('Config/app is now:', JSON.stringify((await ref.get()).data(), null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('Write failed:', e.message);
  process.exit(1);
});
