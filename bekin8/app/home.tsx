// app/home.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Button,
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  collection,
  query,
  where,
  Timestamp,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
} from 'firebase/firestore';

type FriendBeacon = {
  id: string;
  ownerUid: string;
  displayName: string;
};

export default function HomeScreen() {
  const router = useRouter();
  const [isLit, setIsLit] = useState<boolean | null>(null);

  // New: detailed list of friend beacons (today)
  const [friendBeacons, setFriendBeacons] = useState<FriendBeacon[] | null>(null);

  const friendLitCount = useMemo(
    () => (friendBeacons ? friendBeacons.length : null),
    [friendBeacons]
  );

  useEffect(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // --- Your own beacon (today) ---
    const checkUserBeacon = async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsLit(false);
        return;
      }
      const beaconsRef = collection(db, 'Beacons');
      const qOwn = query(
        beaconsRef,
        where('ownerUid', '==', user.uid),
        where('createdAt', '>=', Timestamp.fromDate(startOfToday))
      );
      try {
        const snap = await getDocs(qOwn);
        setIsLit(!snap.empty && !!snap.docs[0].data().active);
      } catch (err) {
        console.error('Error checking your beacon:', err);
        setIsLit(false);
      }
    };

    // --- Friends' beacons (active today) ---
    const checkFriendBeacons = async () => {
      const me = auth.currentUser;
      if (!me) {
        setFriendBeacons([]);
        return;
      }

      const beaconsRef = collection(db, 'Beacons');

      // 1) Build my friend UID list and a uid->username map
      const friendUids: string[] = [];
      const friendNameByUid: Record<string, string> = {};

      // Preferred subcollection: users/{uid}/friends
      try {
        const friendsSub = collection(db, 'users', me.uid, 'friends');
        const friendsSubSnap = await getDocs(friendsSub);
        friendsSubSnap.forEach(fd => {
          const f: any = fd.data();
          if (typeof f?.uid === 'string') {
            friendUids.push(f.uid);
            if (typeof f?.username === 'string') {
              friendNameByUid[f.uid] = f.username;
            }
          }
        });
      } catch {
        // ignore
      }

      // Fallback top-level Friends/{uid}.friends
      try {
        if (friendUids.length === 0) {
          const topRef = doc(db, 'Friends', me.uid);
          const topSnap = await getDoc(topRef);
          if (topSnap.exists()) {
            const arr = (topSnap.data() as any).friends;
            if (Array.isArray(arr)) {
              arr.forEach((f: any) => {
                if (f && typeof f === 'object' && typeof f.uid === 'string') {
                  if (!friendUids.includes(f.uid)) friendUids.push(f.uid);
                  if (typeof f.username === 'string') {
                    friendNameByUid[f.uid] = f.username;
                  }
                } else if (typeof f === 'string') {
                  // Only username, no uid — can't map to beacon owners reliably
                  // but keep in mind for legacy 'friends' array matching (below)
                }
              });
            }
          }
        }
      } catch {
        // ignore
      }

      // 2) Candidate docs = A) beacons that include me, B) beacons owned by my friends
      const seen = new Set<string>();
      const candidateDocs: any[] = [];

      // A) Beacons that explicitly include me
      try {
        const qAudience = query(beaconsRef, where('audienceUids', 'array-contains', me.uid));
        const snapA = await getDocs(qAudience);
        snapA.forEach(d => {
          if (!seen.has(d.id)) { seen.add(d.id); candidateDocs.push(d); }
        });
      } catch (e) {
        console.warn('audienceUids query failed:', e);
      }

      // B) Beacons owned by my friends (chunk ownerUid IN by ≤10)
      const chunk = (arr: string[], size = 10) => {
        const out: string[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      try {
        const batches = chunk([...new Set(friendUids)].filter(Boolean), 10);
        for (const batch of batches) {
          const qOwners = query(beaconsRef, where('ownerUid', 'in', batch));
          const snapB = await getDocs(qOwners);
          snapB.forEach(d => {
            if (!seen.has(d.id)) { seen.add(d.id); candidateDocs.push(d); }
          });
        }
      } catch (e) {
        console.warn('ownerUid IN query failed:', e);
      }

      // 3) Filter locally for "active today" and build list of FriendBeacon
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startMs = today.getTime();

      const results: FriendBeacon[] = [];
      const ownersSeen = new Set<string>(); // de-dupe per owner

      candidateDocs.forEach(d => {
        const data: any = d.data();
        const active = !!data.active;
        const createdMs = data?.createdAt?.toMillis?.() ? data.createdAt.toMillis() : 0;
        if (!active || createdMs < startMs) return;

        const ownerUid = String(data.ownerUid ?? '');
        if (!ownerUid || ownersSeen.has(ownerUid)) return;

        const ownerName: string | undefined =
          (typeof data.ownerName === 'string' && data.ownerName.trim()) ? data.ownerName.trim() :
          (friendNameByUid[ownerUid] ?? undefined);

        results.push({
          id: d.id,
          ownerUid,
          displayName: ownerName ?? 'Friend',
        });
        ownersSeen.add(ownerUid);
      });

      // 4) Optional: legacy username-based fallbacks if still empty (your old 'friends' array)
      if (results.length === 0 && me.displayName) {
        const username = me.displayName.trim();
        try {
          const qLegacy = query(beaconsRef, where('friends', 'array-contains', username));
          const legacySnap = await getDocs(qLegacy);
          const ownersSeenLegacy = new Set<string>(ownersSeen);
          legacySnap.forEach(d => {
            const data: any = d.data();
            const active = !!data.active;
            const createdMs = data?.createdAt?.toMillis?.() ? data.createdAt.toMillis() : 0;
            if (!active || createdMs < startMs) return;
            const ownerUid = String(data.ownerUid ?? '');
            if (!ownerUid || ownersSeenLegacy.has(ownerUid)) return;
            const ownerName = (typeof data.ownerName === 'string' && data.ownerName.trim())
              ? data.ownerName.trim()
              : 'Friend';
            results.push({
              id: d.id,
              ownerUid,
              displayName: ownerName,
            });
            ownersSeenLegacy.add(ownerUid);
          });
        } catch (e) {
          console.warn('legacy friends query failed:', e);
        }
      }

      // sort by name for stable UI
      results.sort((a, b) => a.displayName.localeCompare(b.displayName));

      setFriendBeacons(results);
    };

    checkUserBeacon();
    checkFriendBeacons();
  }, []);

  const toggleBeacon = () => {
    const action = isLit ? 'Extinguish' : 'Light';
    Alert.alert(
      `${action} Beacon`,
      `Are you sure you want to ${action.toLowerCase()} your beacon?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: isLit ? 'destructive' : 'default',
          onPress: async () => {
            const user = auth.currentUser;
            if (!user) {
              Alert.alert('Error', 'User not authenticated');
              return;
            }

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const beaconsRef = collection(db, 'Beacons');
            const qOwn = query(
              beaconsRef,
              where('ownerUid', '==', user.uid),
              where('createdAt', '>=', Timestamp.fromDate(startOfToday))
            );

            try {
              const snap = await getDocs(qOwn);

              if (!snap.empty) {
                // Toggle existing (light/unlight)
                const beaconDoc = snap.docs[0];
                const current = !!beaconDoc.data().active;
                await updateDoc(beaconDoc.ref, { active: !current });
                setIsLit(!current);
              } else {
                // Create new beacon with a proper audience (UIDs + usernames)
                const audienceUids: string[] = [];
                const audienceUsernames: string[] = [];

                // Preferred source: users/{uid}/friends subcollection
                try {
                  const friendsSub = collection(db, 'users', user.uid, 'friends');
                  const friendsSubSnap = await getDocs(friendsSub);
                  friendsSubSnap.forEach((fd) => {
                    const f: any = fd.data();
                    if (typeof f?.uid === 'string') audienceUids.push(f.uid);
                    if (typeof f?.username === 'string') audienceUsernames.push(f.username);
                  });
                } catch {
                  // ignore
                }

                // Fallback: Friends/{uid}.friends array
                try {
                  if (audienceUids.length === 0 && audienceUsernames.length === 0) {
                    const friendsRef = doc(db, 'Friends', user.uid);
                    const friendsSnap = await getDoc(friendsRef);
                    if (friendsSnap.exists()) {
                      const data = (friendsSnap.data() as any).friends;
                      if (Array.isArray(data)) {
                        for (const f of data) {
                          if (typeof f === 'string') {
                            audienceUsernames.push(f);
                          } else if (f && typeof f === 'object') {
                            if (typeof f.username === 'string') audienceUsernames.push(f.username);
                            if (typeof f.uid === 'string') audienceUids.push(f.uid);
                          }
                        }
                      }
                    }
                  }
                } catch {
                  // ignore
                }

                // De-dupe & clean
                const usernames = [...new Set(audienceUsernames)].filter(Boolean);
                const uids = [...new Set(audienceUids)].filter(Boolean);

                await addDoc(beaconsRef, {
                  ownerUid: user.uid,
                  ownerName: user.displayName ?? null, // helpful for lists
                  details: 'New beacon lit!',
                  active: true,
                  createdAt: Timestamp.now(),
                  // New canonical visibility:
                  audienceUids: uids,
                  audienceUsernames: usernames,
                  // Legacy compatibility:
                  friends: usernames,
                });

                setIsLit(true);
              }
            } catch (err) {
              console.error('Error toggling beacon:', err);
              Alert.alert('Error', 'Failed to update beacon.');
            }
          },
        },
      ]
    );
  };

  // loading state
  if (isLit === null || friendBeacons === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.status}>Checking beacon status…</Text>
      </View>
    );
  }

  return (
    <>
      {/* Friend beacons section */}
      <View style={styles.friendsSection}>
        {friendBeacons.length > 0 ? (
          <>
            <Text style={styles.friendActiveHeader}>
              {friendBeacons.length} friend{friendBeacons.length > 1 ? 's have' : ' has'} active beacons
            </Text>

            {/* Chips grid: 🔥 Name */}
            <View style={styles.chipsWrap}>
              {friendBeacons.map((fb) => ( // return here for maybe separate component later, for showing details and tracking chat
                <View key={fb.id} style={styles.chip}>
                  <Text style={styles.chipIcon}>🔥</Text>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {fb.displayName}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.friendInactive}>No friends have active beacons today</Text>
        )}
      </View>

      {/* Bottom-hugging main area */}
      <View style={styles.container}>
        <TouchableOpacity
          onPress={toggleBeacon}
          activeOpacity={0.7}
          style={styles.beaconContainer}
        >
          <Text style={styles.beaconIcon}>
            {isLit ? '🔥' : '🪵'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.title}>Beacon options under construction</Text>
        <Text style={styles.subtitle}>
          Tap the log to {isLit ? 'extinguish' : 'light'} your beacon
        </Text>

        {isLit ? (
          <Text style={styles.statusActive}>Your beacon is ACTIVE</Text>
        ) : (
          <Text style={styles.statusInactive}>Your beacon is INACTIVE</Text>
        )}

        <View style={styles.feedButton}>
          <Button title="Go to Feed" onPress={() => router.push('/feed')} />
        </View>
        <View style={styles.feedButton}>
          <Button title="Friends" onPress={() => router.push('/friends')} />
        </View>
        <View style={styles.feedButton}>
          <Button title="Create Post" onPress={() => router.push('/create-post')} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Bottom-hugging main area
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    padding: 24,
    justifyContent: 'flex-end',
    paddingBottom: 50,
  },
  beaconContainer: {
    marginBottom: 24,
  },
  beaconIcon: {
    fontSize: 64,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  status: {
    fontSize: 16,
    color: '#555',
  },
  statusActive: {
    fontSize: 18,
    fontWeight: '600',
    color: 'green',
    marginBottom: 12,
  },
  statusInactive: {
    fontSize: 18,
    fontWeight: '600',
    color: 'red',
    marginBottom: 12,
  },

  // Friends section
  friendsSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  friendActiveHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: 'green',
    marginBottom: 10,
  },
  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: 'red',
    marginTop: 16,
  },

  // Chips grid
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
    maxWidth: '100%',
  },
  chipIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  chipText: {
    fontSize: 14,
    maxWidth: 160, // prevents overflow on very long names
  },

  feedButton: {
    marginTop: 24,
    width: '60%',
  },
});
