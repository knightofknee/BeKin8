// components/scenes/SmokeSignalScene.tsx
// SMOKE SIGNAL backdrop (behind all tiles): a painted desert in daylight, in a mid-century
// travel-poster style (art/in/smoke-bg.png via art/build_skins.py): two thirds open sky over low
// mesas, and a sandstone bluff in front where the signal fire lies (the structure, PaintedSprite:
// dry wood under green pine boughs).
// THE SMOKE IS THE POINT. While your beacon is lit, puffs of real-looking smoke (a Skia shader:
// billowing, soft-edged, sunlit on top and shadowed underneath, churning as they go) leave the TIP
// of the flame one after another and climb the whole sky, swelling, thinning and drifting downwind.
// They are born above the flame, never down in the fire, so nothing floats in front of or behind
// it. Each puff carries the first name of a friend who is going, in answer order (home passes
// `people`); with nobody going yet the puffs rise blank. A friend who RALLIED gets a bigger puff.
// Past MAX_PUFFS people the last puff reads "+N". Puffs are born one at a time from the moment you
// light it (nothing pops in mid-sky); mounting into an already lit beacon shows the column already
// standing. Everything here is behind the friend tiles: tiles are priority and always read over
// the smoke.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Ellipse, G } from 'react-native-svg';
import { Canvas, Rect as SkRect, Shader } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';
import type { ScenePerson } from './BeaconsScene';
import { smokeArt } from './paintedArt';
import { PaintedBackdrop, paintedLayout } from './PaintedBackdrop';

const AnimatedG = Animated.createAnimatedComponent(G);

const MIN_PUFFS = 5;
const MAX_PUFFS = 8;
/** Seconds for one puff to climb from the flame tip to the top of the sky. */
const RISE_S = 30;
const MAX_LABEL = 12;
/** Puff radius (px) when it leaves the flame and when it reaches the top. */
const R0 = 13;
const R1 = 78;
const INK = '#3A2418';
// Name box, laid out at full size and scaled with the puff.
const LW = 150;
const LH = 30;

// One puff of smoke in a square: a ball of domain-warped noise with a ragged billowing edge, lit
// from the upper left by the desert sun and warm-grey underneath. u_age 0..1 opens it up (softer,
// more torn) as it climbs.
const PUFF_SKSL = `
uniform vec2 u_c;
uniform float u_r;
uniform float u_time;
uniform float u_seed;
uniform float u_alpha;
uniform float u_age;

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i); float b = hash(i + vec2(1.0, 0.0)); float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0; float amp = 0.5; for (int i = 0; i < 4; i++){ v += amp * vnoise(p); p *= 2.03; amp *= 0.5; } return v; }

float dens(vec2 p, float t){
  vec2 q = p * 1.7 + vec2(u_seed * 7.3, u_seed * 3.1 + t);
  float w = fbm(q + 1.6 * fbm(q * 0.8 - vec2(0.0, t * 0.6)));
  float r = length(p * vec2(0.86, 1.0));
  float edge = 0.60 + (w - 0.5) * (0.75 + 0.35 * u_age);
  float soft = 0.26 + 0.22 * u_age;
  return (1.0 - smoothstep(edge - soft, edge + soft * 0.6, r)) * (0.72 + 0.56 * w);
}

half4 main(vec2 fc){
  vec2 p = (fc - u_c) / u_r;
  float t = u_time * 0.16;
  float d = dens(p, t);
  if (d <= 0.002) return half4(0.0);
  // light: how much smoke lies between here and the sun (up and to the left)
  float toward = dens(p + vec2(-0.16, -0.20), t);
  float lit = clamp(0.62 + (d - toward) * 1.5 - p.y * 0.16, 0.0, 1.0);
  vec3 shadow = vec3(0.50, 0.44, 0.43);
  vec3 sun = vec3(0.98, 0.95, 0.90);
  vec3 col = mix(shadow, sun, lit);
  float a = clamp(d * 1.25, 0.0, 1.0) * u_alpha;
  return half4(col * a, a);
}`;
const puffEffect = makeShaderEffect(PUFF_SKSL, 'SmokeSignalScene');

function firstName(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || '';
  return first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first;
}

/** Where puff j of n is right now: centre, radius, opacity, age 0..1. */
function puffAt(
  t: number, litAt: number, on: number, j: number, n: number,
  x0: number, y0: number, W: number, rally: boolean, still: boolean
) {
  'worklet';
  // q = this puff's age in whole climbs since you lit the fire; it is born at q = 0, so puffs
  // leave the flame one at a time, a slot apart.
  const q = still ? (j + 0.5) / n : (t - litAt) / RISE_S - j / n;
  if (q < 0) return { x: x0, y: y0, r: R0, a: 0, p: 0 };
  const p = q - Math.floor(q);
  const r = (R0 + (R1 - R0) * Math.pow(p, 0.75)) * (rally ? 1.22 : 1);
  const y = y0 - p * (y0 + R1 * 1.3);
  const x = x0 + p * W * 0.12 + Math.sin(p * 7.4 + j * 1.9) * W * 0.06 * p;
  const fadeIn = p < 0.04 ? p / 0.04 : 1;
  const fadeOut = p > 0.8 ? (1 - p) / 0.2 : 1;
  return { x, y, r, a: on * fadeIn * fadeOut * (1 - 0.3 * p), p };
}

type PuffProps = {
  clock: SharedValue<number>;
  litAt: SharedValue<number>;
  on: SharedValue<number>;
  /** this puff's slot and how many there are */
  j: number;
  n: number;
  /** where puffs are born (the tip of the flame) */
  x0: number;
  y0: number;
  W: number;
  rally: boolean;
  still: boolean;
};

/** The smoke itself. Render inside the Skia <Canvas>. */
function PuffSmoke({ clock, litAt, on, j, n, x0, y0, W, rally, still }: PuffProps) {
  const s = useDerivedValue(() => puffAt(clock.value, litAt.value, on.value, j, n, x0, y0, W, rally, still), [j, n, x0, y0, W, rally, still]);
  const bx = useDerivedValue(() => s.value.x - s.value.r * 1.45);
  const by = useDerivedValue(() => s.value.y - s.value.r * 1.45);
  const bs = useDerivedValue(() => s.value.r * 2.9);
  const uniforms = useDerivedValue(() => ({
    u_c: [s.value.x, s.value.y],
    u_r: s.value.r,
    u_time: clock.value,
    u_seed: j * 1.37 + 0.5,
    u_alpha: s.value.a,
    u_age: s.value.p,
  }), [j]);
  if (!puffEffect) return null;
  return (
    <SkRect x={bx} y={by} width={bs} height={bs}>
      <Shader source={puffEffect} uniforms={uniforms} />
    </SkRect>
  );
}

/** The name riding a puff. */
function PuffName({ clock, litAt, on, j, n, x0, y0, W, rally, still, label }: PuffProps & { label: string }) {
  const style = useAnimatedStyle(() => {
    const s = puffAt(clock.value, litAt.value, on.value, j, n, x0, y0, W, rally, still);
    // the name only reads once the puff is big enough to hold it
    const show = Math.min(1, Math.max(0, (s.p - 0.1) / 0.1));
    return {
      opacity: s.a * show,
      transform: [{ translateX: s.x - LW / 2 }, { translateY: s.y - LH / 2 }, { scale: s.r / R1 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.name, style]}>
      <Text numberOfLines={1} style={styles.nameText}>{label}</Text>
    </Animated.View>
  );
}

export type SmokeSignalSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
  /** The friends going, in answer order: each rides a puff by name. */
  people?: ScenePerson[];
};

export default function SmokeSignalScene({ skin, active, focused = true, anchorX, anchorY, measured = false, people = [] }: SmokeSignalSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const L = paintedLayout(smokeArt, skin, W, H, anchorX, anchorY, measured);

  // Puffs leave the tip of the flame (the flame stands 170 * flameScale px above its seat).
  const tipY = L.seatY - 170 * skin.flameScale * 0.92;

  const n = Math.min(MAX_PUFFS, Math.max(MIN_PUFFS, people.length));
  const labels: string[] = [];
  const rallies: boolean[] = [];
  for (let j = 0; j < MAX_PUFFS; j++) {
    const over = people.length > n && j === n - 1;
    labels.push(j >= n || j >= people.length ? '' : over ? `+${people.length - (n - 1)}` : firstName(people[j].name));
    rallies.push(j < n && j < people.length && !over && people[j].rally === true);
  }

  const { clock } = useGatedClock(focused && !reduce && active);

  // `on` fades the whole column in and out; `litAt` is the clock reading when you lit the fire, so
  // puffs are born from that moment. Mounting into a lit beacon starts far in the past: the column
  // is already standing.
  const on = useSharedValue(active ? 1 : 0);
  const litAt = useSharedValue(-1000 * RISE_S);
  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    cancelAnimation(on);
    if (active) {
      if (!was) litAt.value = clock.value;
      on.value = reduce ? 1 : withTiming(1, { duration: 500 });
    } else {
      on.value = reduce ? 0 : withTiming(0, { duration: 1400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(on); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const glowProps = useAnimatedProps(() => ({ opacity: on.value }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: smokeArt.floor }]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <RadialGradient id="ssGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.4} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <PaintedBackdrop art={smokeArt} layout={L} W={W} H={H} />
        {/* a little warmth on the rock around the fire while it burns (it is daylight) */}
        <AnimatedG animatedProps={glowProps}>
          <Ellipse cx={L.ax} cy={L.footY - 8} rx={130} ry={42} fill="url(#ssGlow)" />
        </AnimatedG>
      </Svg>

      {/* the smoke: one puff per slot, leaving the tip of the flame */}
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: n }, (_, j) => (
          <PuffSmoke key={`ssP${j}`} clock={clock} litAt={litAt} on={on} j={j} n={n} x0={L.ax} y0={tipY} W={W} rally={rallies[j]} still={!!reduce} />
        ))}
      </Canvas>
      {labels.map((label, j) =>
        j < n && label ? (
          <PuffName key={`ssN${j}`} clock={clock} litAt={litAt} on={on} j={j} n={n} x0={L.ax} y0={tipY} W={W} rally={rallies[j]} still={!!reduce} label={label} />
        ) : null
      )}

      {/* Legibility scrim: the sky is bright, so the top (status/tiles) and bottom (buttons) are
          darkened a little more than on the night skins. */}
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="ssScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0B2A33" stopOpacity={0.55} />
            <Stop offset="24%" stopColor="#0B2A33" stopOpacity={0} />
            <Stop offset="76%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.6} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#ssScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  name: { position: 'absolute', left: 0, top: 0, width: LW, height: LH, alignItems: 'center', justifyContent: 'center' },
  nameText: { color: INK, fontSize: 24, fontWeight: '800', textAlign: 'center' },
});
