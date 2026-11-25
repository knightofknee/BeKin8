// lib/beaconShare.ts
// Sharing a lit beacon with people who are NOT on BeKin: a link (the owner's friend link plus the
// beacon's share token) that opens the beacon on the web, where they can say "I'm in" and chat
// with no account, and that auto-friends them if they install.
//
// Two ways out: a group text to "text friends" (people picked from the phone's contacts), or the
// system share sheet. The words that go with the link are a DESCRIPTION of the beacon, in the third
// person, the same line the push notification uses. It never speaks as the sender.
//
// Text friends live on this device only (AsyncStorage). BeKin's servers never see the address
// book or anyone's phone number.
import { Platform, Share } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { INVITE_WEB_BASE, prefetchMyInviteCode } from "./inviteLink";
import { formatTimeHHmmDisplay } from "./beaconTime";

export type ShareableBeacon = {
  id: string;
  ownerName: string;
  startAt: Date;
  timeHHmm?: string | null;
  message?: string | null;
};

// ---- link ----

const urlCache = new Map<string, string>();

/** The beacon's share URL, or null when it can't be made (offline, no username yet). */
export async function getBeaconShareUrl(uid: string, beaconId: string): Promise<string | null> {
  const hit = urlCache.get(beaconId);
  if (hit) return hit;
  try {
    const [code, res] = await Promise.all([
      prefetchMyInviteCode(uid),
      httpsCallable(getFunctions(), "ensureBeaconShare")({ beaconId }),
    ]);
    const token = String((res.data as any)?.token ?? "");
    if (!code || !/^[a-z0-9]{16}$/.test(token)) return null;
    const url = `${INVITE_WEB_BASE}/${code}?b=${token}`;
    urlCache.set(beaconId, url);
    return url;
  } catch {
    return null;
  }
}

// ---- description ----

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayIndex = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);

/** "Tonight at 8 PM", "Tomorrow", "Friday at 7:30 PM": the same wording the push uses. */
export function beaconWhen(b: Pick<ShareableBeacon, "startAt" | "timeHHmm">, now: Date = new Date()): string {
  const diff = Math.round(dayIndex(b.startAt) - dayIndex(now));
  const time = formatTimeHHmmDisplay(b.timeHHmm).replace(":00 ", " ");
  const evening = /^(1[7-9]|2\d):/.test((b.timeHHmm || "").trim());
  const day =
    diff === 0 ? (evening ? "Tonight" : "Today") : diff === -1 ? "Tonight" : diff === 1 ? "Tomorrow" : WEEKDAYS[b.startAt.getDay()];
  return time ? `${day} at ${time}` : day;
}

/** One descriptive line about the beacon. Third person: it describes, it does not speak for anyone. */
export function describeBeacon(b: ShareableBeacon): string {
  const who = b.ownerName.trim() || "A friend";
  const note = (b.message || "").trim();
  return `${who} lit a beacon on BeKin: ${beaconWhen(b)}.${note ? ` "${note}"` : ""}`;
}

/**
 * The group text, in three parts that each say whose words they are:
 *   1. the beacon: who lit it and when (third person), then what its owner wrote in the app,
 *      labelled "Description";
 *   2. BeKin's own line and the link. Unlabelled on purpose (Brian: the line rhymes and sets
 *      itself apart; extra words are what get us in trouble);
 *   3. anything the sender chose to add, under their own name.
 * Nothing here is written as if the sender said it, except the part they typed.
 */
export function composeBeaconText(b: ShareableBeacon, url: string, note?: string): string {
  const who = b.ownerName.trim() || "A friend";
  const desc = (b.message || "").trim();
  const mine = (note || "").trim();
  const parts = [
    `${who} lit a beacon on BeKin: ${beaconWhen(b)}.` + (desc ? `\nDescription: ${desc}` : ""),
    `Download the app to avoid group chat\n${url}`,
  ];
  if (mine) parts.push(`${who}: ${mine}`);
  return parts.join("\n\n");
}

// ---- text friends (device-local) ----

export type TextFriend = { id: string; name: string; phone: string; on: boolean };
const keyFor = (uid: string) => `@bekin_text_friends:${uid}`;

export async function loadTextFriends(uid: string): Promise<TextFriend[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((f) => f && typeof f.phone === "string" && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

export async function saveTextFriends(uid: string, list: TextFriend[]): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify(list));
  } catch {
    /* device-local convenience only */
  }
}

const digits = (s: string) => s.replace(/[^\d+]/g, "");

export type PickResult = { ok: true; friend: TextFriend } | { ok: false; reason: "cancelled" | "no-phone" | "denied" | "unavailable" };

/** The system contact picker, one person at a time. iOS shows it with no permission prompt (the app
 *  only ever receives the one contact picked); Android needs the contacts permission to read it. */
export async function pickTextFriend(): Promise<PickResult> {
  if (Platform.OS === "web") return { ok: false, reason: "unavailable" };
  try {
    const Contacts = await import("expo-contacts");
    if (Platform.OS === "android") {
      const perm = await Contacts.requestPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: "denied" };
    }
    const c = await Contacts.presentContactPickerAsync();
    if (!c) return { ok: false, reason: "cancelled" };
    const numbers = c.phoneNumbers ?? [];
    const best = numbers.find((n) => /mobile|iphone|cell/i.test(n.label || "")) ?? numbers[0];
    const phone = digits(best?.number || "");
    if (!phone) return { ok: false, reason: "no-phone" };
    const name = (c.firstName || c.name || "").trim() || phone;
    return { ok: true, friend: { id: phone, name, phone, on: true } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// ---- sending ----

/** Opens the Messages composer addressed to `phones` with the text filled in. The person still
 *  presses send themselves. "sent" = the composer reported it went (or opened, on Android);
 *  "unavailable" = this device can't text (an iPad, a simulator): the caller offers the link instead. */
export async function textBeacon(phones: string[], body: string): Promise<"sent" | "cancelled" | "unavailable"> {
  try {
    const SMS = await import("expo-sms");
    if (!(await SMS.isAvailableAsync())) return "unavailable";
    const { result } = await SMS.sendSMSAsync(phones, body);
    return result === "cancelled" ? "cancelled" : "sent";
  } catch {
    return "unavailable";
  }
}

/** The system share sheet with the description and the link. */
export async function shareBeaconLink(description: string, url: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.share) {
        await nav.share({ text: description, url });
        return true;
      }
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(`${description}\n${url}`);
      return true;
    }
    const res =
      Platform.OS === "ios"
        ? await Share.share({ message: description, url })
        : await Share.share({ message: `${description}\n${url}` });
    return res.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}
