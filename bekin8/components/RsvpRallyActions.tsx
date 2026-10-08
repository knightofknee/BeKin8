// components/RsvpRallyActions.tsx
// The two ways to answer a friend's beacon, used on the home tiles and in the chat header:
//   RSVP  -> "✓ Going" (tap again to take it back)
//   Rally -> opens the RallyModal (who to bring); once rallying it reads "🔥 Rallying", and tapping
//            it offers to stop (puts your rally beacon out and takes back the RSVP).
// Always acts on the ORIGINAL beacon: a rally tile passes the beacon it's rallying for.
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { setImIn, stopRally, useBeaconGoing } from '../lib/rsvp';
import { selection, tap } from '../utils/haptics';
import RallyModal from './RallyModal';

type Props = {
  ogId: string;
  ogOwnerUid: string;
  ogOwnerName: string;
};

export default function RsvpRallyActions({ ogId, ogOwnerUid, ogOwnerName }: Props) {
  const { colors } = useTheme();
  const { iAmIn, iAmRallying, loaded } = useBeaconGoing(ogId, ogOwnerUid);
  const [rallyOpen, setRallyOpen] = useState(false);
  const who = ogOwnerName ? `${ogOwnerName}'s beacon` : 'this beacon';

  const confirmStop = () => {
    tap();
    Alert.alert('Stop rallying?', "Your beacon goes out and you're no longer going.", [
      { text: 'Keep rallying', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => stopRally(ogId) },
    ]);
  };

  return (
    <View style={styles.col}>
      {iAmRallying ? (
        <Pressable
          onPress={confirmStop}
          hitSlop={6}
          style={({ pressed }) => [styles.chip, styles.rallyingChip, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`You're rallying for ${who}. Tap to stop.`}
        >
          <Text style={[styles.txt, styles.rallyingTxt]}>🔥 Rallying</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            onPress={() => { selection(); setImIn(ogId, !iAmIn); }}
            disabled={!loaded}
            hitSlop={6}
            style={({ pressed }) => [
              styles.chip,
              iAmIn ? styles.goingChip : { backgroundColor: colors.primary },
              (pressed || !loaded) && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={iAmIn ? `You're going to ${who}. Tap to undo.` : `RSVP to ${who}`}
          >
            <Text style={[styles.txt, iAmIn && styles.goingTxt]}>{iAmIn ? '✓ Going' : 'RSVP'}</Text>
          </Pressable>
          <Pressable
            onPress={() => { selection(); setRallyOpen(true); }}
            disabled={!loaded}
            hitSlop={6}
            style={({ pressed }) => [styles.chip, styles.rallyChip, (pressed || !loaded) && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Rally your friends for ${who}`}
          >
            <Text style={[styles.txt, styles.rallyTxt]}>Rally</Text>
          </Pressable>
        </>
      )}
      <RallyModal visible={rallyOpen} ogBeaconId={ogId} ogOwnerName={ogOwnerName} onClose={() => setRallyOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignItems: 'stretch', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, minWidth: 74, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  txt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  goingChip: { backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC' },
  goingTxt: { color: '#166534' },
  rallyChip: { backgroundColor: '#F97316' },
  rallyTxt: { color: '#fff' },
  rallyingChip: { backgroundColor: '#FFEDD5', borderWidth: 1, borderColor: '#FDBA74' },
  rallyingTxt: { color: '#9A3412' },
});
