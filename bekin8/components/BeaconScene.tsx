// components/BeaconScene.tsx
// The "The Beacons" full-screen BACKDROP (only for the 'mountains' skin): a dusk sky + parallax
// mountain ridgelines + distant beacon sites that ignite ONE-BY-ONE down the range when you light
// yours (the Gondor chain). Rendered as the FIRST child of the home page, behind all tiles, with a
// pointerEvents View wrapper. Returns null for other skins. v1 = decorative (the "distant beacons =
// your friends" version is a later feature).
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Rect, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// Distant beacon sites as fractions of (W, H), with the cascade order (the wave running to the horizon).
const DOTS = [
  { x: 0.3, y: 0.54, order: 0 },
  { x: 0.7, y: 0.53, order: 1 },
  { x: 0.18, y: 0.41, order: 2 },
  { x: 0.52, y: 0.4, order: 3 },
  { x: 0.84, y: 0.42, order: 4 },
];

function BeaconDot({ op, x, y, r }: { op: SharedValue<number>; x: number; y: number; r: number }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={x} cy={y} r={r * 2.4} fill="url(#bscGlow)" />
      <Circle cx={x} cy={y} r={r} fill="#FFD98C" />
    </AnimatedG>
  );
}

export type BeaconSceneProps = { skin: BeaconSkin; active: boolean };

export default function BeaconScene({ skin, active }: BeaconSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const ops = DOTS.map(() => useSharedValue(0.12));

  useEffect(() => {
    if (active) {
      DOTS.forEach((d, i) => {
        if (reduce) {
          ops[i].value = 1;
          return;
        }
        ops[i].value = withDelay(
          700 + d.order * 320,
          withSequence(
            withTiming(1, { duration: 420 }),
            withRepeat(withSequence(withTiming(0.7, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true)
          )
        );
      });
    } else {
      ops.forEach((o) => {
        cancelAnimation(o);
        o.value = reduce ? 0.12 : withTiming(0.12, { duration: 500 });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(() => () => ops.forEach((o) => cancelAnimation(o)), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (skin.structure !== 'mountains') return null;

  // Ridgelines computed from the live screen size (no distortion).
  const ridge = (yf: number, peaks: number[]) => {
    const y = H * yf;
    let d = `M0 ${y}`;
    peaks.forEach((p, i) => {
      const x = (W * (i + 1)) / (peaks.length + 1);
      d += ` L${x.toFixed(0)} ${(y - p).toFixed(0)} L${(x + W / (peaks.length + 1) / 2).toFixed(0)} ${y.toFixed(0)}`;
    });
    d += ` L${W} ${(y - 10).toFixed(0)} L${W} ${H} L0 ${H} Z`;
    return d;
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="bscSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#141B33" />
            <Stop offset="62%" stopColor="#2A2747" />
            <Stop offset="100%" stopColor="#5A3F52" />
          </LinearGradient>
          <RadialGradient id="bscGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC56B" stopOpacity={0.9} />
            <Stop offset="60%" stopColor="#FF9A3C" stopOpacity={0.25} />
            <Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#bscSky)" />
        <Circle cx={W * 0.2} cy={H * 0.12} r={1.3} fill="#fff" opacity={0.5} />
        <Circle cx={W * 0.7} cy={H * 0.09} r={1} fill="#fff" opacity={0.4} />
        <Circle cx={W * 0.84} cy={H * 0.18} r={1.2} fill="#fff" opacity={0.5} />
        <Circle cx={W * 0.4} cy={H * 0.07} r={1} fill="#fff" opacity={0.35} />
        <Path d={ridge(0.42, [38, 58, 30, 46])} fill="#39446A" />
        <Path d={ridge(0.55, [44, 30, 52])} fill="#2A3354" />
        {DOTS.map((d, i) => (
          <BeaconDot key={`d${i}`} op={ops[i]} x={W * d.x} y={H * d.y} r={3.2} />
        ))}
        <Path d={ridge(0.68, [50, 36, 44])} fill="#1B2440" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
