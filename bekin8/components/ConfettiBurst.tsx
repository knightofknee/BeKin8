// components/ConfettiBurst.tsx
// A one-shot confetti pop for positive feedback (vote cast, time locked in). Change `burstKey` to
// fire it again. Pure reanimated transforms on small Views; touch-transparent. Reduce Motion skips it.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const COLORS = ['#7CF7FF', '#A99BFF', '#FF92DA', '#FFE58A', '#8CFFC1', '#FF8A5C', '#5B8CFF'];
const COUNT = 26;

function Piece({ seed, burstKey }: { seed: number; burstKey: number }) {
  const p = useSharedValue(0);
  const cfg = useMemo(() => {
    const r = (n: number) => {
      const x = Math.sin(seed * 9301 + n * 49297) * 233280;
      return x - Math.floor(x);
    };
    const angle = -Math.PI / 2 + (r(1) - 0.5) * Math.PI * 1.2; // mostly upward fan
    const dist = 90 + r(2) * 120;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      fall: 120 + r(3) * 80,
      spin: (r(4) - 0.5) * 900,
      color: COLORS[Math.floor(r(5) * COLORS.length)],
      w: 6 + r(6) * 5,
      h: 9 + r(7) * 7,
      delay: r(8) * 90,
    };
  }, [seed]);

  useEffect(() => {
    if (!burstKey) return;
    p.value = 0;
    p.value = withDelay(cfg.delay, withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey]);

  const st = useAnimatedStyle(() => {
    const v = p.value;
    return {
      opacity: v === 0 ? 0 : v < 0.75 ? 1 : 1 - (v - 0.75) / 0.25,
      transform: [
        { translateX: cfg.dx * v },
        { translateY: cfg.dy * v + cfg.fall * v * v },
        { rotate: `${cfg.spin * v}deg` },
      ],
    };
  });
  return <Animated.View style={[styles.piece, { width: cfg.w, height: cfg.h, backgroundColor: cfg.color }, st]} />;
}

export default function ConfettiBurst({ burstKey }: { burstKey: number }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    // Centered via flex (no percentage insets: they've been unreliable in this codebase).
    <View pointerEvents="none" style={styles.fill}>
      <View style={styles.origin}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <Piece key={i} seed={i + 1} burstKey={burstKey} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  origin: { width: 0, height: 0 },
  piece: { position: 'absolute', borderRadius: 2 },
});
