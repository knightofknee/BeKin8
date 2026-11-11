// lib/addBrian.ts
// "Add Brian" (the creator) as a first friend. The target is resolved entirely server-side by the
// addFriendMutual callable (pinned uid / Usernames reservation, failing closed on ambiguity), so the
// client passes nothing. Shared by the Friends screen's first-friend card and the setup tour's
// "Add a friend" step. The callable is idempotent and RESOLVES (does not throw) on its guard cases.
import { getFunctions, httpsCallable } from "firebase/functions";

export type AddBrianResult =
  | { ok: true; already: boolean; targetUid?: string }
  | { ok: false; error: "BLOCKED" | "SELF" | "NOT_DEPLOYED" | "FAILED" };

export async function addBrianAsFriend(): Promise<AddBrianResult> {
  try {
    const res = await httpsCallable(getFunctions(), "addFriendMutual")({});
    const data = (res?.data ?? {}) as { ok?: boolean; already?: boolean; error?: string; targetUid?: string };
    if (data.ok) return { ok: true, already: !!data.already, targetUid: data.targetUid };
    if (data.error === "BLOCKED") return { ok: false, error: "BLOCKED" };
    if (data.error === "SELF") return { ok: false, error: "SELF" };
    return { ok: false, error: "FAILED" };
  } catch (e: any) {
    if (__DEV__) console.error("addBrianAsFriend error", e);
    if (e?.code === "functions/not-found" || e?.code === "not-found") return { ok: false, error: "NOT_DEPLOYED" };
    return { ok: false, error: "FAILED" };
  }
}
