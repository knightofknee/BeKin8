// lib/rsvp.ts
// RSVP and RALLY for a beacon, shared by the chat header, the friend beacon tiles, and the owner's
// going line on home. Both are a system ChatMessage ({type:'system', subtype:'im-in'}) so the chat,
// the roster, and the server's RSVP pushes all read one source of truth; a rally's carries
// rally: true. (subtype stays 'im-in' so builds already in the wild keep counting it.)
//   RSVP  = "I'm going".
//   RALLY = "I'm going AND bringing my friends": you light a rally beacon of your own (rallyOf =
//           the original) for your chosen friend groups, and the server opens the ORIGINAL beacon's
//           chat to them, so everyone ends up in one room. Rallies stack alongside your own beacon.
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import * as Notifications from "expo-notifications";
import {
  Timestamp,
  addDoc,
  updateDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { getMillis } from "./millis";
import { resolveDisplayName } from "./names";
import { ensureNotifyPermission } from "./notifyPermission";

export type GoingPerson = { uid: string; name: string; rally: boolean };
export type BeaconGoing = {
  /** People going (the owner excluded), oldest RSVP first. rally = they're rallying friends too. */
  going: GoingPerson[];
  /** I'm going (by RSVP or by rallying). */
  iAmIn: boolean;
  /** I'm going by rallying. */
  iAmRallying: boolean;
  loaded: boolean;
};

/**
 * Live RSVP roster for one beacon. The audienceUids filter is required: the ChatMessages read rule
 * is `uid in resource.data.audienceUids`, and Firestore rejects a query its constraints can't prove.
 */
export function useBeaconGoing(beaconId?: string | null, ownerUid?: string | null): BeaconGoing {
  const [roster, setRoster] = useState<{ going: GoingPerson[]; loaded: boolean }>({ going: [], loaded: false });
  // Whether MY rally beacon for this beacon is actually lit. My RSVP keeps its rally flag after a
  // newer rally (or the structure) puts that beacon out, so "rallying" must also check the beacon:
  // otherwise an old rally kept saying "🔥 Rallying" with nothing lit. Falls back to "✓ Going".
  const [rallyLit, setRallyLit] = useState(false);
  const meUid = auth.currentUser?.uid ?? null;

  useEffect(() => {
    setRoster({ going: [], loaded: false });
    if (!beaconId || !meUid) return;
    const q = query(
      collection(db, "Beacons", beaconId, "ChatMessages"),
      where("audienceUids", "array-contains", meUid),
      where("type", "==", "system"),
      where("subtype", "==", "im-in")
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => d.data({ serverTimestamps: "estimate" }) as any)
          .filter((m) => typeof m?.actorUid === "string" && m.actorUid)
          .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
        const byUid = new Map<string, GoingPerson>();
        for (const m of rows) {
          if (m.actorUid === ownerUid) continue;
          const prev = byUid.get(m.actorUid);
          const name = String(m.actorName || "").trim() || "Someone";
          // Keep the first RSVP's place in line; a rally message anywhere marks them rallying.
          byUid.set(m.actorUid, { uid: m.actorUid, name: prev?.name ?? name, rally: !!prev?.rally || m.rally === true });
        }
        setRoster({ going: Array.from(byUid.values()), loaded: true });
      },
      () => setRoster({ going: [], loaded: true })
    );
  }, [beaconId, ownerUid, meUid]);

  useEffect(() => {
    setRallyLit(false);
    if (!beaconId || !meUid || ownerUid === meUid) return;
    return onSnapshot(
      doc(db, "Beacons", rallyBeaconId(meUid, beaconId)),
      (snap) => setRallyLit(snap.exists() && (snap.data() as any)?.active === true),
      () => setRallyLit(false)
    );
  }, [beaconId, ownerUid, meUid]);

  const mine = meUid ? roster.going.find((g) => g.uid === meUid) : undefined;
  return {
    going: roster.going,
    iAmIn: !!mine,
    iAmRallying: !!mine?.rally && rallyLit,
    loaded: roster.loaded,
  };
}

/** "Ann", "Ann and Ben", "Ann, Ben and Sam", "Ann, Ben and 3 others". */
export function goingNames(going: { name: string }[]): string {
  const names = going.map((g) => g.name.split(" ")[0] || g.name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

// Per-beacon in-flight guard: the roster only flips once the snapshot echoes the write, and the
// name lookup awaits first, so a quick double tap would otherwise post two RSVPs (two pushes).
const busy = new Set<string>();

/** My RALLY beacon for an original beacon: one per original, so it never collides with my own
 *  deterministic per-day beacon (`${uid}_${yyyymmdd}`). */
export const rallyBeaconId = (meUid: string, ogId: string) => `${meUid}_rally_${ogId}`;

/** Delete every RSVP of mine on a beacon (every match, in case an offline retry left a duplicate). */
async function clearMyRsvps(beaconId: string, meUid: string) {
  const mine = await getDocs(
    query(
      collection(db, "Beacons", beaconId, "ChatMessages"),
      where("audienceUids", "array-contains", meUid),
      where("subtype", "==", "im-in"),
      where("actorUid", "==", meUid)
    )
  );
  await Promise.all(mine.docs.map((d) => deleteDoc(d.ref)));
}

/** Post my RSVP (or rally RSVP) on a beacon, copying its audience + expiry. Returns the beacon data. */
async function postRsvp(beaconId: string, meUid: string, rally: boolean): Promise<any> {
  // The parent's audience is copied onto the message verbatim (the create rule requires an exact
  // match when present), and its expiry so the RSVP ages out with the beacon.
  const parent = await getDoc(doc(db, "Beacons", beaconId));
  const p: any = parent.exists() ? parent.data() : {};
  if (p?.ownerUid === meUid) throw new Error("own-beacon"); // the owner is already counted as going
  const audienceUids: string[] = Array.isArray(p?.audienceUids) ? p.audienceUids : [];
  const actorName = await resolveDisplayName(meUid);
  await addDoc(collection(db, "Beacons", beaconId, "ChatMessages"), {
    type: "system",
    subtype: "im-in",
    ...(rally ? { rally: true } : {}),
    actorUid: meUid,
    actorName,
    // authorUid mirrors actorUid so the RSVPer can delete it (the delete rule keys off authorUid).
    authorUid: meUid,
    ...(audienceUids.length ? { audienceUids } : {}),
    text: rally ? `${actorName} is rallying` : `${actorName} RSVP'd`,
    createdAt: serverTimestamp(),
    ...(p?.expiresAt instanceof Timestamp ? { expiresAt: p.expiresAt } : {}),
  });
  return p;
}

/**
 * RSVP (on = true) or take it back. Returns false if it failed (the caller already showed an alert)
 * or was ignored as a duplicate tap.
 */
export async function setImIn(beaconId: string, on: boolean): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !beaconId || busy.has(beaconId)) return false;
  busy.add(beaconId);
  try {
    if (on) {
      await postRsvp(beaconId, me.uid, false);
      offerChatNotifications();
    } else {
      await clearMyRsvps(beaconId, me.uid);
    }
    return true;
  } catch (e: any) {
    if (e?.message === "own-beacon") return false;
    // Generic on purpose: if someone can see this beacon, telling them it "isn't shared with them"
    // reads as an accusation and is usually OUR stamping bug, not their standing.
    Alert.alert(on ? "Couldn't RSVP" : "Couldn't undo", "Please try again.");
    return false;
  } finally {
    busy.delete(beaconId);
  }
}

/**
 * RALLY for the original beacon `ogId`: RSVP as a rally and light my rally beacon for `groupIds`
 * ([] = all friends). Rallies stack: you can rally any number of plans and keep your own beacon
 * (only your OWN created plan is one-at-a-time); each rally is its own beacon in friends' lists. The server (fanOutForBeacon ->
 * extendRallyAudience) then invites those friends into the original's chat and announces it.
 * The RSVP goes first: lighting the rally makes the server widen the original's audience, and an
 * RSVP written after that with a stale audience copy would be rejected by the create rule.
 */
export async function startRally(ogId: string, groupIds: string[]): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !ogId || busy.has(ogId)) return false;
  busy.add(ogId);
  try {
    await clearMyRsvps(ogId, me.uid);
    const og = await postRsvp(ogId, me.uid, true);
    const ownerName = await resolveDisplayName(me.uid);
    const msg = (typeof og?.message === "string" && og.message.trim()) || "Hang out?";
    await setDoc(
      doc(db, "Beacons", rallyBeaconId(me.uid, ogId)),
      {
        ownerUid: me.uid,
        ownerName,
        message: msg,
        details: msg,
        active: true,
        scheduled: true,
        startAt: og?.startAt ?? Timestamp.now(),
        ...(og?.expiresAt instanceof Timestamp ? { expiresAt: og.expiresAt } : {}),
        timeHHmm: typeof og?.timeHHmm === "string" ? og.timeHHmm : null,
        groupIds,
        rallyOf: ogId,
        rallyOwnerUid: og?.ownerUid ?? null,
        rallyOwnerName: (og?.ownerName || "").toString() || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    offerChatNotifications();
    return true;
  } catch {
    Alert.alert("Couldn't rally", "Please try again.");
    return false;
  } finally {
    busy.delete(ogId);
  }
}

/** Stop rallying: put my rally beacon out and take back my RSVP. */
export async function stopRally(ogId: string): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !ogId || busy.has(ogId)) return false;
  busy.add(ogId);
  try {
    await Promise.all([
      updateDoc(doc(db, "Beacons", rallyBeaconId(me.uid, ogId)), {
        active: false,
        scheduled: false,
        updatedAt: serverTimestamp(),
      }).catch(() => {}),
      clearMyRsvps(ogId, me.uid),
    ]);
    return true;
  } catch {
    Alert.alert("Couldn't stop rallying", "Please try again.");
    return false;
  } finally {
    busy.delete(ogId);
  }
}

/**
 * After an RSVP: if chat notifications (users/{uid}.commentNotify) are off, offer to turn them on,
 * since "I'm in" without chat pings means missing "moved to 9pm". Asks on every RSVP while off.
 */
async function offerChatNotifications() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists() && (snap.data() as any)?.commentNotify === true) return;
  } catch {
    return;
  }
  Alert.alert("Get chat updates?", "Turn on notifications for messages in beacon chats you're in.", [
    { text: "Not now", style: "cancel" },
    {
      text: "Turn on",
      onPress: async () => {
        try {
          await setDoc(doc(db, "users", uid), { commentNotify: true }, { merge: true });
          const perm = await Notifications.getPermissionsAsync();
          if (!perm.granted) await ensureNotifyPermission();
        } catch {
          Alert.alert("Couldn't turn on", "You can turn this on in Settings.");
        }
      },
    },
  ]);
}

/**
 * The default notification set for someone who just granted OS permission: beacons from all
 * friends (Profiles.notifyAllBeacons, the server's master toggle) AND chat messages on beacons they
 * said they're in for (users.commentNotify). Chat pings are skipped for anyone who switched them
 * off in Settings: only that toggle ever writes commentNotify false (unset = never chose). Non-fatal:
 * both can still be set in Settings.
 */
export async function enableDefaultNotifyFlags(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const enableChat = async () => {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists() && (snap.data() as any)?.commentNotify === false) return;
    await setDoc(doc(db, "users", uid), { commentNotify: true }, { merge: true });
  };
  await Promise.all([
    setDoc(doc(db, "Profiles", uid), { notifyAllBeacons: true, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {}),
    enableChat().catch(() => {}),
  ]);
}
