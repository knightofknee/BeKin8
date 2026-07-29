// functions/src/resolveUsername.ts
//
// Username -> uid lookup for flows that must reference someone you are NOT yet connected to:
// sending a friend request, and unblocking by name.
//
// Both used to run `Profiles.where('usernameLower','==', x)` straight from the client. That only
// worked because Profiles were readable by every signed-in user, which is exactly the scraping hole
// being closed: Profiles are now audience-scoped (friends, plus friends-of-friends when both sides
// opted in), so a client query for a stranger's profile is denied.
//
// This callable is the narrow replacement. The Admin SDK bypasses rules, and it returns ONLY the uid
// and display username, never profile content. That is the minimum the add-friend and unblock flows
// need, and it is strictly less than the whole Profile doc they could read before.
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

type ResolveUsernameResponse = { found: boolean; uid?: string; username?: string };

export const resolveUsername = onCall<{ username?: string }, Promise<ResolveUsernameResponse>>(
  { enforceAppCheck: false },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const raw = String(req.data?.username ?? '').trim();
    if (!raw) return { found: false };
    const lower = raw.toLowerCase();

    // usernameLower first, then the display-cased field, mirroring the lookup order the client used
    // before so legacy profiles written before usernameLower existed still resolve.
    let snap = await db.collection('Profiles').where('usernameLower', '==', lower).limit(1).get();
    if (snap.empty) snap = await db.collection('Profiles').where('username', '==', raw).limit(1).get();
    if (snap.empty) return { found: false };

    const doc = snap.docs[0];
    return { found: true, uid: doc.id, username: String((doc.data() as any)?.username || raw) };
  }
);
