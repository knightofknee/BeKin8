// lib/updateGate.ts
//
// Remote minimum-version gate.
//
// WHY THIS EXISTS: Firestore rules apply instantly to every installed copy of the app, but an app
// binary can only be replaced through the store. So any backend change that requires new client
// code (the audience-scoping cutover is the first, it will not be the last) leaves everyone on an
// older build broken until they happen to update. This gate lets a future cutover be sequenced:
// raise minVersion, and old builds show a blocking "update required" screen instead of a silently
// broken feed.
//
// IMPORTANT LIMITATION: a gate only works in builds that CONTAIN it. It does nothing for versions
// already installed today, because those binaries have no such check. This protects the NEXT
// breaking change, not the current one.
//
// FAIL-OPEN BY DESIGN: a missing doc, a denied read, a malformed version, or any thrown error all
// resolve to "do not block". A remote config that can brick every install is far more dangerous
// than one that occasionally fails to gate, so every unknown resolves toward letting the user in.
import { doc, getDoc } from 'firebase/firestore';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { db } from '../firebase.config';

export type UpdateGateConfig = {
  /** Lowest marketing version allowed to run, e.g. "1.2.25". Blank/absent disables the gate. */
  minVersion: string;
  message: string;
  storeUrl: string | null;
  /** Always true here: this gate ONLY fires for hard blocks. See fetchUpdateGate. */
  required: boolean;
};

/**
 * Compare dotted numeric versions ("1.2.24" vs "1.2.25").
 * Returns <0 if a<b, 0 if equal, >0 if a>b. Missing segments count as 0, so "1.3" > "1.2.9".
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10));
  const pb = String(b).split('.').map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** The running build's marketing version ("1.2.24"), or '' when unavailable. */
export function currentAppVersion(): string {
  return Application.nativeApplicationVersion ?? '';
}

/**
 * Reads Config/app and decides whether this build must be updated.
 *
 * Doc shape (all optional, admin/console-written only):
 *   minVersion   string   lowest allowed marketing version
 *   message      string   copy shown on the screen
 *   iosUrl       string   App Store link
 *   androidUrl   string   Play Store link
 *   required     boolean  true = hard block, false/absent = dismissible nudge
 */
export async function fetchUpdateGate(): Promise<UpdateGateConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'Config', 'app'));
    if (!snap.exists()) return null;
    const data = snap.data() as any;

    const minVersion = typeof data?.minVersion === 'string' ? data.minVersion.trim() : '';
    if (!minVersion) return null; // gate disabled

    const current = currentAppVersion();
    // Unknown running version => cannot prove it is too old => do not block.
    if (!current) return null;
    if (compareVersions(current, minVersion) >= 0) return null; // up to date

    const storeUrl =
      Platform.OS === 'ios'
        ? typeof data?.iosUrl === 'string' && data.iosUrl ? data.iosUrl : null
        : typeof data?.androidUrl === 'string' && data.androidUrl ? data.androidUrl : null;

    // HARD BLOCKS ONLY. The dismissible "a new version is available" nudge is already handled by
    // components/UpdateModal.tsx, which detects the live App Store version automatically via the
    // iTunes lookup and needs no config doc at all. Two overlapping prompts would both render, so
    // this gate stays silent unless `required` is explicitly true — i.e. the case UpdateModal
    // cannot cover, where the old build is genuinely broken against the backend and must not be
    // dismissible. Leave `required` false/absent during a transition window.
    if (data?.required !== true) return null;
    const required = true;
    return {
      minVersion,
      message:
        typeof data?.message === 'string' && data.message.trim()
          ? data.message.trim()
          : required
            ? 'A new version of BeKin is required to keep using the app.'
            : 'A new version of BeKin is available.',
      storeUrl,
      required,
    };
  } catch {
    // Denied (rules not yet deployed), offline, or malformed: never block on uncertainty.
    return null;
  }
}
