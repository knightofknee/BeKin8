// lib/chatRead.ts
// Unread counts for beacon chats. "Read" is device-local (AsyncStorage): the newest message time
// you've seen in a chat. ChatRoom marks it while open; useUnreadCount counts friends' messages
// (chat + RSVP/rally lines, never your own) newer than that. A tiny pub/sub lets home's badge clear
// the moment the chat closes, without waiting on storage.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "../firebase.config";
import { getMillis } from "./millis";

const key = (uid: string, beaconId: string) => `@bekin_chat_read_${uid}:${beaconId}`;
const cache = new Map<string, number>();
const listeners = new Set<(beaconId: string, ms: number) => void>();

async function getLastRead(uid: string, beaconId: string): Promise<number> {
  const k = key(uid, beaconId);
  if (cache.has(k)) return cache.get(k)!;
  try {
    const v = Number((await AsyncStorage.getItem(k)) || 0);
    cache.set(k, v);
    return v;
  } catch {
    return 0;
  }
}

/** Record that everything up to `ms` in this chat has been seen (only ever moves forward). */
export function markChatRead(beaconId: string, ms: number) {
  const uid = auth.currentUser?.uid;
  if (!uid || !beaconId || !ms) return;
  const k = key(uid, beaconId);
  if ((cache.get(k) ?? 0) >= ms) return;
  cache.set(k, ms);
  AsyncStorage.setItem(k, String(ms)).catch(() => {});
  listeners.forEach((l) => l(beaconId, ms));
}

/**
 * Friends' messages in a beacon chat you haven't seen yet, capped at the newest 50 (the badge shows
 * "9+" well before that). Same query shape as ChatRoom's listener (audience filter + createdAt desc),
 * so it rides the index that already exists.
 */
export function useUnreadCount(beaconId?: string | null): number {
  const [lastRead, setLastRead] = useState<number | null>(null);
  const [times, setTimes] = useState<number[]>([]);
  const uid = auth.currentUser?.uid ?? null;

  useEffect(() => {
    setLastRead(null);
    if (!uid || !beaconId) return;
    let alive = true;
    getLastRead(uid, beaconId).then((v) => { if (alive) setLastRead(v); });
    const onRead = (id: string, ms: number) => { if (id === beaconId) setLastRead((p) => Math.max(p ?? 0, ms)); };
    listeners.add(onRead);
    return () => {
      alive = false;
      listeners.delete(onRead);
    };
  }, [uid, beaconId]);

  useEffect(() => {
    setTimes([]);
    if (!uid || !beaconId) return;
    const q = query(
      collection(db, "Beacons", beaconId, "ChatMessages"),
      where("audienceUids", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: number[] = [];
        snap.forEach((d) => {
          const m = d.data({ serverTimestamps: "estimate" }) as any;
          const from = m?.type === "system" ? m?.actorUid : m?.authorUid;
          if (from && from !== uid) out.push(getMillis(m?.createdAt));
        });
        setTimes(out);
      },
      () => setTimes([])
    );
  }, [uid, beaconId]);

  if (lastRead === null) return 0;
  return times.filter((t) => t > lastRead).length;
}
