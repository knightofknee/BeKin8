// lib/prefetchBeaconMessages.ts
//
// Warms the Firestore persistent cache for a beacon's ChatMessages subcollection
// so that when the user opens the beacon, ChatRoom's onSnapshot hits cache first
// and renders messages instantly. Pairs with persistentLocalCache in firebase.config.ts.
//
// Fire-and-forget: errors are swallowed on purpose; prefetch is best-effort.
// Dedup is module-scoped so ids prefetched once are never re-fetched in the same
// app session (onSnapshot in ChatRoom picks up any new messages via the listener).

import { useEffect, useRef } from 'react';
import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase.config';

const prefetched = new Set<string>();
const inFlight = new Set<string>();

const PREFETCH_LIMIT = 50;

export function prefetchBeaconMessages(beaconId: string, n: number = PREFETCH_LIMIT) {
  if (!beaconId) return;
  if (prefetched.has(beaconId) || inFlight.has(beaconId)) return;
  inFlight.add(beaconId);
  // The array-contains filter mirrors ChatRoom's listener and is required, not an optimization:
  // the ChatMessages read rule is `uid in resource.data.audienceUids`, and Firestore rejects any
  // query whose own constraints don't prove the rule. Without it this warms nothing and the cache
  // stays cold (silently, since prefetch swallows errors).
  const meUid = auth.currentUser?.uid;
  if (!meUid) return;
  const q = query(
    collection(db, 'Beacons', beaconId, 'ChatMessages'),
    where('audienceUids', 'array-contains', meUid),
    orderBy('createdAt', 'asc'),
    fbLimit(n),
  );
  getDocs(q)
    .then(() => {
      prefetched.add(beaconId);
    })
    .catch(() => {
      // Best-effort; cache warming failure is not user-visible.
    })
    .finally(() => {
      inFlight.delete(beaconId);
    });
}

/**
 * Hook-based variant: call with the list of beacon ids currently visible to
 * the user. Prefetches each once. Safe to call repeatedly, already-prefetched
 * ids are skipped.
 */
export function usePrefetchBeaconMessages(beaconIds: Array<string | undefined | null>) {
  // Stable dep: sorted, joined ids.
  const key = beaconIds.filter(Boolean).sort().join('|');
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    for (const id of beaconIds) {
      if (id) prefetchBeaconMessages(id);
    }
  }, [key]);
}
