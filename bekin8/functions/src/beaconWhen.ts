// functions/src/beaconWhen.ts
// "When" copy for a beacon ("Tonight at 8 PM"), shared by the push fan-out (index.ts) and the
// guest beacon page endpoints (guestBeacon.ts).
export type WhenBeacon = {
  startAt?: FirebaseFirestore.Timestamp;
  timeHHmm?: string | null;
};

// ===== Helpers: "when" copy for pushes =====
// The server runs in UTC but a beacon's day is the OWNER's local day. startAt is always written as
// the owner's local midnight, so its UTC clock time IS the owner's UTC offset (negated): local
// midnight at 05:00Z means UTC-5. Mapped into (-11h, +13h]: that covers New Zealand's daylight
// time and Tonga (+13); the only zones it misreads are UTC-11/-12 (American Samoa, Niue, Baker
// Island) and Kiribati's +14.
export function ownerOffsetMin(startAt: FirebaseFirestore.Timestamp): number {
  const d = startAt.toDate();
  let off = -(d.getUTCHours() * 60 + d.getUTCMinutes());
  if (off <= -11 * 60) off += 24 * 60;
  return off;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "18:30" -> "6:30 PM", "19:00" -> "7 PM"; '' when unset or malformed. */
export function formatTime12(hhmm?: string | null): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return '';
  const h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h24 > 23 || min > 59) return '';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "Tonight at 8 PM", "Tomorrow", "Friday at 7:30 PM", relative to the owner's local today. */
export function whenLabel(b: WhenBeacon, nowMs: number = Date.now()): string {
  if (!b.startAt) return '';
  const off = ownerOffsetMin(b.startAt) * 60_000;
  const startMs = b.startAt.toMillis();
  const localDay = (ms: number) => Math.floor((ms + off) / 86_400_000);
  const diff = localDay(startMs) - localDay(nowMs);
  const time = formatTime12(b.timeHHmm);
  const evening = /^(1[7-9]|2\d):/.test((b.timeHHmm || '').trim());
  let day: string;
  if (diff === 0) day = evening ? 'Tonight' : 'Today';
  else if (diff === -1) day = 'Tonight'; // last night's beacon, inside its after-midnight grace
  else if (diff === 1) day = 'Tomorrow';
  else day = WEEKDAYS[new Date(startMs + off + 12 * 3_600_000).getUTCDay()];
  return time ? `${day} at ${time}` : day;
}

