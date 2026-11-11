// lib/timePoll.ts
// Group scheduling ("let friends vote on a time"), Doodle-style.
//
// DATA
//   Beacons/{id}.timePoll = { status: 'open' | 'decided', options: TimeOption[], decidedId?, decidedAt? }
//     Written by the owner (Beacon options). While OPEN the beacon is lit with no clock time, its
//     startAt is the EARLIEST option day and its expiresAt covers the LATEST option day, so it stays
//     visible to friends for the whole window.
//   Beacons/{id}/TimeVotes/{uid} = { uid, name, optionIds, updatedAt }
//     One doc per voter, every option that works for them (Doodle: pick all that work). Rules only
//     let you write your own doc, only while the poll is open, only inside the beacon's audience.
//   DECIDE (owner): status -> 'decided' + the beacon's startAt / expiresAt / timeHHmm move to the
//     chosen option, so the day of a beacon can change. functions/src/index.ts (onBeaconTimeDecided)
//     then notifies everyone who RSVP'd or voted and posts a "locked in" line in the chat.
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { beaconExpiry, formatTimeHHmmDisplay } from "./beaconTime";

export type TimeOption = {
  id: string;
  /** Local midnight of the option's day, epoch ms. */
  dayMs: number;
  /** "HH:MM" 24h, or null for "any time that day". */
  timeHHmm: string | null;
};

export type TimePoll = {
  status: "open" | "decided";
  options: TimeOption[];
  decidedId?: string | null;
};

export type Voter = { uid: string; name: string };

export const MAX_TIME_OPTIONS = 6;

export function newOptionId(): string {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Parse a beacon doc's timePoll field defensively (it's user-written data). */
export function parseTimePoll(raw: any): TimePoll | null {
  if (!raw || typeof raw !== "object") return null;
  const status = raw.status === "decided" ? "decided" : raw.status === "open" ? "open" : null;
  if (!status || !Array.isArray(raw.options)) return null;
  const options: TimeOption[] = raw.options
    .filter((o: any) => o && typeof o.id === "string" && Number.isFinite(Number(o.dayMs)))
    .map((o: any) => ({
      id: o.id,
      dayMs: Number(o.dayMs),
      timeHHmm: typeof o.timeHHmm === "string" ? o.timeHHmm : null,
    }));
  if (!options.length) return null;
  return { status, options: sortOptions(options), decidedId: typeof raw.decidedId === "string" ? raw.decidedId : null };
}

/** Chronological: by day, then by time (an "any time" option sorts first within its day). */
export function sortOptions(options: TimeOption[]): TimeOption[] {
  return options.slice().sort((a, b) => a.dayMs - b.dayMs || (a.timeHHmm ?? "").localeCompare(b.timeHHmm ?? ""));
}

export function optionDayLabel(o: TimeOption): string {
  return new Date(o.dayMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function optionTimeLabel(o: TimeOption): string {
  return formatTimeHHmmDisplay(o.timeHHmm) || "Any time";
}

export function optionLabel(o: TimeOption): string {
  return `${optionDayLabel(o)} · ${optionTimeLabel(o)}`;
}

export function sameOption(a: Pick<TimeOption, "dayMs" | "timeHHmm">, b: Pick<TimeOption, "dayMs" | "timeHHmm">) {
  return a.dayMs === b.dayMs && (a.timeHHmm ?? null) === (b.timeHHmm ?? null);
}

/**
 * The beacon fields an OPEN poll implies: no clock time yet, startAt on the earliest option's day,
 * and alive through the latest option's day (4am after it, like every beacon).
 */
export function openPollBeaconFields(options: TimeOption[]) {
  const sorted = sortOptions(options);
  const first = new Date(sorted[0].dayMs);
  const last = new Date(sorted[sorted.length - 1].dayMs);
  return {
    timePoll: { status: "open", options: sorted, decidedId: null },
    startAt: Timestamp.fromDate(first),
    expiresAt: Timestamp.fromDate(beaconExpiry(last)),
    timeHHmm: null,
  };
}

/**
 * Live votes for a beacon's poll: per-option voters, plus my own picks. Pass the CURRENT poll's
 * option ids: a beacon doc can carry an older poll's TimeVotes (same-day doc, re-polled), and
 * without the filter those stale picks made a friend look like they had "already voted".
 */
export function useTimeVotes(beaconId: string | null | undefined, optionIds?: string[]) {
  const [votes, setVotes] = useState<{ uid: string; name: string; optionIds: string[] }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setVotes([]);
    setLoaded(false);
    if (!beaconId) return;
    return onSnapshot(
      collection(db, "Beacons", beaconId, "TimeVotes"),
      (snap) => {
        const rows: { uid: string; name: string; optionIds: string[] }[] = [];
        snap.forEach((d) => {
          const v = d.data() as any;
          if (!Array.isArray(v?.optionIds)) return;
          rows.push({
            uid: d.id,
            name: String(v?.name || "").trim() || "Someone",
            optionIds: v.optionIds.filter((x: any) => typeof x === "string"),
          });
        });
        setVotes(rows);
        setLoaded(true);
      },
      () => setLoaded(true)
    );
  }, [beaconId]);

  const me = auth.currentUser?.uid ?? null;
  const validKey = optionIds ? optionIds.join("|") : "";
  return useMemo(() => {
    const valid = optionIds ? new Set(optionIds) : null;
    const current = votes.map((v) => ({ ...v, optionIds: valid ? v.optionIds.filter((id) => valid.has(id)) : v.optionIds }));
    const byOption: Record<string, Voter[]> = {};
    for (const v of current) {
      for (const id of v.optionIds) (byOption[id] ||= []).push({ uid: v.uid, name: v.name });
    }
    const minePicks = current.find((v) => v.uid === me)?.optionIds;
    const mine = minePicks && minePicks.length ? minePicks : null;
    const voterCount = current.filter((v) => v.optionIds.length > 0).length;
    return { byOption, mine, voterCount, loaded };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votes, me, loaded, validKey]);
}

/** Save my picks (all the options that work for me). An empty list clears my vote. */
export async function castTimeVote(beaconId: string, optionIds: string[], name: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  await setDoc(doc(db, "Beacons", beaconId, "TimeVotes", uid), {
    uid,
    name: name || "Someone",
    optionIds,
    updatedAt: serverTimestamp(),
  });
}

/** Owner: lock in an option. Moves the beacon to that day + time (the day can change). */
export async function decideTime(beaconId: string, option: TimeOption) {
  const day = new Date(option.dayMs);
  await updateDoc(doc(db, "Beacons", beaconId), {
    "timePoll.status": "decided",
    "timePoll.decidedId": option.id,
    "timePoll.decidedAt": serverTimestamp(),
    startAt: Timestamp.fromDate(day),
    expiresAt: Timestamp.fromDate(beaconExpiry(day)),
    timeHHmm: option.timeHHmm,
    updatedAt: serverTimestamp(),
  });
}

/** Owner: drop the poll entirely (back to a normal beacon). */
export function clearPollField() {
  return { timePoll: deleteField() };
}
