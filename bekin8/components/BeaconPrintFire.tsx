// components/BeaconPrintFire.tsx
// The matchbox Bonfire's FLAME: hand-drawn frames played as STEPPED LIMITED ANIMATION, the way a
// printed label would come to life. No Skia shader, no tweens: three drawn flame poses cycle at
// 8fps "on threes" (frame = floor(t*8) % 3, so tongues SNAP between poses), each pose carrying its
// own spark diamonds. Ignition is a printed BURST: three stamped frames (small ring -> big ring +
// tick rays -> fading ticks) over ~0.4s starting at the torch impact. Everything is flat fills +
// thick cream outlines in the skin's 4-color print palette.
//
// TIMING CONTRACT (t=0 = lit edge, shared with BonfirePyre's torch + the ignite clip): the torch
// flies 0-0.9s, so this layer shows NOTHING before t=0.9; burst frames at 0.90/1.03/1.16 (gone by
// 1.29); the flame cycle runs from 0.9 on. Cold-mounting into an already-lit beacon starts the
// clock past the burst (steady flame, no replay). Renders in home's FIRE slot (front, pointerEvents
// none), anchored so the flame grows out of the pile's crown. Reduced motion: static pose, no burst.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Circle, G, Line } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';
import { useGatedClock } from '../lib/useGatedClock';

const AnimatedG = Animated.createAnimatedComponent(G);

// Print palette (must match the registry + BonfireScene + BonfirePyre).
const CREAM = '#F4E9CD';
const VERMILION = '#E64B2C';
const GOLD = '#F4B942';

const FLAME_ON_T = 0.9; // torch impact: nothing renders before this on a fresh light
const FPS = 8; // limited-animation cadence: chunky on purpose
const BURST = [0.9, 1.03, 1.16, 1.29] as const; // stamped burst frame windows

// Three drawn flame poses, authored in local px around the seat (0,0), up = negative y.
// Base spans +-45 (the pile's crown width: cone-from-wood holds for the printed flame too).
// Each pose: outer silhouette (vermilion, cream outline), inner tongue (gold), core (cream).
const POSES = [
  {
    outer:
      'M -45 2 C -47 -30 -33 -47 -36 -80 C -23 -71 -20 -55 -14 -64 C -8 -122 -19 -152 1 -206 C 12 -160 5 -126 15 -97 C 21 -85 27 -82 31 -112 C 39 -85 43 -40 45 2 Z',
    mid:
      'M -29 1 C -30 -24 -20 -37 -22 -58 C -13 -50 -12 -40 -7 -47 C -3 -84 -10 -104 2 -134 C 9 -104 4 -84 10 -62 C 15 -48 20 -46 22 -66 C 27 -46 28 -22 29 1 Z',
    core: 'M -13 0 C -14 -18 -7 -30 0 -62 C 7 -30 14 -18 13 0 Z',
    sparks: [
      { x: -38, y: -96, s: 3.2 },
      { x: 20, y: -128, s: 2.6 },
    ],
  },
  {
    outer:
      'M -45 2 C -46 -34 -30 -55 -34 -114 C -22 -88 -21 -66 -13 -76 C -6 -118 -16 -146 8 -198 C 15 -152 8 -120 16 -92 C 22 -78 30 -74 27 -96 C 37 -74 43 -38 45 2 Z',
    mid:
      'M -29 1 C -30 -26 -19 -40 -21 -72 C -13 -56 -12 -44 -6 -50 C -2 -80 -8 -98 6 -128 C 11 -100 5 -80 11 -58 C 15 -47 19 -45 18 -58 C 25 -44 28 -22 29 1 Z',
    core: 'M -13 0 C -14 -20 -5 -34 3 -58 C 8 -32 14 -16 13 0 Z',
    sparks: [
      { x: -30, y: -132, s: 2.8 },
      { x: 30, y: -104, s: 2.4 },
      { x: 12, y: -212, s: 2.2 },
    ],
  },
  {
    outer:
      'M -45 2 C -44 -36 -34 -50 -30 -86 C -22 -74 -22 -60 -15 -70 C -12 -114 -22 -148 -6 -200 C 4 -156 -2 -122 8 -94 C 15 -80 23 -78 28 -122 C 37 -92 42 -42 45 2 Z',
    mid:
      'M -29 1 C -29 -24 -22 -38 -19 -60 C -13 -50 -13 -42 -8 -48 C -6 -80 -12 -100 -2 -130 C 6 -102 2 -82 9 -60 C 13 -48 18 -48 20 -70 C 26 -46 28 -22 29 1 Z',
    core: 'M -13 0 C -13 -18 -9 -34 -2 -60 C 6 -32 14 -18 13 0 Z',
    sparks: [
      { x: 33, y: -134, s: 3.0 },
      { x: -22, y: -166, s: 2.4 },
    ],
  },
] as const;

// A printed spark: a hard little 4-point diamond, like a stamped ink mark.
function sparkPath(x: number, y: number, s: number) {
  return `M ${x} ${y - s} L ${x + s * 0.72} ${y} L ${x} ${y + s} L ${x - s * 0.72} ${y} Z`;
}

function FlamePose({
  clock, fade, idx, still, children,
}: { clock: SharedValue<number>; fade: SharedValue<number>; idx: number; still: boolean; children: React.ReactNode }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    // Reduced motion: pose 0 only, held steady.
    const frameOn = still ? idx === 0 : t >= FLAME_ON_T && Math.floor(t * FPS) % 3 === idx;
    return { opacity: frameOn ? fade.value : 0 };
  }, [idx, still]);
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

function BurstFrame({
  clock, fade, idx, still, children,
}: { clock: SharedValue<number>; fade: SharedValue<number>; idx: number; still: boolean; children: React.ReactNode }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const on = !still && t >= BURST[idx] && t < BURST[idx + 1];
    return { opacity: on ? fade.value : 0 };
  }, [idx, still]);
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

export type BeaconPrintFireProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconPrintFire({ skin: _skin, active, anchorX, anchorY, measured, focused = true }: BeaconPrintFireProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const { clock } = useGatedClock(active && !reduce && focused);

  // Master on/off fade: instant on (the t >= 0.9 gate does the reveal), eased off so extinguishing
  // doesn't hard-cut. The pose SNAPPING is the art style; this is just the off-ramp.
  const fade = useSharedValue(active ? 1 : 0);
  const fadeFirst = useRef(true);
  useEffect(() => {
    const f = fadeFirst.current;
    fadeFirst.current = false;
    cancelAnimation(fade);
    if (reduce) {
      fade.value = active ? 1 : 0;
      return;
    }
    if (active) fade.value = 1;
    else if (!f) fade.value = withTiming(0, { duration: 360 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => cancelAnimation(fade), []); // eslint-disable-line react-hooks/exhaustive-deps

  const prevActiveRef = useRef(active);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 420);
    return () => clearTimeout(t);
  }, [active]);

  // Clock anchoring: a REAL lit edge replays the whole ceremony (torch handles 0-0.9s, this layer
  // takes over at impact); a cold mount into an already-lit beacon starts past the burst.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    const was = prevActiveRef.current;
    prevActiveRef.current = active;
    if (active && !was && !first) {
      clock.value = 0;
    } else if (active && first) {
      clock.value = BURST[3] + 1; // steady flame, no burst replay
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!measured || !visible) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <G transform={`translate(${anchorX} ${anchorY})`}>
          {/* stamped ignition burst: ring -> ring + tick rays -> fading ticks */}
          <BurstFrame clock={clock} fade={fade} idx={0} still={reduce}>
            <Circle cx={0} cy={-26} r={26} fill="none" stroke={CREAM} strokeWidth={3} />
          </BurstFrame>
          <BurstFrame clock={clock} fade={fade} idx={1} still={reduce}>
            <Circle cx={0} cy={-30} r={52} fill="none" stroke={CREAM} strokeWidth={2.4} />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
              const x1 = Math.cos(a) * 62;
              const y1 = -30 + Math.sin(a) * 62;
              const x2 = Math.cos(a) * 84;
              const y2 = -30 + Math.sin(a) * 84;
              return <Line key={`t${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={GOLD} strokeWidth={3} strokeLinecap="round" />;
            })}
          </BurstFrame>
          <BurstFrame clock={clock} fade={fade} idx={2} still={reduce}>
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
              const x1 = Math.cos(a) * 88;
              const y1 = -30 + Math.sin(a) * 88;
              const x2 = Math.cos(a) * 98;
              const y2 = -30 + Math.sin(a) * 98;
              return <Line key={`u${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={CREAM} strokeWidth={2} strokeLinecap="round" opacity={0.7} />;
            })}
          </BurstFrame>

          {/* the three flame poses, snapping at 8fps */}
          {POSES.map((p, i) => (
            <FlamePose key={`p${i}`} clock={clock} fade={fade} idx={i} still={reduce}>
              <Path d={p.outer} fill={VERMILION} stroke={CREAM} strokeWidth={3} strokeLinejoin="round" />
              <Path d={p.mid} fill={GOLD} />
              <Path d={p.core} fill={CREAM} />
              {p.sparks.map((s, j) => (
                <Path key={`s${j}`} d={sparkPath(s.x, s.y, s.s)} fill={j % 2 === 0 ? GOLD : CREAM} />
              ))}
            </FlamePose>
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
