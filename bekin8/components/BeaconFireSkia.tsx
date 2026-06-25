// components/BeaconFireSkia.tsx
// GPU beacon FIRE (Skia RuntimeEffect), replaces the SVG ogee flame with a single skin-driven SkSL
// shader that draws, in one pass: a warm flickering GLOW halo, a domain-warped volumetric FLAME body
// (skin-colored, height-ramped by the ignition progress), rising EMBER glints, and an ignition BLOOM
// flash. Shake is folded into the origin uniform so the whole fire jolts. Drop-in for BeaconFire
// (same props); the SVG BeaconFire is kept as a fallback (toggle USE_SKIA_FIRE in home). NATIVE (Skia).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  useFrameCallback,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';

// #RRGGBB -> [r,g,b] in 0..1 (shader uniforms). Falls back to mid-grey on a bad value.
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const FIRE_SKSL = `
uniform float u_time;       // seconds
uniform float u_progress;   // 0..1 flame height ramp (ignition + lit)
uniform float u_ignite;     // 0..1 decaying flash pulse on lighting
uniform float u_intensity;  // overall brightness
uniform vec2  u_origin;     // flame base (px), shake folded in
uniform float u_scale;      // flame height (px)
uniform vec3  u_col0;       // hot core
uniform vec3  u_col1;       // mid
uniform vec3  u_col2;       // cool tip
uniform vec3  u_glow;       // halo color

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i); float b = hash(i + vec2(1.0, 0.0)); float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0; float amp = 0.5; for (int i = 0; i < 5; i++){ v += amp * vnoise(p); p *= 2.02; amp *= 0.5; } return v; }

half4 main(vec2 fragCoord){
  vec2 d = fragCoord - u_origin;
  float fh = max(u_scale * u_progress, 1.0);
  float yn = -d.y / fh;                 // 0 at base, 1 near tip (up)
  float halfW = fh * 0.42;
  float xn = d.x / halfW;

  vec3 prem = vec3(0.0);                // additive premultiplied emission
  float a = 0.0;

  // ---- warm GLOW halo (flickers) + ignition bloom pulse ----
  float gd = length(vec2(d.x, d.y * 1.25)) / (fh * 0.9);
  float gflick = 0.82 + 0.18 * vnoise(vec2(u_time * 1.6, 2.0));
  float gcov = (1.0 - smoothstep(0.0, 1.0, gd)) * 0.42 * u_progress * gflick;
  gcov += u_ignite * (1.0 - smoothstep(0.0, 1.5, gd)) * 0.7;
  prem += u_glow * gcov; a += gcov;

  // ---- FLAME body (domain-warped, skin-colored): a rounded TEARDROP, narrow at the very base so it
  //      tucks into the wood, bulges through the lower third, tapers to the tip (no flat "fat bottom"). ----
  if (yn > -0.05 && yn < 1.35) {
    vec2 p = vec2(xn * 1.6, yn * 3.0 - u_time * 2.4);
    float n = fbm(p + fbm(p * 0.6));
    float sway = (n - 0.5) * (0.18 + yn * 0.9);
    float rise = smoothstep(-0.04, 0.20, yn);        // round the base (≈0 wide at the very bottom)
    float fall = 1.0 - smoothstep(0.30, 1.05, yn);   // taper to the tip
    float width = rise * fall * 0.80 + 0.05;
    float dist = abs(xn + sway) / width;
    float body = (1.0 - smoothstep(0.5, 1.0, dist))
               * (1.0 - smoothstep(0.9, 1.32, yn))
               * smoothstep(0.2, 0.65, n + (1.0 - dist) * 0.5);
    body = clamp(body, 0.0, 1.0);
    vec3 fcol = mix(u_col0, u_col1, smoothstep(0.0, 0.4, yn));
    fcol = mix(fcol, u_col2, smoothstep(0.38, 0.95, yn));
    fcol += (1.0 - smoothstep(0.0, 0.55, dist)) * (1.0 - smoothstep(0.0, 0.45, yn)) * 0.6;
    float fcov = body * u_intensity;
    prem += fcol * fcov; a += fcov;
  }

  // ---- rising EMBER glints ----
  for (int i = 0; i < 5; i++){
    float fi = float(i);
    float sp = 0.35 + hash(vec2(fi, 1.7)) * 0.4;
    float ph = fract(u_time * sp + hash(vec2(fi, 4.2)));
    float ex = (hash(vec2(fi, 7.3)) - 0.5) * fh * 0.7 * (0.2 + ph);
    float ey = -fh * (0.55 + ph * 1.1);
    float ed = length(fragCoord - (u_origin + vec2(ex, ey)));
    float e = exp(-ed * ed / (7.0 + ph * 12.0)) * (1.0 - ph) * u_progress;
    prem += u_col1 * e * 1.5; a += e;
  }

  a = clamp(a, 0.0, 1.0);
  return half4(clamp(prem, 0.0, 2.0), a);
}
`;

const effect = Skia.RuntimeEffect.Make(FIRE_SKSL);
if (!effect && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn('BeaconFireSkia: fire shader failed to compile');
}

export type BeaconFireProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconFireSkia({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconFireProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const col0 = rgb(skin.core[0]);
  const col1 = rgb(skin.mid[0]);
  const col2 = rgb(skin.outer[1]);
  const glow = rgb(skin.glow.center);
  const uScale = 170 * skin.flameScale;

  const clock = useSharedValue(0);
  const progress = useSharedValue(active ? 1 : 0);
  const ignite = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  const firstRun = useRef(true);
  const prevActiveRef = useRef(active);
  const [visible, setVisible] = useState(active);

  // Always-registered clock gated internally (reliable across cold/skin mounts; no-ops when unlit).
  const motion = useSharedValue(active && !reduce && focused ? 1 : 0);
  useEffect(() => {
    motion.value = active && !reduce && focused ? 1 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, focused]);
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    if (motion.value === 0) return;
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrameCallback(tick, true);

  // Mount the fire only while lit (+ fade tail) so unlit renders nothing.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 800);
    return () => clearTimeout(t);
  }, [active]);

  // Ignition: spring the flame up, fire a bloom pulse + (skin-gated) shake on a real false→true light.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    const justLit = active && !wasActive && !first;

    if (reduce) {
      progress.value = active ? 1 : 0;
      ignite.value = 0;
      return;
    }
    if (active) {
      if (first) {
        progress.value = 1; // cold mount into an already-lit beacon
      } else if (justLit) {
        progress.value = withSpring(1, { damping: skin.ignition.damping, stiffness: skin.ignition.stiffness, mass: 0.8 });
        ignite.value = withSequence(withTiming(1, { duration: 70 }), withTiming(0, { duration: 620 }));
        if (skin.ignition.shake) {
          shakeX.value = withSequence(
            withTiming(-9, { duration: 45 }), withTiming(8, { duration: 45 }), withTiming(-5, { duration: 45 }),
            withTiming(4, { duration: 45 }), withTiming(-2, { duration: 45 }), withTiming(0, { duration: 50 })
          );
          shakeY.value = withSequence(
            withTiming(7, { duration: 45 }), withTiming(-5, { duration: 45 }), withTiming(3, { duration: 45 }),
            withTiming(-2, { duration: 45 }), withTiming(0, { duration: 50 })
          );
        }
      } else {
        progress.value = withTiming(1, { duration: 220 });
      }
    } else if (!first) {
      progress.value = withTiming(0, { duration: 480 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(
    () => () => {
      cancelAnimation(clock); cancelAnimation(progress); cancelAnimation(ignite);
      cancelAnimation(shakeX); cancelAnimation(shakeY);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_progress: progress.value,
      u_ignite: ignite.value,
      u_intensity: 1.0,
      u_origin: [anchorX + shakeX.value, anchorY + shakeY.value],
      u_scale: uScale,
      u_col0: [col0[0], col0[1], col0[2]],
      u_col1: [col1[0], col1[1], col1[2]],
      u_col2: [col2[0], col2[1], col2[2]],
      u_glow: [glow[0], glow[1], glow[2]],
    }),
    [anchorX, anchorY, uScale, skin.id]
  );

  if (!measured || !visible || !effect) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={[styles.fill, { width: W, height: H }]}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
