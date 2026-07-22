// components/FriendCelebration.tsx
// Celebration for a link-made friendship. Two variants:
//   'first' - a NEW user's very first friend (shown before the tutorial): big fire, warm welcome.
//   'link'  - an EXISTING user adding another friend via their link: quicker, handshake-flavored.
// Either way the friendship is already made with zero friction; this screen just celebrates it.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { success } from '../utils/haptics';

export type FriendCelebrationVariant = 'first' | 'link';

type Props = {
  visible: boolean;
  /** Usernames of the friends this link (or claim-all match) just connected; may be several. */
  friendNames: string[];
  variant: FriendCelebrationVariant;
  onDone: () => void;
};

export default function FriendCelebration({ visible, friendNames, variant, onDone }: Props) {
  const { colors } = useTheme();
  // Emoji pops in with an overshoot spring; a soft ring pulses out behind it on a loop.
  const pop = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.4)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    success();
    pop.setValue(0);
    ringScale.setValue(0.4);
    ringOpacity.setValue(0.5);
    const spring = Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      damping: 9,
      stiffness: 160,
      mass: 0.8,
    });
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 1.6, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ])
    );
    spring.start();
    pulse.start();
    return () => {
      spring.stop();
      pulse.stop();
    };
  }, [visible, pop, ringScale, ringOpacity]);

  const labels = friendNames.filter(Boolean).map((n) => `@${n}`);
  const who =
    labels.length === 0
      ? 'your friend'
      : labels.length === 1
      ? labels[0]
      : labels.length === 2
      ? `${labels[0]} and ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const many = labels.length > 1;
  const v =
    variant === 'first'
      ? {
          emoji: '🔥',
          ring: colors.primary,
          title: `Friends with ${who}!`,
          body: many
            ? 'Their links connected you automatically. When they light a beacon, you’ll see it here, and they’ll see yours.'
            : 'Their link connected you automatically. When they light a beacon, you’ll see it here, and they’ll see yours.',
          cta: 'Okay',
        }
      : {
          emoji: '🤝',
          ring: colors.success,
          title: many ? `New friends: ${who}` : `New friend: ${who}`,
          body: many
            ? 'Their friend links connected you instantly. Watch for their beacons.'
            : 'Their friend link connected you instantly. Watch for their beacon.',
          cta: 'Nice',
        };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.stage}>
            <Animated.View
              style={[
                styles.ring,
                { borderColor: v.ring, opacity: ringOpacity, transform: [{ scale: ringScale }] },
              ]}
            />
            <Animated.Text
              style={[
                styles.emoji,
                {
                  opacity: pop,
                  transform: [
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                  ],
                },
              ]}
            >
              {v.emoji}
            </Animated.Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{v.title}</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>{v.body}</Text>
          <Pressable
            onPress={onDone}
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={v.cta}
          >
            <Text style={styles.btnTxt}>{v.cta}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  stage: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 3 },
  emoji: { fontSize: 64 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 },
  btn: {
    alignSelf: 'stretch',
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
