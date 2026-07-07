// lib/beaconTime.ts
// Helpers for the optional clock time stored on Beacon documents.
// Internal storage format: "HH:MM" in 24-hour time (e.g. "18:30").
// UI format: 12-hour with AM/PM.

// Returns null only when the HOUR is missing or out of range. Minutes are optional: an empty
// minute field defaults to :00 (a bare "7 PM" is a complete time).
export function buildTimeHHmm(
  hourStr: string,
  minuteStr: string,
  meridiem: "AM" | "PM",
): string | null {
  if (!hourStr) return null;
  const h12 = parseInt(hourStr, 10);
  const m = minuteStr ? parseInt(minuteStr, 10) : 0;
  if (!Number.isFinite(h12) || !Number.isFinite(m)) return null;
  if (h12 < 1 || h12 > 12) return null;
  if (m < 0 || m > 59) return null;
  let h24 = h12 % 12; // 12 -> 0
  if (meridiem === "PM") h24 += 12;
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseTimeHHmm(
  s: string | null | undefined,
): { hour: string; minute: string; meridiem: "AM" | "PM" } | null {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h24 = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h24) || !Number.isFinite(min)) return null;
  if (h24 < 0 || h24 > 23 || min < 0 || min > 59) return null;
  const meridiem: "AM" | "PM" = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour: String(h12), minute: String(min).padStart(2, "0"), meridiem };
}

// 12-hour display string for chat headers. e.g. "6:30 PM". Empty string when unset.
export function formatTimeHHmmDisplay(s: string | null | undefined): string {
  const parsed = parseTimeHHmm(s);
  if (!parsed) return "";
  return `${parsed.hour}:${parsed.minute} ${parsed.meridiem}`;
}
