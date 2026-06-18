// components/BeaconFire.tsx
// The beacon FIRE — glow + nested flame tongues + embers + ignition sparks — drawn ON TOP of the
// structure (rendered as the LAST child of the home page). Skin-driven: all colors/sizes/amplitudes
// come from the BeaconSkin. The idle flicker is driven by loopNoise off a single UI-thread clock, so
// it's randomized yet seamlessly looping. Ignition = master `progress` spring + ember sparks + glow
// ramp, edge-gated to a real false→true light (the ignite SOUND + haptic are driven by home off the
// lit edge, so they also cover the flameless tower). No flash oval. Transforms/opacity only (never
// the path `d`). Wrapped in a pointerEvents="none" View so it never eats page touches.
import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Path, Circle, Ellipse, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useFrameCallback,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../lib/beaconNoise';
import type { BeaconSkin } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Single-tongue ogee flame, base pinched at (0,0), tip at negative y. Three nested copies.
const OUTER = 'M -10 0 C -23 -16 -33 -34 -29 -55 C -25 -79 -26 -98 -14 -121 C -7 -137 5 -147 12 -152 C 17 -134 25 -105 27 -77 C 30 -51 26 -17 13 -4 C 7 4 -4 4 -10 0 Z';
const MID = 'M -8 0 C -18 -12 -26 -27 -23 -43 C -20 -62 -20 -76 -11 -94 C -5 -107 4 -115 9 -119 C 13 -105 20 -82 21 -60 C 23 -40 20 -13 10 -3 C 5 3 -3 3 -8 0 Z';
const CORE = 'M -5 -3 C -13 -17 -16 -38 -10 -56 C -7 -69 -1 -77 1 -87 C 5 -72 10 -56 9 -38 C 8 -17 4 -8 0 -3 C -1 1 -4 1 -5 -3 Z';

// Per-quantity loopNoise seeds with incommensurate periods → never visibly re-aligns.
const S = {
  oSy: makeSeed(11.2, 3.1, 1.7, 0.72), oSx: makeSeed(5.5, 9.9, 1.3, 0.64), oRot: makeSeed(2.2, 7.7, 1.1, 0.53), oOp: makeSeed(8.1, 1.5, 1.9, 0.88),
  mSy: makeSeed(21.4, 13.3, 1.6, 0.61), mSx: makeSeed(15.2, 19.1, 1.4, 0.56), mRot: makeSeed(12.6, 17.2, 1.0, 0.47), mOp: makeSeed(18.7, 11.9, 1.8, 0.70),
  cSy: makeSeed(31.1, 23.7, 1.5, 0.41), cSx: makeSeed(35.5, 29.2, 1.3, 0.38), cOp: makeSeed(38.3, 21.8, 1.7, 0.35),
  glow: makeSeed(41.2, 33.4, 1.6, 1.3),
};
const EMBER_X: NoiseSeed[] = [makeSeed(51, 7, 1.4, 1.9), makeSeed(57, 13, 1.5, 2.3), makeSeed(61, 19, 1.3, 2.1), makeSeed(67, 23, 1.6, 2.0), makeSeed(71, 29, 1.4, 2.4), makeSeed(73, 31, 1.5, 1.8)];
const EMBER_DUR = [1.9, 2.4, 2.1, 2.0, 2.4, 1.8]; // seconds per rise
const EMBER_OFF = [0, 0.4, 0.75, 0.2, 0.6, 0.9];
const MAX_EMBERS = 6;
const MAX_SPARKS = 24;

type Spark = { tx: SharedValue<number>; ty: SharedValue<number>; op: SharedValue<number> };

function EmberDot({ clock, progress, i, color }: { clock: SharedValue<number>; progress: SharedValue<number>; i: number; color: string }) {
  const dur = EMBER_DUR[i];
  const off = EMBER_OFF[i];
  const seed = EMBER_X[i];
  const props = useAnimatedProps(() => {
    const phase = ((clock.value / dur) + off) % 1;
    const lit = Math.min(Math.max(progress.value * 2 - 0.6, 0), 1);
    return {
      opacity: Math.sin(phase * Math.PI) * 0.85 * lit,
      transform: [{ translateX: loopNoiseSigned(clock.value, seed, 8) }, { translateY: -phase * 132 }],
    };
  });
  return <AnimatedCircle cx={0} cy={0} r={2.4} fill={color} animatedProps={props} />;
}

function SparkDot({ sv, color }: { sv: Spark; color: string }) {
  const props = useAnimatedProps(() => ({
    opacity: sv.op.value,
    transform: [{ translateX: sv.tx.value }, { translateY: sv.ty.value }],
  }));
  return <AnimatedCircle cx={0} cy={0} r={3} fill={color} animatedProps={props} />;
}

// One flame tongue's animatedProps: loopNoise-driven idle flicker (scaleY/scaleX/rot/opacity), scaled
// by progress (the ignition gate) and flickerAmp (cross-faded in after ignition). Module-level hook,
// called in fixed order for the three tongues.
function useFlameTongue(
  clock: SharedValue<number>,
  progress: SharedValue<number>,
  flickerAmp: SharedValue<number>,
  fPer: number,
  aSy: number,
  aSx: number,
  aRot: number,
  sySeed: NoiseSeed,
  sxSeed: NoiseSeed,
  rotSeed: NoiseSeed,
  opSeed: NoiseSeed,
  baseOp: number,
  withRot: boolean
) {
  return useAnimatedProps(() => {
    const t = clock.value / fPer;
    const sy = 1 + loopNoiseSigned(t, sySeed, aSy) * flickerAmp.value;
    const sx = 1 + loopNoiseSigned(t, sxSeed, aSx) * flickerAmp.value;
    const tr: any[] = [{ scaleX: sx }, { scaleY: progress.value * sy }];
    if (withRot) tr.push({ rotate: `${loopNoiseSigned(t, rotSeed, aRot) * flickerAmp.value}deg` });
    return { opacity: baseOp + loopNoise(t, opSeed) * 0.12, transform: tr };
  });
}

export type BeaconFireProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
};

export default function BeaconFire({ skin, active, anchorX, anchorY, measured }: BeaconFireProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const clock = useSharedValue(0);
  const progress = useSharedValue(0);
  const flickerAmp = useSharedValue(0);
  const glowOp = useSharedValue(0);
  const shock = useSharedValue(0); // Wildfire ignition shockwave ring
  const sparks: Spark[] = Array.from({ length: MAX_SPARKS }, () => ({ tx: useSharedValue(0), ty: useSharedValue(0), op: useSharedValue(0) }));

  const firstRun = useRef(true);
  const prevActiveRef = useRef(active);

  // One UI-thread clock (seconds). Stable callback (avoids re-registering the frame loop on every
  // re-render). Only ticks while lit AND motion is allowed — freezes the noise (glow shimmer, embers)
  // under reduced-motion and costs nothing when unlit.
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const frame = useFrameCallback(tick, false);
  useEffect(() => {
    frame.setActive(active && !reduce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  // Idle flicker amplitudes/speed pulled from the skin (captured as primitives for the worklets).
  const aSy = skin.flicker.sy, aSx = skin.flicker.sx, aRot = skin.flicker.rot, fPer = skin.flicker.period;

  const outerProps = useFlameTongue(clock, progress, flickerAmp, fPer, aSy, aSx, aRot, S.oSy, S.oSx, S.oRot, S.oOp, 0.8, true);
  const midProps = useFlameTongue(clock, progress, flickerAmp, fPer, aSy, aSx, aRot, S.mSy, S.mSx, S.mRot, S.mOp, 0.86, true);
  const coreProps = useFlameTongue(clock, progress, flickerAmp, fPer, aSy, aSx, aRot, S.cSy, S.cSx, S.cSx, S.cOp, 0.92, false);
  const glowProps = useAnimatedProps(() => ({ opacity: glowOp.value * (0.85 + loopNoise(clock.value, S.glow) * 0.3) }));
  const shockProps = useAnimatedProps(() => ({ r: 8 + shock.value * 92, opacity: (1 - shock.value) * 0.55 }));

  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    const justLit = active && !wasActive && !first;

    const fireSparks = () => {
      const n = Math.min(skin.spark.count, MAX_SPARKS);
      sparks.forEach((sp, i) => {
        if (i >= n) { sp.op.value = 0; return; }
        const dx = Math.random() * 80 - 40;
        const dy = -(48 + Math.random() * 80);
        const dur = 420 + Math.random() * 200;
        sp.tx.value = 0; sp.ty.value = 0; sp.op.value = 0;
        sp.tx.value = withDelay(i * 24, withTiming(dx, { duration: dur, easing: Easing.out(Easing.quad) }));
        sp.ty.value = withDelay(i * 24, withTiming(dy, { duration: dur, easing: Easing.out(Easing.quad) }));
        sp.op.value = withDelay(i * 24, withSequence(withTiming(1, { duration: 70 }), withDelay(Math.random() * 140, withTiming(0, { duration: 380 }))));
      });
    };

    if (reduce) {
      progress.value = first ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: 200 });
      flickerAmp.value = 0;
      glowOp.value = active ? 0.5 : 0;
      return;
    }

    if (active) {
      glowOp.value = withTiming(1, { duration: 500 });
      if (first) {
        progress.value = 1;
        flickerAmp.value = 1;
      } else if (justLit) {
        progress.value = withSpring(1, { damping: skin.ignition.damping, stiffness: skin.ignition.stiffness, mass: 0.8 });
        flickerAmp.value = withDelay(150, withTiming(1, { duration: 350 }));
        fireSparks();
        if (skin.ignition.shockwave) {
          shock.value = 0;
          shock.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
        }
      } else {
        progress.value = withTiming(1, { duration: 200 });
        flickerAmp.value = withTiming(1, { duration: 350 });
      }
    } else if (!first) {
      progress.value = withTiming(0, { duration: 520, easing: Easing.in(Easing.cubic) });
      flickerAmp.value = withTiming(0, { duration: 300 });
      glowOp.value = withTiming(0, { duration: 650 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(() => {
    return () => {
      cancelAnimation(clock); cancelAnimation(progress); cancelAnimation(flickerAmp); cancelAnimation(glowOp); cancelAnimation(shock);
      sparks.forEach((sp) => { cancelAnimation(sp.tx); cancelAnimation(sp.ty); cancelAnimation(sp.op); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!measured) return null;

  const fs = skin.flameScale;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <RadialGradient id="bfGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.85} />
            <Stop offset="50%" stopColor={skin.glow.edge} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="bfOuter" x1="0" y1="1" x2="0" y2="0"><Stop offset="0%" stopColor={skin.outer[0]} /><Stop offset="100%" stopColor={skin.outer[1]} /></LinearGradient>
          <LinearGradient id="bfMid" x1="0" y1="1" x2="0" y2="0"><Stop offset="0%" stopColor={skin.mid[0]} /><Stop offset="100%" stopColor={skin.mid[1]} /></LinearGradient>
          <LinearGradient id="bfCore" x1="0" y1="1" x2="0" y2="0"><Stop offset="0%" stopColor={skin.core[0]} /><Stop offset="100%" stopColor={skin.core[1]} /></LinearGradient>
        </Defs>

        <G transform={`translate(${anchorX} ${anchorY})`}>
          {skin.ignition.shockwave && (
            <AnimatedCircle cx={0} cy={-40} r={8} fill="none" stroke="#FFE8C0" strokeWidth={3} animatedProps={shockProps} />
          )}
          <AnimatedG animatedProps={glowProps}><Ellipse cx={0} cy={skin.glow.cy} rx={skin.glow.rx} ry={skin.glow.ry} fill="url(#bfGlow)" /></AnimatedG>
          <G transform={`scale(${fs})`}>
            <AnimatedG animatedProps={outerProps}><Path d={OUTER} fill="url(#bfOuter)" /></AnimatedG>
            <AnimatedG animatedProps={midProps}><Path d={MID} fill="url(#bfMid)" /></AnimatedG>
            <AnimatedG animatedProps={coreProps}><Path d={CORE} fill="url(#bfCore)" /></AnimatedG>
          </G>
          {Array.from({ length: Math.min(skin.ember.count, MAX_EMBERS) }).map((_, i) => (
            <EmberDot key={`e${i}`} clock={clock} progress={progress} i={i} color={skin.ember.color} />
          ))}
          {sparks.slice(0, Math.min(skin.spark.count, MAX_SPARKS)).map((sp, i) => (
            <SparkDot key={`s${i}`} sv={sp} color={skin.spark.color} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
