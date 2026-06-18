// components/BeaconSmoke.tsx
// The beacon SMOKE — billowing puff-clusters that peel off the flame and rise the FULL background
// height, behind every tile (FIRST child of the home page, pointerEvents View wrapper, tiles in
// front). Skin-driven tint/opacity/plume-count/rise/drift. Each plume rises on a clock sawtooth and
// drifts via loopNoise so the column never shows a seam. Only mounts while lit (+ a fade tail).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useFrameCallback,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoiseSigned, makeSeed, type NoiseSeed } from '../lib/beaconNoise';
import type { BeaconSkin } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

const SMOKE_BASE = 120; // start above the flame tip
const MAX_PLUMES = 8;
// Per-plume params (baseX offset, resting radius, rise duration s, phase offset, drift seed).
const P = Array.from({ length: MAX_PLUMES }, (_, i) => ({
  baseX: [0, -22, 20, -8, 14, -30, 28, -4][i],
  r: [22, 18, 16, 20, 15, 19, 14, 21][i],
  dur: [7.6, 9.2, 8.4, 8.8, 7.9, 9.6, 8.1, 8.6][i],
  off: [0, 0.27, 0.55, 0.13, 0.7, 0.4, 0.85, 0.2][i],
  seed: makeSeed(80 + i * 7, 11 + i * 5, 1.5, 6 + i) as NoiseSeed,
}));

function SmokePlume({
  clock,
  act,
  riseH,
  opacityMax,
  drift,
  i,
}: {
  clock: SharedValue<number>;
  act: SharedValue<number>;
  riseH: number;
  opacityMax: number;
  drift: number;
  i: number;
}) {
  const p = P[i];
  const props = useAnimatedProps(() => {
    const phase = ((clock.value / p.dur) + p.off) % 1;
    const ty = -SMOKE_BASE - phase * riseH;
    const tx = p.baseX + loopNoiseSigned(clock.value, p.seed, drift) * (0.4 + phase);
    const scale = 0.5 + phase * 1.7;
    const opacity = Math.pow(Math.sin(phase * Math.PI), 0.6) * opacityMax * act.value;
    return { opacity, transform: [{ translateX: tx }, { translateY: ty }, { scale }] };
  });
  const r = p.r;
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={-r * 0.4} cy={r * 0.18} r={r * 0.78} fill="url(#bsSmoke)" />
      <Circle cx={r * 0.42} cy={r * 0.08} r={r * 0.66} fill="url(#bsSmoke)" />
      <Circle cx={r * 0.02} cy={-r * 0.46} r={r * 0.72} fill="url(#bsSmoke)" />
    </AnimatedG>
  );
}

export type BeaconSmokeProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
};

export default function BeaconSmoke({ skin, active, anchorX, anchorY, measured }: BeaconSmokeProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const act = useSharedValue(0);
  const clock = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const frame = useFrameCallback(tick, false);
  useEffect(() => {
    // Don't tick for no-smoke skins (e.g. the lantern tower, plumes:0).
    frame.setActive(active && !reduce && skin.smoke.plumes > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, skin.smoke.plumes]);

  // Mount only while lit (+ a fade tail) so no smoke shows when unlit.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 900);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.8 : 0;
      return;
    }
    if (active) act.value = withTiming(1, { duration: first ? 0 : 1100 });
    else if (!first) act.value = withTiming(0, { duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(() => {
    return () => {
      cancelAnimation(act);
      cancelAnimation(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!measured || !visible) return null;

  const riseH = (H + 120) * skin.smoke.rise;
  const count = Math.min(skin.smoke.plumes, MAX_PLUMES);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <RadialGradient id="bsSmoke" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.smoke.tintHigh} stopOpacity={0.9} />
            <Stop offset="55%" stopColor={skin.smoke.tintLow} stopOpacity={0.32} />
            <Stop offset="100%" stopColor={skin.smoke.tintLow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <G transform={`translate(${anchorX} ${anchorY})`}>
          {Array.from({ length: count }).map((_, i) => (
            <SmokePlume key={`p${i}`} clock={clock} act={act} riseH={riseH} opacityMax={skin.smoke.opacity} drift={skin.smoke.drift} i={i} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
