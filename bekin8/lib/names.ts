import { auth, db } from "../firebase.config";
import { doc, getDoc } from "firebase/firestore";

/** Resolve the best name to show for a uid. */
export async function resolveDisplayName(uid: string): Promise<string> {
  try {
    const profSnap = await getDoc(doc(db, "Profiles", uid));
    const prof = profSnap.exists() ? (profSnap.data() as any) : {};
    const display = typeof prof.displayName === "string" ? prof.displayName.trim() : "";
    if (display) return display;

    const unameProf = typeof prof.username === "string" ? prof.username.trim() : "";
    if (unameProf)  return unameProf;
    // No users/{uid} fallback: names live on the world-readable Profiles doc; the owner-only users
    // doc isn't readable for OTHER people once the friend graph is locked (see firestore.rules).

    // local fallbacks (only valid for self)
    if (auth.currentUser?.uid === uid) {
      const authName = (auth.currentUser.displayName || "").trim();
      if (authName) return authName;
      const emailPrefix = (auth.currentUser.email || "").split("@")[0] || "";
      if (emailPrefix) return emailPrefix;
    }
  } catch {}
  return "Friend";
}