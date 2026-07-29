// components/BeaconBonfireFlame.tsx
// The Bonfire's bespoke FIRE, built from scratch for round 5. The point of this component is
// PLANE-OF-EXISTENCE: it renders BEHIND the structure (home mounts it in the behind-tiles slot),
// so the pyre's front logs occlude the flame's base and the fire visibly burns FROM WITHIN the
// woodpile; BonfirePyre adds small front licks over its own logs, sandwiching the wood inside
// the blaze. No shader, no frame loop: seven independent SVG tongues, each driven by its own
// seeded loopNoise (incommensurate periods, the app's randomized-fire standard), so the flame
// never repeats. Plus rising embers and a warm base glow.
//
// TIMING CONTRACT (t=0 = lit edge): the torch flies 0-0.9s (skin.ignition.delayMs), then the
// tongues SPRING up with overshoot; extinguish sinks them with no delay. Cold-mounting into an
// already-lit beacon skips the ceremony.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Circle, Ellipse, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSpring,
  withDelay,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../lib/beaconNoise';
import { useGatedClock } from '../lib/useGatedClock';
import type { BeaconSkin } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// A tongue: an ogee flame body authored with its BASE at (0,0), tip toward -y, half-width hw,
// height h. The asymmetric curl direction alternates so the fire reads hand-drawn, not mirrored.
function tonguePath(hw: number, h: number, curl: number): string {
  const c = curl * hw * 0.55; // tip curl offset
  return (
    `M ${-hw} 0` +
    ` C ${-hw * 1.06} ${-h * 0.3} ${-hw * 0.5} ${-h * 0.52} ${-hw * 0.42} ${-h * 0.66}` +
    ` C ${-hw * 0.3} ${-h * 0.84} ${c - hw * 0.1} ${-h * 0.9} ${c} ${-h}` +
    ` C ${c + hw * 0.12} ${-h * 0.86} ${hw * 0.34} ${-h * 0.78} ${hw * 0.44} ${-h * 0.6}` +
    ` C ${hw * 0.56} ${-h * 0.42} ${hw * 1.04} ${-h * 0.26} ${hw} 0 Z`
  );
}

// ONE fire, not seven dancers. The blaze is built as solid nested BODY masses (no gaps: a
// continuous bright core the wood sits in) whose tips split into tongues; every layer shares a
// common BREATH noise (the whole fire surges together) plus a small per-layer noise for tip
// character. Individual sway is tiny: coherent mass, flickering edges.
const BREATH = makeSeed(7.3, 4.1, 1.4, 4.7);

type FlameLayer = {
  dx: number; hw: number; h: number; curl: number; grad: string; op: number;
  ownAmp: number; swayAmp: number; sy: NoiseSeed; rot: NoiseSeed;
};
// Painted back to front; bases overlap heavily so the lower half is one solid mass spanning the
// fuel bed (~±54). The taller narrow layers read as the tips of the SAME fire, not separate flames.
const LAYERS: FlameLayer[] = [
  // back tongue tips peeking over the mass
  { dx: -24, hw: 18, h: 170, curl: -1, grad: 'bfBack', op: 0.95, ownAmp: 0.18, swayAmp: 3, sy: makeSeed(3.1, 8.2, 1.3, 5.3), rot: makeSeed(11.2, 4.9, 1.1, 6.4) },
  { dx: 21, hw: 17, h: 152, curl: 1, grad: 'bfBack', op: 0.95, ownAmp: 0.18, swayAmp: 3, sy: makeSeed(9.4, 12.7, 1.3, 6.1), rot: makeSeed(5.5, 10.1, 1.1, 7.9) },
  // the MASS: wide solid bodies, gentle motion (this is what was missing)
  { dx: 0, hw: 54, h: 168, curl: 1, grad: 'bfBack', op: 0.98, ownAmp: 0.08, swayAmp: 1.5, sy: makeSeed(6.8, 3.3, 1.4, 6.3), rot: makeSeed(4.2, 7.4, 1.1, 8.9) },
  { dx: 2, hw: 44, h: 196, curl: -1, grad: 'bfMid', op: 1, ownAmp: 0.1, swayAmp: 2, sy: makeSeed(10.6, 5.1, 1.4, 5.7), rot: makeSeed(8.9, 2.2, 1.1, 4.9) },
  // the tall central tip growing OUT of the mass
  { dx: -1, hw: 24, h: 236, curl: 1, grad: 'bfTall', op: 1, ownAmp: 0.2, swayAmp: 3.5, sy: makeSeed(2.4, 9.9, 1.5, 6.9), rot: makeSeed(13.4, 6.8, 1.1, 8.3) },
  // hot interior
  { dx: 0, hw: 30, h: 132, curl: -1, grad: 'bfCore', op: 1, ownAmp: 0.1, swayAmp: 1.5, sy: makeSeed(5.9, 13.6, 1.4, 3.9), rot: makeSeed(6.6, 3.7, 1.1, 4.4) },
  { dx: 1, hw: 16, h: 84, curl: 1, grad: 'bfInner', op: 1, ownAmp: 0.12, swayAmp: 1, sy: makeSeed(4.6, 6.1, 1.3, 3.1), rot: makeSeed(2.7, 8.8, 1.1, 3.6) },
];

function Tongue({
  clock, progress, cfg, still,
}: { clock: SharedValue<number>; progress: SharedValue<number>; cfg: FlameLayer; still: boolean }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const p = progress.value;
    const breath = still ? 0.5 : loopNoise(t, BREATH); // shared: the whole fire surges as one
    const own = still ? 0.5 : loopNoise(t, cfg.sy);
    const sway = still ? 0 : loopNoiseSigned(t, cfg.rot, cfg.swayAmp);
    return {
      opacity: p <= 0.01 ? 0 : cfg.op * (0.9 + 0.1 * own),
      transform: [
        { translateX: cfg.dx },
        { rotate: `${sway}deg` },
        { scaleY: p * (0.82 + 0.16 * breath + cfg.ownAmp * (own - 0.5) * 2) },
        { scaleX: 0.95 + 0.08 * breath },
      ],
    };
  }, [still]);
  return (
    <AnimatedG animatedProps={props}>
      <Path d={tonguePath(cfg.hw, cfg.h, cfg.curl)} fill={`url(#${cfg.grad})`} />
    </AnimatedG>
  );
}

// Rising embers: seeded loops with sideways wander, dying out near the top of their rise.
type EmberCfg = { dx: number; ph: number; period: number; rise: number; r: number; sx: NoiseSeed };
const EMBERS: EmberCfg[] = [
  { dx: -22, ph: 0.0, period: 5.9, rise: 210, r: 2.4, sx: makeSeed(4.2, 8.8, 1.3, 9.7) },
  { dx: 14, ph: 0.33, period: 7.3, rise: 245, r: 2.0, sx: makeSeed(9.1, 3.4, 1.4, 11.3) },
  { dx: 30, ph: 0.62, period: 5.1, rise: 180, r: 1.7, sx: makeSeed(2.7, 12.6, 1.3, 8.9) },
  { dx: -6, ph: 0.81, period: 8.1, rise: 265, r: 1.8, sx: makeSeed(6.4, 5.7, 1.3, 7.3) },
];

function Ember({
  clock, progress, cfg, still,
}: { clock: SharedValue<number>; progress: SharedValue<number>; cfg: EmberCfg; still: boolean }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const c = (t / cfg.period + cfg.ph) % 1;
    let fade = Math.min(c * 5, (1 - c) * 2.2);
    fade = fade < 0 ? 0 : fade > 1 ? 1 : fade;
    return {
      opacity: still ? 0 : fade * 0.9 * progress.value,
      transform: [
        { translateX: cfg.dx + loopNoiseSigned(t, cfg.sx, 16) },
        { translateY: -30 - c * cfg.rise },
      ],
    };
  }, [still]);
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={cfg.r * 2.2} fill="url(#bfEmber)" />
      <Circle cx={0} cy={0} r={cfg.r * 0.85} fill="#FFD9A0" />
    </AnimatedG>
  );
}

export type BeaconBonfireFlameProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconBonfireFlame({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconBonfireFlameProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const progress = useSharedValue(active ? 1 : 0);
  const glowP = useSharedValue(active ? 1 : 0);
  const prevActiveRef = useRef(active);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(active);

  const { clock } = useGatedClock(active && !reduce && focused);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 650);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    const was = prevActiveRef.current;
    prevActiveRef.current = active;
    const justLit = active && !was && !first;
    const wait = skin.ignition.delayMs ?? 0;
    cancelAnimation(progress);
    cancelAnimation(glowP);
    if (reduce) {
      progress.value = active ? 1 : 0;
      glowP.value = active ? 1 : 0;
      return;
    }
    if (active) {
      if (justLit) {
        // the torch lands, then the fire ROARS up with overshoot
        progress.value = withDelay(wait, withSpring(1, { damping: skin.ignition.damping, stiffness: skin.ignition.stiffness, mass: 0.9 }));
        glowP.value = withDelay(wait, withTiming(1, { duration: 600 }));
      } else {
        progress.value = first ? 1 : withTiming(1, { duration: 260 });
        glowP.value = first ? 1 : withTiming(1, { duration: 300 });
      }
    } else if (!first) {
      progress.value = withTiming(0, { duration: 500 });
      glowP.value = withTiming(0, { duration: 450 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(
    () => () => {
      cancelAnimation(progress);
      cancelAnimation(glowP);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const glowProps = useAnimatedProps(() => ({ opacity: glowP.value * 0.55 }));

  if (!measured || !visible) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="bfBack" x1="0" y1="1" x2="0" y2="0">
            <Stop offset={0} stopColor="#D8431A" />
            <Stop offset={1} stopColor="#8A1408" />
          </LinearGradient>
          <LinearGradient id="bfMid" x1="0" y1="1" x2="0" y2="0">
            <Stop offset={0} stopColor="#FF8A1F" />
            <Stop offset={1} stopColor="#E8500E" />
          </LinearGradient>
          <LinearGradient id="bfTall" x1="0" y1="1" x2="0" y2="0">
            <Stop offset={0} stopColor="#FFB347" />
            <Stop offset={1} stopColor="#FF6A14" />
          </LinearGradient>
          <LinearGradient id="bfCore" x1="0" y1="1" x2="0" y2="0">
            <Stop offset={0} stopColor="#FFE9A8" />
            <Stop offset={1} stopColor="#FFC23D" />
          </LinearGradient>
          <LinearGradient id="bfInner" x1="0" y1="1" x2="0" y2="0">
            <Stop offset={0} stopColor="#FFFBEA" />
            <Stop offset={1} stopColor="#FFE9A8" />
          </LinearGradient>
          <RadialGradient id="bfGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC97A" stopOpacity={0.85} />
            <Stop offset="60%" stopColor="#FF8A3C" stopOpacity={0.3} />
            <Stop offset="100%" stopColor="#FF8A3C" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bfEmber" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC97A" stopOpacity={0.9} />
            <Stop offset="60%" stopColor="#FF8A3C" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#FF8A3C" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <G transform={`translate(${anchorX} ${anchorY})`}>
          {/* warm firelight halo hugging the pyre (behind the wood, like the flame body) */}
          <AnimatedG animatedProps={glowProps}>
            <Ellipse cx={0} cy={-34} rx={96} ry={72} fill="url(#bfGlow)" />
          </AnimatedG>
          {LAYERS.map((cfg, i) => (
            <Tongue key={`t${i}`} clock={clock} progress={progress} cfg={cfg} still={reduce} />
          ))}
          {EMBERS.map((cfg, i) => (
            <Ember key={`e${i}`} clock={clock} progress={progress} cfg={cfg} still={reduce} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
