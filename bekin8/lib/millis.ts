// lib/millis.ts
// Milliseconds from any timestamp shape Firestore code meets: a Firestore Timestamp, a plain
// {seconds, nanoseconds} (cached/serialized), a Date, or a number. 0 for empty or unknown.
export function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}
