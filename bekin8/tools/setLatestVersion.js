#!/usr/bin/env node
// tools/setLatestVersion.js
//
// Flips the update-nudge version after a release is confirmed live in the store(s).
// Sets Config/app.latestVersion, which components/UpdateModal.tsx compares against the
// running binary's own version (see lib/appUpdate.ts). Use the BINARY version (the one
// EAS stamps from app.json), not the public App Store name; the two are different
// numbering schemes on purpose.
//
//   node tools/setLatestVersion.js 1.2.26
//
// Run it only once the store actually serves the update (search the listing page or a
// device's App Store), so the nudge never sends users to a page with nothing to install.
//
// Auth: uses Application Default Credentials (gcloud auth application-default login).

const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'waldgrave-profiles';

const version = process.argv[2];
if (!version || !/^\d+(\.\d+)*$/.test(version)) {
  console.error('Usage: node tools/setLatestVersion.js <binary version, e.g. 1.2.26>');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });

admin
  .firestore()
  .doc('Config/app')
  .set({ latestVersion: version }, { merge: true })
  .then(async () => {
    const snap = await admin.firestore().doc('Config/app').get();
    console.log('Config/app is now:', JSON.stringify(snap.data(), null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error('Write failed:', e.message);
    process.exit(1);
  });
