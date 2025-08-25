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
import { auth, db } from '../firebase.config'; // adjust path if needed
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

    // check your own beacon
    const checkUserBeacon = async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsLit(false);
        return;
      }
      const beaconsRef = collection(db, 'Beacons');
      const q = query(
        beaconsRef,
        where('ownerUid', '==', user.uid),
        where('createdAt', '>=', Timestamp.fromDate(startOfToday))
      );
      try {
        const snap = await getDocs(q);
        setIsLit(!snap.empty && snap.docs[0].data().active);
      } catch (err) {
        console.error('Error checking your beacon:', err);
        setIsLit(false);
      }
    };

    // check friends' beacons (array of usernames)
    const checkFriendBeacons = async () => {
      const user = auth.currentUser;
      const username = user?.displayName;
      if (!user || !username) {
        setFriendLitCount(0);
        return;
      }
      const beaconsRef = collection(db, 'Beacons');
      const q = query(
        beaconsRef,
        where('active', '==', true),
        where('createdAt', '>=', Timestamp.fromDate(startOfToday)),
        where('friends', 'array-contains', username)
      );
      try {
        const snap = await getDocs(q);
        setFriendLitCount(snap.size);
      } catch (err) {
        console.error("Error checking friends' beacons:", err);
        setFriendLitCount(0);
      }
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
            const q = query(
              beaconsRef,
              where('ownerUid', '==', user.uid),
              where('createdAt', '>=', Timestamp.fromDate(startOfToday))
            );

            try {
              const snap = await getDocs(q);

              if (!snap.empty) {
                // toggle existing beacon
                const beaconDoc = snap.docs[0];
                const current = beaconDoc.data().active;
                await updateDoc(beaconDoc.ref, { active: !current });
                setIsLit(!current);
              } else {
                // create new beacon with friends' usernames
                const friendsRef = doc(db, 'Friends', user.uid);
                const friendsSnap = await getDoc(friendsRef);
                let friendsList: string[] = [];
                if (friendsSnap.exists()) {
                  const data = friendsSnap.data().friends;
                  friendsList = Array.isArray(data)
                    ? data.map((f: any) => f.username)
                    : [];
                }

                await addDoc(beaconsRef, {
                  ownerUid: user.uid,
                  details: 'New beacon lit!',
                  active: true,
                  createdAt: Timestamp.now(),
                  friends: friendsList,   // list of usernames
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
    <View style={styles.container}>
      <TouchableOpacity
        onPress={toggleBeacon}
        activeOpacity={0.7}
        style={styles.beaconContainer}
      >
        <Text style={styles.beaconIcon}>
          {isLit ? '🔥🔥🔥' : '🪵🪵🪵'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.title}>🏡 Home</Text>
      <Text style={styles.subtitle}>
        Tap the logs to {isLit ? 'extinguish' : 'light'} your beacon
      </Text>
      {isLit ? (
        <Text style={styles.statusActive}>Your beacon is ACTIVE</Text>
      ) : (
        <Text style={styles.statusInactive}>Your beacon is INACTIVE</Text>
      )}

      {friendLitCount! > 0 ? (
        <Text style={styles.friendActive}>
          {friendLitCount} friend{friendLitCount > 1 ? 's' : ''} have active beacons
        </Text>
      ) : (
        <Text style={styles.friendInactive}>
          No friends have active beacons today
        </Text>
      )}

      <View style={styles.feedButton}>
        <Button title="Go to Feed" onPress={() => router.push('/feed')} />
      </View>
      <View style={styles.feedButton}>
        <Button title="Friends" onPress={() => router.push('/friends')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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