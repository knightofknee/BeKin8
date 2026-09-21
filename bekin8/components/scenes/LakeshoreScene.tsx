// components/scenes/LakeshoreScene.tsx
// The LAKESHORE backdrop (the DEFAULT skin), behind all tiles: a still lake at nightfall rendered
// by a single Skia shader. Unlit: a dark mirror of water under a deep dusk sky, cell-hashed stars,
// a small moon with its glint column, a pine treeline across the water, drifting mist, and a quiet
// shingle beach where the driftwood pyre waits. Lit, the scene acts out the app's promise in three
// beats:
//   1. firelight blooms on the near water (warm dancing ripples spreading from the shore),
//   2. ~3s in, the FAR BANK ANSWERS: a tiny fire kindles at the treeline with its own thin glint,
//   3. then lantern-lit canoes push off from the far water and CROSS THE LAKE to your shore, one
//      by one over the next few minutes, beaching beside your fire and staying. The longer your
//      beacon burns, the more lights gather at your shore. Extinguishing fades it all back.
// The crossing is driven by u_lt (seconds since the lit edge), so a cold mount into an already-lit
// beacon shows everyone already arrived instead of replaying the show. The legibility scrim (dark
// top and bottom) is applied INSIDE the shader so tiles and buttons stay readable; the mid band
// stays dark water with sparse low-alpha glints, lighthouse-style. Reduced motion: frozen water,
// snapped ramps, arrivals settled. If the shader fails to compile we fall back to a static SVG
// dusk-lake gradient (never a blank screen).
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  withDelay,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';

const LAKE_SKSL = `
uniform float u_time;    // seconds, scene clock
uniform float u_lit;     // 0..1 lit ramp (fades firelight, the answer, and the canoes)
uniform float u_lt;      // seconds since the lit edge (0 unlit; SETTLED on a cold lit mount)
uniform vec2  u_res;
uniform float u_horizon; // far waterline y (px)
uniform float u_shore;   // near waterline y (px), anchored to the pyre's beach
uniform float u_ax;      // fire x (px)
uniform vec2  u_moon;    // moon center (px)

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Legibility scrim over everything: dark at the very top (header) and bottom (controls), the
// middle band left clear for the friend tiles.
vec3 scrim(vec3 c, float py){
  float a = 0.48 * (1.0 - smoothstep(0.0, 0.22, py)) + 0.55 * smoothstep(0.78, 1.0, py);
  return c * (1.0 - a);
}

half4 main(vec2 uv){
  float W = u_res.x;
  vec2 p = uv / u_res;
  float t = u_time;

  // Silhouette lines across the water: a soft far ridge, then the pine treeline at the waterline.
  float ridgeTop = u_horizon - 26.0 - 34.0 * vnoise(vec2(uv.x * 0.006, 1.1));
  float treeH = 10.0 + 24.0 * (0.55 * vnoise(vec2(uv.x * 0.020, 3.7)) + 0.45 * vnoise(vec2(uv.x * 0.055, 9.2)));
  float treeTop = u_horizon - treeH;

  vec3 col;
  if (uv.y < ridgeTop) {
    // ---------- SKY ----------
    float sy = clamp(uv.y / max(u_horizon, 1.0), 0.0, 1.0);
    col = mix(vec3(0.016, 0.028, 0.055), vec3(0.075, 0.110, 0.180), sy);
    // last of the dusk hugging the horizon; night falls as the fire takes over
    col += vec3(0.45, 0.26, 0.16) * exp(-(1.0 - sy) * 5.5) * (1.0 - 0.6 * u_lit) * 0.5;
    // stars: crisp cell-hashed twinkle, thinning toward the horizon glow
    vec2 sg = uv / 40.0;
    float h = hash(floor(sg));
    vec2 spos = 0.15 + 0.7 * vec2(fract(h * 7.31), fract(h * 13.77));
    float ds = length(fract(sg) - spos);
    float tw = 0.62 + 0.38 * sin(t * (0.6 + h * 1.5) + h * 6.28);
    col += vec3(0.85, 0.90, 1.0) * exp(-ds * ds * 320.0) * step(0.76, h) * tw * (0.35 + 0.65 * (1.0 - sy)) * 0.8;
    // small high moon
    float md = length(uv - u_moon);
    col += vec3(0.98, 0.99, 0.92) * exp(-md * md / (2.0 * 22.0 * 22.0)) * 0.55;
    col = mix(col, vec3(0.97, 0.98, 0.94), 1.0 - smoothstep(9.0, 11.5, md));
  } else if (uv.y < treeTop) {
    // ---------- FAR RIDGE ----------
    col = vec3(0.045, 0.065, 0.105);
    col += vec3(0.10, 0.13, 0.19) * exp(-(uv.y - ridgeTop) * 0.12) * 0.5;
  } else if (uv.y < u_horizon) {
    // ---------- TREELINE ----------
    col = vec3(0.012, 0.022, 0.038);
    col += vec3(0.07, 0.10, 0.15) * exp(-(uv.y - treeTop) * 0.30) * 0.6;
  } else if (uv.y < u_shore) {
    // ---------- WATER ----------
    float depth = clamp((uv.y - u_horizon) / max(u_shore - u_horizon, 1.0), 0.0, 1.0);
    float scaleX = mix(0.045, 0.012, depth);
    float sp = mix(0.9, 0.35, depth);
    float warp = (vnoise(vec2(uv.x * 0.005, uv.y * 0.010 - t * 0.18)) - 0.5) * 1.6;
    float w = sin(uv.x * scaleX + t * sp + warp) * 0.5
            + sin(uv.x * scaleX * 2.1 - t * sp * 1.2 + warp * 0.6) * 0.3;
    float band = sin((uv.y - u_horizon) * mix(0.45, 0.07, depth) - t * 1.1 + w * 1.5);
    band += (vnoise(vec2(uv.x * 0.035, (uv.y - u_horizon) * 0.05 - t * 0.8)) - 0.5) * 0.45;
    col = mix(vec3(0.055, 0.090, 0.150), vec3(0.015, 0.030, 0.060), depth);
    col += vec3(0.30, 0.42, 0.56) * smoothstep(0.55, 1.0, band) * (0.10 + 0.20 * depth);
    // moon-glint column (cool, slim: it's a lake, not a sea)
    float gx = abs(uv.x - u_moon.x);
    float gm = exp(-gx * gx / (2.0 * pow(mix(9.0, 60.0, depth), 2.0)));
    col += vec3(0.95, 0.96, 0.88) * gm * smoothstep(0.5, 1.0, band) * (0.35 + 0.65 * depth) * 0.5;
    // firelight while lit: warm dancing ripples spreading up from the near shore
    float fdx = uv.x - u_ax;
    float fl = 0.78 + 0.22 * vnoise(vec2(t * 1.7, 4.2));
    float nearW = exp(-(u_shore - uv.y) / 70.0);
    float wash = exp(-fdx * fdx / (2.0 * 130.0 * 130.0));
    col += vec3(1.0, 0.55, 0.20) * u_lit * fl * nearW * wash * (0.10 + 0.28 * smoothstep(0.5, 1.0, band));
    // slow mist drifting over the middle of the lake
    float mist = vnoise(vec2(uv.x * 0.004 - t * 0.010, uv.y * 0.05)) * vnoise(vec2(uv.x * 0.010 + t * 0.006, 2.2));
    float mband = exp(-pow((depth - 0.35) / 0.28, 2.0));
    col = mix(col, vec3(0.55, 0.63, 0.75), smoothstep(0.5, 0.95, mist) * mband * 0.10);
  } else {
    // ---------- SHINGLE BEACH the pyre stands on ----------
    float bd = clamp((uv.y - u_shore) / max(u_res.y - u_shore, 1.0), 0.0, 1.0);
    float g = vnoise(vec2(uv.x * 0.18, uv.y * 0.18));
    col = mix(vec3(0.055, 0.065, 0.085), vec3(0.028, 0.033, 0.045), bd) * (0.9 + 0.2 * g);
    // wet sheen at the water's edge with a soft lapping wobble
    float lap = 2.0 * sin(uv.x * 0.05 + t * 0.7) + 1.4 * sin(uv.x * 0.11 - t * 0.5);
    col += vec3(0.16, 0.20, 0.26) * (1.0 - smoothstep(0.0, 5.0 + lap, uv.y - u_shore)) * 0.8;
    col += vec3(0.9, 0.95, 1.0) * (1.0 - smoothstep(0.0, 1.8 + lap * 0.4, uv.y - u_shore)) * 0.10;
    // warm firelight pooling on the shingle around the pyre while lit (flat, low alpha)
    vec2 pd = vec2((uv.x - u_ax) / 110.0, (uv.y - (u_shore + 34.0)) / 60.0);
    float flp = 0.8 + 0.2 * vnoise(vec2(t * 1.6, 8.8));
    col += vec3(1.0, 0.52, 0.20) * exp(-dot(pd, pd)) * u_lit * flp * 0.13;
  }

  // ---------- THE FAR BANK ANSWERS (beat 2, ~3s after lighting) ----------
  float ans = smoothstep(2.6, 4.4, u_lt) * u_lit;
  if (ans > 0.001) {
    vec2 fp = vec2(W * 0.30, u_horizon - 3.0);
    float ffl = 0.7 + 0.3 * vnoise(vec2(t * 2.3, 17.0));
    float fd2 = dot(uv - fp, uv - fp);
    col += vec3(1.0, 0.62, 0.25) * exp(-fd2 / (2.0 * 2.6 * 2.6)) * 1.2 * ans * ffl;   // the fire itself
    col += vec3(1.0, 0.45, 0.15) * exp(-fd2 / (2.0 * 10.0 * 10.0)) * 0.25 * ans * ffl; // halo on the trees
    if (uv.y >= u_horizon && uv.y < u_shore) {
      float depth = clamp((uv.y - u_horizon) / max(u_shore - u_horizon, 1.0), 0.0, 1.0);
      float adx = abs(uv.x - fp.x);
      float am = exp(-adx * adx / (2.0 * pow(mix(2.5, 26.0, depth), 2.0)));
      float ab = 0.6 + 0.4 * vnoise(vec2(uv.x * 0.05, uv.y * 0.08 - t * 0.9));
      col += vec3(1.0, 0.55, 0.22) * am * ab * 0.35 * (1.0 - depth * 0.55) * ans * ffl;
    }
  }

  // ---------- LANTERN CANOES CROSSING TO YOUR SHORE (beat 3) ----------
  // Each pushes off the far water on its own schedule, glides the crossing over ~1.5min, then
  // beaches at the waterline beside your fire and STAYS: arrivals accumulate while the beacon
  // burns. Driven by u_lt so nothing here loops or replays.
  if (u_lit > 0.003) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float dep = 6.0 + 52.0 * fi + 9.0 * hash(vec2(fi, 3.3));
      float dur = 78.0 + 22.0 * hash(vec2(fi, 5.1));
      float pr = clamp((u_lt - dep) / dur, 0.0, 1.0);
      if (pr > 0.0) {
        float pe = pr * pr * (3.0 - 2.0 * pr);
        float xs = (i == 0) ? W * 0.62 : (i == 1) ? W * 0.20 : W * 0.80;
        float xe = u_ax + ((i == 0) ? -78.0 : (i == 1) ? 86.0 : -124.0);
        float cy = mix(u_horizon + 8.0, u_shore - 3.0, pow(pe, 1.45));
        float depthC = clamp((cy - u_horizon) / max(u_shore - u_horizon, 1.0), 0.0, 1.0);
        float s = mix(0.45, 1.25, depthC);
        float bob = (pr < 1.0) ? sin(t * 0.5 + fi * 2.4) * 2.0 * s : 0.0;  // still once beached
        float cx = mix(xs, xe, pe) + bob;
        float aIn = smoothstep(0.0, 0.05, pr) * u_lit;
        float lfl = 0.8 + 0.2 * vnoise(vec2(t * 2.6, fi * 9.1));
        // the lantern at the bow
        vec2 ld = uv - vec2(cx, cy - 4.0 * s);
        float ld2 = dot(ld, ld);
        col += vec3(1.0, 0.72, 0.35) * exp(-ld2 / (2.0 * pow(1.9 * s, 2.0))) * 1.1 * aIn * lfl;
        col += vec3(1.0, 0.55, 0.22) * exp(-ld2 / (2.0 * pow(6.5 * s, 2.0))) * 0.22 * aIn * lfl;
        // hull silhouette on the water
        vec2 hd = vec2((uv.x - cx) / (8.5 * s), (uv.y - cy) / (1.9 * s));
        col = mix(col, vec3(0.008, 0.012, 0.02), clamp(exp(-dot(hd, hd)) * 1.2, 0.0, 1.0) * aIn);
        // its little reflection streak, only over the water
        if (uv.y > cy && uv.y < u_shore + 6.0) {
          float rdx = uv.x - cx;
          float rmask = exp(-rdx * rdx / (2.0 * pow(2.6 * s, 2.0))) * exp(-(uv.y - cy) / (13.0 * s));
          float rb = 0.55 + 0.45 * vnoise(vec2(uv.x * 0.06, uv.y * 0.10 - t * 0.9));
          col += vec3(1.0, 0.60, 0.26) * rmask * rb * 0.30 * aIn * lfl;
        }
      }
    }
  }

  return half4(scrim(col, p.y), 1.0);
}
`;

const effect = makeShaderEffect(LAKE_SKSL, 'LakeshoreScene');

// u_lt value meaning "everyone already arrived": past every canoe's dep + dur. Used for cold lit
// mounts and reduced motion, so the crossing never replays when it shouldn't.
const SETTLED = 400;
// Waterline sits this many px above the structure box's bottom: the pyre stands on the beach with
// the lake beginning just behind its stone ring.
const SHORE_ABOVE_BASE = 60;

export type LakeshoreSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function LakeshoreScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: LakeshoreSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // The water animates whenever this skin is shown (like the lighthouse sea); paused off-tab and
  // under reduced motion by the shared gated clock.
  const { clock } = useGatedClock(focused && !reduce);

  // Lit ramp + crossing clock. Cold mount into an already-lit beacon: ramp up, arrivals SETTLED.
  const lit = useSharedValue(active ? 1 : 0);
  const lt = useSharedValue(active ? SETTLED : 0);
  const firstRef = useRef(true);
  const prevRef = useRef(active);

  useEffect(() => {
    const first = firstRef.current;
    firstRef.current = false;
    const was = prevRef.current;
    prevRef.current = active;
    cancelAnimation(lit);
    cancelAnimation(lt);
    if (reduce) {
      lit.value = active ? 1 : 0;
      lt.value = active ? SETTLED : 0;
      return;
    }
    if (active) {
      lit.value = withTiming(1, { duration: 900 });
      if (first) {
        lt.value = SETTLED;
      } else if (!was) {
        // fresh light: run the crossing clock in real time from the lit edge
        lt.value = 0;
        lt.value = withTiming(SETTLED, { duration: SETTLED * 1000, easing: Easing.linear });
      }
    } else {
      // fade everything out via u_lit first, then zero the crossing clock so a relight starts clean
      lit.value = withTiming(0, { duration: 700 });
      lt.value = withDelay(750, withTiming(0, { duration: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); cancelAnimation(lt); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry: the near waterline tracks the pyre's beach; firelight spreads from the fire's x.
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = measured && anchorY != null ? anchorY - skin.origin * 180 + 180 : H * 0.68 + SHORE_ABOVE_BASE;
  const shoreY = Math.min(Math.max(structureBottom - SHORE_ABOVE_BASE, H * 0.5), H * 0.82);
  const horizonY = H * 0.34;
  const moon: [number, number] = [W * 0.76, H * 0.11];

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_lt: lt.value,
      u_res: [W, H],
      u_horizon: horizonY,
      u_shore: shoreY,
      u_ax: seatX,
      u_moon: [moon[0], moon[1]],
    }),
    [W, H, horizonY, shoreY, seatX]
  );

  // Compile-failure fallback: a static SVG dusk lake (gradient sky, dark water, beach, scrim).
  if (!effect) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <LinearGradient id="lksSky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#050A14" /><Stop offset="100%" stopColor="#20304A" />
            </LinearGradient>
            <LinearGradient id="lksWater" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#0E1726" /><Stop offset="100%" stopColor="#040A12" />
            </LinearGradient>
            <LinearGradient id="lksScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000" stopOpacity={0.48} />
              <Stop offset="22%" stopColor="#000" stopOpacity={0} />
              <Stop offset="78%" stopColor="#000" stopOpacity={0} />
              <Stop offset="100%" stopColor="#000" stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={horizonY} fill="url(#lksSky)" />
          <Rect x={0} y={horizonY} width={W} height={shoreY - horizonY} fill="url(#lksWater)" />
          <Rect x={0} y={shoreY} width={W} height={H - shoreY} fill="#10141C" />
          <Rect x={0} y={0} width={W} height={H} fill="url(#lksScrim)" />
        </Svg>
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
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
  // Opaque dark base so a not-yet-painted Skia frame never shows the screen behind it.
  base: { backgroundColor: '#05070C' },
});
