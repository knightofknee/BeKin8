// app/home.tsx

import React, { useState, useEffect } from 'react';
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

export default function HomeScreen() {
  const router = useRouter();
  const [isLit, setIsLit] = useState<boolean | null>(null);
  const [friendLitCount, setFriendLitCount] = useState<number | null>(null);

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
        setFriendLitCount(0);
        return;
      }

      const beaconsRef = collection(db, 'Beacons');

      // 1) Build my friend UID list from users/{uid}/friends (preferred) or Friends/{uid}
      const friendUids: string[] = [];

      // Preferred subcollection
      try {
        const friendsSub = collection(db, 'users', me.uid, 'friends');
        const friendsSubSnap = await getDocs(friendsSub);
        friendsSubSnap.forEach(fd => {
          const f: any = fd.data();
          if (typeof f?.uid === 'string') friendUids.push(f.uid);
        });
      } catch {
        // ignore
      }

      // Fallback top-level Friends doc (array of strings or objects)
      try {
        if (friendUids.length === 0) {
          const topRef = doc(db, 'Friends', me.uid);
          const topSnap = await getDoc(topRef);
          if (topSnap.exists()) {
            const arr = (topSnap.data() as any).friends;
            if (Array.isArray(arr)) {
              arr.forEach((f: any) => {
                if (f && typeof f === 'object' && typeof f.uid === 'string') {
                  friendUids.push(f.uid);
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

      // 3) Filter locally for "active today"
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startMs = today.getTime();

      let count = 0;
      candidateDocs.forEach(d => {
        const data: any = d.data();
        const active = !!data.active;
        const createdMs = data?.createdAt?.toMillis?.() ? data.createdAt.toMillis() : 0;
        if (active && createdMs >= startMs) count++;
      });

      // 4) Optional: last-ditch legacy username fallback if still zero
      if (count === 0 && me.displayName) {
        const username = me.displayName.trim();
        try {
          const qLegacy = query(beaconsRef, where('friends', 'array-contains', username));
          const legacySnap = await getDocs(qLegacy);
          legacySnap.forEach(d => {
            const data: any = d.data();
            const active = !!data.active;
            const createdMs = data?.createdAt?.toMillis?.() ? data.createdAt.toMillis() : 0;
            if (active && createdMs >= startMs) count++;
          });
        } catch (e) {
          console.warn('legacy friends query failed:', e);
        }
      }

      setFriendLitCount(count);
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

                // Fallback: Friends/{uid}.friends array (strings or objects)
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
  if (isLit === null || friendLitCount === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.status}>Checking beacon status…</Text>
      </View>
    );
  }

  return (
    <>
      {/* Simple friend beacons summary (you can replace with a full list later) */}
      <View>
        {friendLitCount! > 0 ? (
          <Text style={styles.friendActive}>
            {friendLitCount} friend{friendLitCount > 1 ? 's have active beacons' : ' has an active beacon'}
          </Text>
        ) : (
          <Text style={styles.friendInactive}>
            No friends have active beacons today
          </Text>
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
    justifyContent: 'flex-end', // push content to the bottom
    paddingBottom: 50,          // breathing room above the bottom edge
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
  friendActive: {
    fontSize: 16,
    fontWeight: '600',
    color: 'green',
    marginTop: 16,
  },
  friendInactive: {
    fontSize: 16,
    fontWeight: '600',
    color: 'red',
    marginTop: 16,
  },
  feedButton: {
    marginTop: 24,
    width: '60%',
  },
});
