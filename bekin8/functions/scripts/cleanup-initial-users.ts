/**
 * One-shot data hygiene script for old/initial users.
 *
 * Performs three cleanups against your live Firestore:
 *
 *   1. Color migration. For every Profiles/{uid} doc that has the legacy
 *      `avatarColor` field but no `profileColor` field, copies
 *      avatarColor → profileColor so the modern read paths render correctly.
 *
 *   2. Friend reconciliation. Walks Friends/{uid}.friends arrays AND
 *      users/{uid}/friends subcollections. For every (A, B) pair that appears
 *      in any of those legacy sources but is missing from FriendEdges,
 *      creates the missing FriendEdge document. This fixes asymmetric
 *      "I see their posts but they don't see mine" cases caused by old client
 *      versions that wrote to one source but not all of them.
 *
 *   3. Post field normalization. The feed query orders by `timestamp` (a
 *      ms-epoch number) and filters by `author == uid`. Old posts may have
 *      legacy field names (`createdAt`, `authorUid`) and/or `timestamp`
 *      stored as a Firestore Timestamp instead of a number — both make the
 *      modern feed query exclude them entirely. This step backfills:
 *        - `author`    from `authorUid` if missing
 *        - `timestamp` from `createdAt`  if missing
 *        - `timestamp` converted to number if currently a Timestamp object
 *
 *   4. Push-token cross-user dedup. The cloud function sends a push to every
 *      doc in every `users/{uid}/pushTokens/*` whose owner is a recipient.
 *      If the same physical device's token is registered to multiple accounts
 *      (testers, dual-sign-in, etc.) the device receives one push per account,
 *      i.e. duplicate notifications. This step finds every token value that
 *      lives in more than one user's pushTokens, keeps only the doc with the
 *      newest `updatedAt`, and deletes the rest.
 *
 * Runs in DRY-RUN mode by default — prints what would change without
 * touching anything. Pass --apply to actually write.
 *
 * --------------------------------------------------------------------------
 *
 * Setup (one-time):
 *
 *   # Make sure firebase-admin can reach your project. Easiest path is gcloud
 *   # Application Default Credentials:
 *   gcloud auth application-default login
 *
 *   # Or download a service-account JSON from Firebase Console → Project Settings
 *   # → Service Accounts and point GOOGLE_APPLICATION_CREDENTIALS at it:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Run:
 *
 *   cd functions
 *   npx tsx scripts/cleanup-initial-users.ts                # dry run
 *   npx tsx scripts/cleanup-initial-users.ts --apply        # actually write
 *
 * Optional flags:
 *
 *   --colors-only        only do the avatarColor → profileColor migration
 *   --friends-only       only do the FriendEdges reconciliation
 *   --posts-only         only do the Posts field normalization
 *   --tokens-only        only do the cross-user pushTokens dedup
 *
 * The script is idempotent — safe to run repeatedly. Re-running just confirms
 * everything is already in sync.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const COLORS_ONLY = process.argv.includes('--colors-only');
const FRIENDS_ONLY = process.argv.includes('--friends-only');
const POSTS_ONLY = process.argv.includes('--posts-only');
const TOKENS_ONLY = process.argv.includes('--tokens-only');
const TAG = APPLY ? '[APPLY]' : '[DRY-RUN]';

// Pick the first explicitly-requested operation, if any.
const RUN_COLORS = !FRIENDS_ONLY && !POSTS_ONLY && !TOKENS_ONLY;
const RUN_FRIENDS = !COLORS_ONLY && !POSTS_ONLY && !TOKENS_ONLY;
const RUN_POSTS = !COLORS_ONLY && !FRIENDS_ONLY && !TOKENS_ONLY;
const RUN_TOKENS = !COLORS_ONLY && !FRIENDS_ONLY && !POSTS_ONLY;

// ---- Color migration ------------------------------------------------------

async function migrateColors(): Promise<{ scanned: number; migrated: number }> {
  console.log(`\n=== ${TAG} Color migration: avatarColor → profileColor ===`);
  const snap = await db.collection('Profiles').get();
  let migrated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const hasLegacy = typeof data.avatarColor === 'string' && (data.avatarColor as string).trim().length > 0;
    const hasModern = typeof data.profileColor === 'string' && (data.profileColor as string).trim().length > 0;
    if (hasLegacy && !hasModern) {
      console.log(`  ${doc.id}  ${data.avatarColor as string}  →  profileColor`);
      if (APPLY) {
        await doc.ref.update({ profileColor: data.avatarColor });
      }
      migrated++;
    }
  }
  console.log(`Profiles scanned: ${snap.size}.  ${APPLY ? 'Updated' : 'Would update'}: ${migrated}`);
  return { scanned: snap.size, migrated };
}

// ---- Friend reconciliation ------------------------------------------------

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

async function collectExistingEdges(): Promise<Set<string>> {
  const snap = await db.collection('FriendEdges').get();
  const out = new Set<string>();
  snap.forEach((d) => {
    const uids: unknown = (d.data() as Record<string, unknown>).uids;
    if (Array.isArray(uids) && uids.length === 2 && typeof uids[0] === 'string' && typeof uids[1] === 'string') {
      out.add(pairKey(uids[0] as string, uids[1] as string));
    }
  });
  return out;
}

async function collectImpliedFromFriendsArrays(): Promise<Set<string>> {
  const snap = await db.collection('Friends').get();
  const out = new Set<string>();
  snap.forEach((d) => {
    const owner = d.id;
    const friends = (d.data() as Record<string, unknown>).friends;
    if (!Array.isArray(friends)) return;
    for (const f of friends) {
      const fUid = (f as { uid?: unknown })?.uid;
      if (typeof fUid === 'string' && fUid && fUid !== owner) {
        out.add(pairKey(owner, fUid));
      }
    }
  });
  return out;
}

async function collectImpliedFromSubcollections(): Promise<Set<string>> {
  const usersSnap = await db.collection('users').get();
  const out = new Set<string>();
  // Process users in batches of 25 to bound concurrency
  const BATCH = 25;
  for (let i = 0; i < usersSnap.docs.length; i += BATCH) {
    const slice = usersSnap.docs.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (userDoc) => {
        const owner = userDoc.id;
        const friendsSnap = await db.collection('users').doc(owner).collection('friends').get();
        friendsSnap.forEach((d) => {
          const fUid = (d.data() as Record<string, unknown>).uid;
          if (typeof fUid === 'string' && fUid && fUid !== owner) {
            out.add(pairKey(owner, fUid));
          }
        });
      })
    );
  }
  return out;
}

async function reconcileFriends(): Promise<{ existing: number; impliedNotInEdges: number; created: number }> {
  console.log(`\n=== ${TAG} Friend reconciliation: ensure FriendEdges covers legacy data ===`);

  const [existing, fromArrays, fromSubs] = await Promise.all([
    collectExistingEdges(),
    collectImpliedFromFriendsArrays(),
    collectImpliedFromSubcollections(),
  ]);

  console.log(`FriendEdges (existing canonical): ${existing.size} pairs`);
  console.log(`Implied from Friends/*.friends arrays: ${fromArrays.size} pairs`);
  console.log(`Implied from users/*/friends subcollections: ${fromSubs.size} pairs`);

  const allImplied = new Set<string>([...fromArrays, ...fromSubs]);
  const missing = [...allImplied].filter((k) => !existing.has(k));

  console.log(`\nMissing FriendEdge entries: ${missing.length}`);
  let created = 0;
  for (const key of missing) {
    const [a, b] = key.split('|');
    console.log(`  + edge ${a} <—> ${b}`);
    if (APPLY) {
      await db.collection('FriendEdges').add({
        uids: [a, b].sort(),
        state: 'accepted',
        createdAt: FieldValue.serverTimestamp(),
        // Mark synthetic edges so you can audit them later if needed.
        source: 'cleanup-initial-users',
      });
      created++;
    }
  }
  return { existing: existing.size, impliedNotInEdges: missing.length, created };
}

// ---- Posts field normalization --------------------------------------------

/** Coerce a Firestore Timestamp / number / {seconds,nanoseconds} into ms-epoch. */
function toMillis(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    const anyV = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof anyV.toMillis === 'function') {
      try { return anyV.toMillis(); } catch { /* fallthrough */ }
    }
    if (typeof anyV.seconds === 'number') {
      return anyV.seconds * 1000 + Math.floor((anyV.nanoseconds || 0) / 1e6);
    }
  }
  return null;
}

async function normalizePosts(): Promise<{ scanned: number; updated: number }> {
  console.log(`\n=== ${TAG} Posts: normalize author / timestamp fields ===`);
  const snap = await db.collection('Posts').get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    const reasons: string[] = [];

    // author backfill from legacy authorUid
    if (typeof data.author !== 'string' && typeof data.authorUid === 'string') {
      updates.author = data.authorUid;
      reasons.push('author←authorUid');
    }

    // timestamp must be a number for the feed query's orderBy + range filter to match.
    // Two repair paths:
    //   - field missing entirely: backfill from createdAt (whatever its type)
    //   - field present but not a number: convert in place (it's a Timestamp object)
    const tsIsNumber = typeof data.timestamp === 'number';
    if (!tsIsNumber) {
      const fromTs = toMillis(data.timestamp);
      const fromCreatedAt = toMillis(data.createdAt);
      const candidate = fromTs ?? fromCreatedAt;
      if (candidate !== null) {
        updates.timestamp = candidate;
        if (data.timestamp === undefined || data.timestamp === null) {
          reasons.push('timestamp←createdAt');
        } else {
          reasons.push('timestamp Timestamp→number');
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      console.log(`  ${doc.id}  ${reasons.join(', ')}`);
      if (APPLY) {
        await doc.ref.update(updates);
      }
      updated++;
    }
  }
  console.log(`Posts scanned: ${snap.size}.  ${APPLY ? 'Updated' : 'Would update'}: ${updated}`);
  return { scanned: snap.size, updated };
}

// ---- Cross-user push-token dedup ------------------------------------------

async function dedupePushTokens(): Promise<{ scanned: number; dupeGroups: number; deleted: number }> {
  console.log(`\n=== ${TAG} pushTokens: cross-user dedup ===`);

  // collectionGroup walks every subcollection named `pushTokens` regardless of
  // parent uid. No filter → no composite index required.
  const snap = await db.collectionGroup('pushTokens').get();

  // Group docs by their token value.
  const byToken = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  snap.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const token = typeof data.token === 'string' ? data.token : '';
    if (!token) return;
    const arr = byToken.get(token);
    if (arr) arr.push(doc);
    else byToken.set(token, [doc]);
  });

  let dupeGroups = 0;
  let deleted = 0;
  const batch = db.batch();
  let batched = 0;

  for (const [token, docs] of byToken) {
    if (docs.length <= 1) continue;
    dupeGroups++;

    // Most recently-updated doc wins. Docs without updatedAt sort last.
    docs.sort((a, b) => {
      const aMs = (((a.data() as any).updatedAt as { toMillis?: () => number })?.toMillis?.()) ?? 0;
      const bMs = (((b.data() as any).updatedAt as { toMillis?: () => number })?.toMillis?.()) ?? 0;
      return bMs - aMs;
    });

    const keep = docs[0];
    const remove = docs.slice(1);
    const keepUid = keep.ref.parent.parent?.id ?? '?';
    console.log(`  token ${token.slice(0, 24)}…  keep user ${keepUid}, delete ${remove.length}:`);
    for (const d of remove) {
      const removeUid = d.ref.parent.parent?.id ?? '?';
      console.log(`    - user ${removeUid}  (doc ${d.id})`);
      if (APPLY) {
        batch.delete(d.ref);
        batched++;
      }
      deleted++;
    }
  }

  if (APPLY && batched > 0) {
    await batch.commit();
  }

  console.log(
    `pushTokens scanned: ${snap.size}.  Duplicate token groups: ${dupeGroups}.  ${APPLY ? 'Deleted' : 'Would delete'}: ${deleted}`,
  );
  return { scanned: snap.size, dupeGroups, deleted };
}

// ---- Main -----------------------------------------------------------------

(async () => {
  console.log(`Cleanup ${APPLY ? 'APPLY mode' : 'DRY-RUN mode'} starting...`);

  if (RUN_COLORS) {
    await migrateColors();
  }
  if (RUN_FRIENDS) {
    await reconcileFriends();
  }
  if (RUN_POSTS) {
    await normalizePosts();
  }
  if (RUN_TOKENS) {
    await dedupePushTokens();
  }

  console.log(`\nDone. ${APPLY ? 'Changes applied.' : 'Re-run with --apply to actually write.'}`);
  process.exit(0);
})().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});
