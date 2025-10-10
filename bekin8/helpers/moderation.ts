// helpers/moderation.ts
import { addDoc, collection, serverTimestamp, setDoc, doc } from "firebase/firestore";
import { db } from "../firebase.config";

export type ReportPayload = {
  targetType: "post" | "comment" | "user";
  targetId: string;
  targetOwnerUid?: string;
  reason?: string;
  reporterUid: string;
};

export async function reportContent(p: ReportPayload) {
  const ref = collection(db, "reports");
  await addDoc(ref, {
    ...p,
    createdAt: serverTimestamp(),
    status: "open",
  });
}

export async function blockUser(myUid: string, otherUid: string) {
  const ref = doc(db, `users/${myUid}/blocks/${otherUid}`);
  await setDoc(ref, { blockedAt: serverTimestamp() });
}

// Utility to check if content should be hidden given a set of blocked UIDs
export function shouldHideByBlocks(authorUid: string, blockedSet: Set<string>) {
  return blockedSet.has(authorUid);
}
