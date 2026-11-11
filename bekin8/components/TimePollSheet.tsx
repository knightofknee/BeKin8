// components/TimePollSheet.tsx
// The group-scheduling sheet, opened from the beacon chat's holographic button.
//   Friends: tap every time that works, then "Lock in my vote" (confetti + a cheer).
//   Everyone: each option shows a live bar of how many people it works for; tap the bar to see who.
//   Owner: picks the winner ("Lock in"), which moves the beacon to that day + time and notifies
//   everyone who RSVP'd or voted (functions/src/index.ts onBeaconTimeDecided).
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '../providers/ThemeProvider';
import { selection, success, tap } from '../utils/haptics';
import ConfettiBurst from './ConfettiBurst';
import {
  castTimeVote,
  decideTime,
  optionDayLabel,
  optionLabel,
  optionTimeLabel,
  useTimeVotes,
  type TimeOption,
  type TimePoll,
  type Voter,
} from '../lib/timePoll';

type Props = {
  visible: boolean;
  onClose: () => void;
  beaconId: string;
  poll: TimePoll;
  isOwner: boolean;
  myName: string;
  ownerName: string;
};

const CHEERS = ["You're in the mix! 🎉", 'Vote locked in! 🙌', 'Counted! ✨'];

// The live bar for one option: fills to its share of the leader, springs as votes land.
function VoteBar({ count, max, leader, color, track }: { count: number; max: number; leader: boolean; color: string; track: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withSpring(max > 0 ? count / max : 0, { damping: 16, stiffness: 140 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, max]);
  const st = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, w.value)) * 100}%` }));
  return (
    <View style={[styles.barTrack, { backgroundColor: track }]}>
      <Animated.View style={[styles.barFill, { backgroundColor: leader ? '#F5B83D' : color }, st]} />
    </View>
  );
}

function VoterChips({ voters, color, bg }: { voters: Voter[]; color: string; bg: string }) {
  if (!voters.length) return <Text style={[styles.noVoters, { color }]}>No one yet. Be the first!</Text>;
  return (
    <View style={styles.voterWrap}>
      {voters.map((v) => (
        <View key={v.uid} style={[styles.voterChip, { backgroundColor: bg }]}>
          <Text style={[styles.voterTxt, { color }]} numberOfLines={1}>{v.name}</Text>
        </View>
      ))}
    </View>
  );
}

export default function TimePollSheet({ visible, onClose, beaconId, poll, isOwner, myName, ownerName }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { byOption, mine, voterCount, loaded } = useTimeVotes(visible ? beaconId : null, poll.options.map((o) => o.id));
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const [cheer, setCheer] = useState<string | null>(null);
  const cheerOp = useSharedValue(0);

  const open = poll.status === 'open';
  const canVote = open && !isOwner;

  // Seed my picks from my saved vote each time the sheet opens (and once votes load).
  useEffect(() => {
    if (!visible) return;
    setPicks(new Set(mine ?? []));
    setCheer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loaded]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of poll.options) c[o.id] = (byOption[o.id] ?? []).length;
    return c;
  }, [poll.options, byOption]);
  const max = Math.max(0, ...Object.values(counts));
  const decided = poll.options.find((o) => o.id === poll.decidedId) ?? null;
  const changed = useMemo(() => {
    const saved = new Set(mine ?? []);
    if (saved.size !== picks.size) return true;
    for (const id of picks) if (!saved.has(id)) return true;
    return false;
  }, [mine, picks]);

  const celebrate = (text: string) => {
    success();
    setBurst((b) => b + 1);
    setCheer(text);
    cheerOp.value = 0;
    cheerOp.value = withTiming(1, { duration: 220 });
  };
  const cheerStyle = useAnimatedStyle(() => ({
    opacity: cheerOp.value,
    transform: [{ scale: 0.9 + cheerOp.value * 0.1 }],
  }));

  const toggle = (id: string) => {
    if (!canVote) return;
    selection();
    setPicks((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (busy || !changed) return;
    setBusy(true);
    try {
      await castTimeVote(beaconId, poll.options.filter((o) => picks.has(o.id)).map((o) => o.id), myName);
      if (picks.size) celebrate(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
      else tap();
    } catch {
      Alert.alert("Couldn't save your vote", 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const lockIn = (o: TimeOption) => {
    Alert.alert(
      `Lock in ${optionLabel(o)}?`,
      'Everyone who RSVP’d or voted gets a notification, and your beacon moves to this day and time.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Lock it in',
          onPress: async () => {
            setBusy(true);
            try {
              await decideTime(beaconId, o);
              celebrate('Locked in! Everyone who voted or RSVP\u2019d gets a ping 🎉');
            } catch {
              Alert.alert("Couldn't lock it in", 'Check your connection and try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const title = !open ? "It's set!" : isOwner ? 'Pick the time' : 'When works for you?';
  const sub = !open
    ? decided
      ? `${ownerName || 'They'} locked in ${optionLabel(decided)}.`
      : 'Voting is closed.'
    : isOwner
    ? voterCount
      ? `${voterCount} ${voterCount === 1 ? 'friend has' : 'friends have'} voted. Tap a bar to see who, then lock one in.`
      : 'No votes yet. Friends vote from the chat; tap a bar to see who picked it.'
    : 'Tap every time that works for you. Tap a bar to see who else is in.';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.headRow}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.subtle} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: colors.subtle }]}>{sub}</Text>

          {!loaded ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
          ) : (
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
              {poll.options.map((o) => {
                const picked = picks.has(o.id);
                const isWinner = decided?.id === o.id;
                const count = counts[o.id] ?? 0;
                const leader = open && count > 0 && count === max;
                return (
                  <View
                    key={o.id}
                    style={[
                      styles.row,
                      { backgroundColor: colors.inputBg, borderColor: isWinner ? '#F5B83D' : picked ? colors.primary : colors.border },
                      (isWinner || picked) && { borderWidth: 2 },
                      !open && !isWinner && { opacity: 0.55 },
                    ]}
                  >
                    <View style={styles.rowTop}>
                      {canVote ? (
                        <Pressable
                          onPress={() => toggle(o.id)}
                          hitSlop={8}
                          style={styles.labelPress}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: picked }}
                          accessibilityLabel={optionLabel(o)}
                        >
                          <Ionicons
                            name={picked ? 'checkmark-circle' : 'ellipse-outline'}
                            size={26}
                            color={picked ? colors.primary : colors.subtle}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.day, { color: colors.text }]}>{optionDayLabel(o)}</Text>
                            <Text style={[styles.time, { color: colors.subtle }]}>{optionTimeLabel(o)}</Text>
                          </View>
                        </Pressable>
                      ) : (
                        <View style={styles.labelPress}>
                          {isWinner ? <Ionicons name="trophy" size={22} color="#F5B83D" /> : null}
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.day, { color: colors.text }]}>{optionDayLabel(o)}</Text>
                            <Text style={[styles.time, { color: colors.subtle }]}>{optionTimeLabel(o)}</Text>
                          </View>
                        </View>
                      )}
                      {isOwner && open ? (
                        <Pressable
                          onPress={() => lockIn(o)}
                          disabled={busy}
                          style={({ pressed }) => [styles.lockBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.85 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Lock in ${optionLabel(o)}`}
                        >
                          <Text style={styles.lockTxt}>Lock in</Text>
                        </Pressable>
                      ) : isWinner ? (
                        <Text style={styles.winnerTag}>LOCKED IN</Text>
                      ) : null}
                    </View>

                    {/* The bar: tap it to see who's in. */}
                    <Pressable
                      onPress={() => { tap(); setExpanded((e) => (e === o.id ? null : o.id)); }}
                      style={styles.barRow}
                      accessibilityRole="button"
                      accessibilityLabel={`${count} ${count === 1 ? 'person' : 'people'} for ${optionLabel(o)}. Tap to see who.`}
                    >
                      <VoteBar count={count} max={max} leader={leader || isWinner} color={colors.primary} track={colors.border} />
                      <Text style={[styles.count, { color: colors.text }]}>{count}</Text>
                      <Ionicons name={expanded === o.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.subtle} />
                    </Pressable>
                    {expanded === o.id && (
                      <VoterChips voters={byOption[o.id] ?? []} color={colors.text} bg={colors.card} />
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {canVote ? (
            <Pressable
              onPress={submit}
              disabled={busy || !changed}
              style={[styles.cta, { backgroundColor: changed ? colors.primary : colors.border }]}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.ctaTxt, !changed && { color: colors.subtle }]}>
                  {!changed ? (mine?.length ? 'Your vote is in ✓' : 'Pick at least one time') : mine?.length ? 'Update my vote' : 'Lock in my vote'}
                </Text>
              )}
            </Pressable>
          ) : isOwner && open ? (
            <Text style={[styles.foot, { color: colors.subtle }]}>
              Locking in moves your beacon to that day and time and notifies everyone who RSVP&apos;d or voted.
            </Text>
          ) : null}

          {cheer ? (
            <Animated.View pointerEvents="none" style={[styles.cheer, cheerStyle]}>
              <Text style={[styles.cheerTxt, { color: colors.text }]}>{cheer}</Text>
              {canVote ? (
                <Text style={[styles.cheerSub, { color: colors.subtle }]}>
                  {`${ownerName || 'They'} will lock in a time, and you'll get a ping.`}
                </Text>
              ) : null}
            </Animated.View>
          ) : null}
          <ConfettiBurst burstKey={burst} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '900' },
  sub: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  day: { fontSize: 16, fontWeight: '800' },
  time: { fontSize: 13.5, fontWeight: '600', marginTop: 1 },
  lockBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  lockTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  winnerTag: { color: '#F5B83D', fontWeight: '900', fontSize: 12, letterSpacing: 0.8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  barTrack: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 },
  count: { fontSize: 15, fontWeight: '900', minWidth: 18, textAlign: 'right' },
  voterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  voterChip: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, maxWidth: 160 },
  voterTxt: { fontSize: 13, fontWeight: '700' },
  noVoters: { fontSize: 13, marginTop: 8, fontStyle: 'italic' },
  cta: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  ctaTxt: { color: '#fff', fontSize: 16, fontWeight: '900' },
  foot: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  cheer: { alignItems: 'center', marginTop: 12 },
  cheerTxt: { fontSize: 18, fontWeight: '900' },
  cheerSub: { fontSize: 13, marginTop: 2 },
});
