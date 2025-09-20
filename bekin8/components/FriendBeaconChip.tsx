// components/FriendBeaconChip.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Timestamp } from 'firebase/firestore';

type Beacon = {
  id: string;
  userId: string;
  displayName: string;
  message: string;
  startAt: Timestamp;
  expiresAt: Timestamp;
};

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function FriendBeaconChip({ beacon }: { beacon: Beacon }) {
  const { isToday, icon, chipStyle } = useMemo(() => {
    const isToday = sameDay(beacon.startAt.toDate(), new Date());
    return {
      isToday,
      icon: isToday ? '🔥' : '🗓',
      chipStyle: isToday ? styles.chipToday : styles.chipFuture,
    };
  }, [beacon]);

  return (
    <View style={[styles.chip, chipStyle]}>
      <Text style={styles.chipIcon}>{icon}</Text>
      <Text style={styles.chipText} numberOfLines={1}>
        {beacon.displayName}
      </Text>
    </View>
  );
}

const colors = {
  ink: '#0B1426',
  chipTodayBg: '#FFE5E5',
  chipFutureBg: '#E7F0FF',
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
  },
  chipToday: { backgroundColor: colors.chipTodayBg },
  chipFuture: { backgroundColor: colors.chipFutureBg },
  chipIcon: { fontSize: 14 },
  chipText: { maxWidth: 160, fontWeight: '600', fontSize: 14, color: colors.ink },
});
