// components/scenes/StormScene.tsx
// The STORM CALLER backdrop (behind all tiles): a brooding moor under a rolling storm deck,
// rendered by one Skia shader (the AuroraScene pattern: in-shader scrim, static SVG fallback).
// SKY (top ~0.58H): domain-warped FBM storm clouds churning slowly on a drift clock that runs
// even unlit (focused && !reduce), near-black grey with a faint green-blue storm tint, a ragged
// lower cloud base over a slightly lighter horizon slot. GROUND (below ~0.62H): a dark moor
// rising to a knoll under the structure (the ground line meets structureBottom), wet puddle
// glints, two gaunt leaning tree silhouettes far off to the left.
// SHEET LIGHTNING (the idle payoff; research: intra-cloud is the most common flash type, the
// cloud glows FROM INSIDE, diffuse, no visible channel): the schedule is a PURE function of a
// second gated clock zeroed on the real lit edge (active && focused && !reduce):
//   slot = floor(t / 9); ~70% of slots flash (hash gate); start = slot * 9 + 2 + 5 * hash;
//   each flash = 2-3 fast strobe sub-pulses over 150-350ms (exp decays), a diffuse pool INSIDE
//   the clouds at a hashed x and hashed size, pale blue-white, rarely warm (a distant flash).
// The c < 0 style guard (u_storm > 0, slot >= 0, u_lit gate) keeps the sky quiet before the lit
// edge; a cold mount while already lit starts the schedule fresh at t = 0 and is correct at any
// later time. UNLIT: the sky just churns. RAIN while lit: a cheap slanted fract-grid streak
// layer over the whole frame (alpha ~0.07), ramping in with u_lit over ~2s after the strike.
// The moor's puddle glints brighten on the SAME schedule value (same shader, free sync).
// LEGIBILITY: the aurora-style scrim is applied INSIDE the shader; flash pools sit mostly above
// the 35% line and their added luminance is attenuated over the 12-62% tile band so the friend
// tiles always read. Reduced motion: static clouds, no flashes, no rain. If the shader fails to
// compile we fall back to a static SVG storm sky (never a blank screen).
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
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';

const STORM_SKSL = `
uniform float u_time;   // drift clock: clouds churn even unlit (paused on blur / reduce)
uniform float u_storm;  // sheet-lightning clock: zeroed at the real lit edge, runs while lit
uniform float u_lit;    // 0..1 lit ramp (rain + flash gate; rain rises ~2s after the strike)
uniform float u_rain;   // 1 = rain streaks allowed, 0 under reduced motion
uniform vec2  u_res;
uniform float u_gy;     // moor line y (px) away from the knoll
uniform float u_ky;     // knoll crest y (px) at u_ax, meeting the structure's rocky base
uniform float u_ax;     // structure center x (px)

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ return vnoise(p) * 0.65 + vnoise(p * 2.3 + 11.7) * 0.35; }

// One strobe sub-pulse: instant on at its offset, fast exp decay (lightning pops, never eases in).
float pulse(float ft, float off, float dec){
  float dt = ft - off;
  return dt < 0.0 ? 0.0 : exp(-dt / dec);
}

// Distance to a segment (the gaunt tree silhouettes).
float segd(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Legibility scrim (aurora precedent): 0.5 black at the top fading out by 22%, 0.58 rising from
// 78% to the bottom. Applied over EVERYTHING, flashes included.
vec3 scrim(vec3 c, float py){
  float a = 0.5 * (1.0 - smoothstep(0.0, 0.22, py)) + 0.58 * smoothstep(0.78, 1.0, py);
  return c * (1.0 - a);
}

half4 main(vec2 uv){
  vec2 p = uv / u_res;
  float t = u_time;

  // ---------- SHEET-LIGHTNING SCHEDULE (pure function of u_storm) ----------
  float strobe = 0.0;  // this frame's strobe brightness (also syncs the puddle glints)
  float poolI = 0.0;   // this fragment's diffuse in-cloud pool weight
  vec3 ltint = vec3(0.80, 0.87, 1.0);
  float sl = floor(u_storm / 9.0);
  if (u_storm > 0.0 && sl >= 0.0 && u_lit > 0.02) {
    if (hash(vec2(sl, 3.7)) < 0.7) {           // ~70% of 9s slots flash
      float fs = sl * 9.0 + 2.0 + 5.0 * hash(vec2(sl + 7.0, 1.3));
      float ft = u_storm - fs;
      if (ft > 0.0 && ft < 0.6) {
        float h2 = hash(vec2(sl, 5.9));
        float h3 = hash(vec2(sl, 8.3));
        // 2-3 strobe sub-pulses over 150-350ms (the third gated off h3)
        strobe = pulse(ft, 0.0, 0.05)
               + 0.65 * pulse(ft, 0.10 + 0.05 * h2, 0.045)
               + 0.5  * pulse(ft, 0.21 + 0.09 * h3, 0.055) * step(0.45, h3);
        strobe = min(strobe, 1.0) * u_lit;
        // the lit pool inside the clouds: hashed x, hashed depth (size), high in the deck
        float cxp = (0.12 + 0.76 * hash(vec2(sl, 2.1))) * u_res.x;
        float cyp = mix(0.07, 0.30, hash(vec2(sl, 6.7))) * u_res.y;
        float rr  = mix(0.16, 0.34, hash(vec2(sl, 4.9))) * u_res.x;
        vec2 pd = (uv - vec2(cxp, cyp)) / rr;
        pd.y *= 2.1;
        poolI = exp(-dot(pd, pd));
        if (hash(vec2(sl, 7.7)) > 0.93) { ltint = vec3(1.0, 0.82, 0.66); } // rare distant warm flash
      }
    }
  }

  // ---------- GROUND LINE (moor rising to the knoll under the structure) ----------
  float kn = exp(-((uv.x - u_ax) * (uv.x - u_ax)) / 22500.0);
  float gy = mix(u_gy, u_ky, kn) + (vnoise(vec2(uv.x * 0.012, 3.7)) - 0.5) * 12.0 * (1.0 - kn);

  vec3 col;
  if (uv.y >= gy) {
    // ---------- THE MOOR ----------
    float gd = clamp((uv.y - gy) / max(u_res.y - gy, 1.0), 0.0, 1.0);
    col = mix(vec3(0.042, 0.054, 0.048), vec3(0.019, 0.026, 0.025), gd);
    col *= 0.86 + 0.28 * vnoise(vec2(uv.x * 0.045, uv.y * 0.07));
    // pale crest edge, catching each sheet flash
    float rim = 1.0 - smoothstep(0.0, 7.0, uv.y - gy);
    col += vec3(0.065, 0.085, 0.095) * rim * (0.35 + 1.1 * strobe);
    // wet-ground puddle glints, brightening on the same flash schedule (free sync)
    vec2 pg = vec2(uv.x / 46.0, uv.y / 16.0);
    float phh = hash(floor(pg));
    vec2 pf = fract(pg) - 0.5;
    pf.y *= 3.0;
    float glint = exp(-dot(pf, pf) * 9.0) * step(0.84, phh);
    col += vec3(0.55, 0.62, 0.72) * glint * (0.05 + 0.6 * strobe);
  } else {
    // ---------- THE STORM DECK ----------
    vec2 sp = vec2(p.x * 2.6, p.y * 3.4);
    vec2 q = vec2(fbm(sp + vec2(t * 0.016, 0.0)), fbm(sp + vec2(4.7, 2.3) - vec2(t * 0.012, t * 0.008)));
    float cl = fbm(sp * 1.35 + q * 0.9 + vec2(t * 0.008, -t * 0.004));
    col = mix(vec3(0.026, 0.031, 0.036), vec3(0.082, 0.096, 0.101), cl);
    col += vec3(0.008, 0.028, 0.026) * cl;   // faint green-blue storm tint in the dense folds
    // ragged lower cloud base against a slightly lighter horizon slot
    float cb = (0.47 + 0.07 * (vnoise(vec2(p.x * 4.2 + q.x * 1.4, 1.7)) - 0.5) * 2.0) * u_res.y;
    float slotb = smoothstep(cb, cb + 44.0, uv.y);
    col = mix(col, vec3(0.096, 0.118, 0.124), slotb * 0.85);
    // sheet lightning: the cloud glows FROM INSIDE (diffuse, denser cloud scatters more light);
    // added luminance is attenuated over the 12-62% tile band so tiles read through the strobe
    vec3 add = ltint * poolI * strobe * (0.35 + 0.75 * cl);
    float band = smoothstep(0.12, 0.20, p.y) * (1.0 - smoothstep(0.55, 0.62, p.y));
    add *= mix(1.0, 0.42, band);
    col += add;
  }

  // ---------- GAUNT TREES (two leaning silhouettes far left; cheap box guard) ----------
  if (uv.x < 0.30 * u_res.x && uv.y > gy - 0.16 * u_res.y && uv.y < gy + 6.0) {
    float td = 9999.0;
    vec2 b1 = vec2(0.14 * u_res.x, gy + 2.0);
    vec2 t1 = b1 + vec2(-0.020 * u_res.x, -0.115 * u_res.y);
    td = min(td, segd(uv, b1, t1) - mix(1.8, 0.5, clamp((b1.y - uv.y) / (0.115 * u_res.y), 0.0, 1.0)));
    td = min(td, segd(uv, mix(b1, t1, 0.55), mix(b1, t1, 0.55) + vec2(0.035 * u_res.x, -0.035 * u_res.y)) - 0.6);
    td = min(td, segd(uv, mix(b1, t1, 0.8), mix(b1, t1, 0.8) + vec2(-0.03 * u_res.x, -0.02 * u_res.y)) - 0.5);
    vec2 b2 = vec2(0.225 * u_res.x, gy + 2.0);
    vec2 t2 = b2 + vec2(0.014 * u_res.x, -0.085 * u_res.y);
    td = min(td, segd(uv, b2, t2) - mix(1.4, 0.4, clamp((b2.y - uv.y) / (0.085 * u_res.y), 0.0, 1.0)));
    td = min(td, segd(uv, mix(b2, t2, 0.6), mix(b2, t2, 0.6) + vec2(-0.03 * u_res.x, -0.03 * u_res.y)) - 0.5);
    float tsil = 1.0 - smoothstep(0.0, 1.5, td);
    col = mix(col, vec3(0.012, 0.016, 0.018), tsil);
  }

  // ---------- RAIN (lit only; rides u_lit's ~2s post-strike ramp; off under reduce) ----------
  if (u_rain > 0.5 && u_lit > 0.02) {
    float rx = uv.x + uv.y * 0.22;                       // wind slant
    vec2 rc = vec2(rx / 7.0, (uv.y - t * 620.0) / 30.0); // pattern shifts +y over time: rain falls DOWN
    float rh = hash(floor(rc));
    vec2 rf = fract(rc);
    float lx = 0.25 + 0.5 * fract(rh * 9.7);
    float streak = step(0.78, rh)
                 * (1.0 - smoothstep(0.02, 0.10, abs(rf.x - lx)))
                 * smoothstep(0.0, 0.25, rf.y) * (1.0 - smoothstep(0.72, 1.0, rf.y));
    col += vec3(0.62, 0.70, 0.80) * streak * 0.07 * u_lit;
  }

  return half4(scrim(col, p.y), 1.0);
}
`;

const effect = makeShaderEffect(STORM_SKSL, 'StormScene');

// Knoll crest sits this many px above structureBottom (the structure's own rocky knoll art
// covers viewBox y ~84..97, so the scene's crest tucks under it); the flat moor line sits just
// below structureBottom.
const KNOLL_ABOVE_BASE = 16;
const MOOR_BELOW_BASE = 6;

export type StormSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function StormScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: StormSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Drift clock: the storm deck churns whether the altar is lit or not (paused off-tab/reduce).
  const { clock: drift } = useGatedClock(focused && !reduce);
  // Sheet-lightning clock: only advances while lit + focused; zeroed on the REAL lit edge below,
  // so the schedule (a pure function of this clock) restarts at the tap. A cold mount while
  // already lit simply starts it at 0, which the pure schedule renders correctly at any time.
  const { clock: storm } = useGatedClock(active && focused && !reduce);

  // Lit ramp: rain (and the flash gate) rise ~2s after the strike lands (the bolt attaches at
  // 0.58s, so the ramp starts at 650ms); initialized to the end state so a mount while already
  // lit shows the settled storm with no replay. Extinguish drains over 700ms; reduce snaps.
  const lit = useSharedValue(active ? 1 : 0);
  const prevActive = useRef(active);
  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    cancelAnimation(lit);
    if (active && !was) storm.value = 0; // the sheet-lightning schedule re-anchors at the tap
    if (reduce) {
      lit.value = active ? 1 : 0;
      return;
    }
    if (active) {
      if (!was && lit.value < 0.99) lit.value = withDelay(650, withTiming(1, { duration: 2000 }));
      else lit.value = 1;
    } else {
      lit.value = withTiming(0, { duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry: the moor line + knoll crest track the structure box when measured.
  // structureBottom = anchorY + (1 - origin) * 180 (the anchor is the rod TIP, origin 0.14).
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = measured && anchorY != null ? anchorY + (1 - skin.origin) * 180 : H * 0.7;
  const gy = Math.min(Math.max(structureBottom + MOOR_BELOW_BASE, H * 0.62), H * 0.86);
  const ky = Math.max(Math.min(structureBottom - KNOLL_ABOVE_BASE, gy - 10), H * 0.5);

  const uniforms = useDerivedValue(
    () => ({
      u_time: drift.value,
      u_storm: storm.value,
      u_lit: lit.value,
      u_rain: reduce ? 0 : 1,
      u_res: [W, H],
      u_gy: gy,
      u_ky: ky,
      u_ax: seatX,
    }),
    [W, H, gy, ky, seatX, reduce]
  );

  // Compile-failure fallback: a static SVG storm (gradient deck, lighter horizon slot, dark
  // moor, scrim), plus a faint cool wash in the cloud band while lit. Never a blank screen.
  if (!effect) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <LinearGradient id="stSky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#07090D" /><Stop offset="100%" stopColor="#12171A" />
            </LinearGradient>
            <LinearGradient id="stWash" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#9FB6D8" stopOpacity={0} />
              <Stop offset="45%" stopColor="#9FB6D8" stopOpacity={0.1} />
              <Stop offset="100%" stopColor="#9FB6D8" stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="stScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
              <Stop offset="22%" stopColor="#000" stopOpacity={0} />
              <Stop offset="78%" stopColor="#000" stopOpacity={0} />
              <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={gy} fill="url(#stSky)" />
          <Rect x={0} y={Math.max(gy - 60, 0)} width={W} height={60} fill="#161C1F" />
          {active ? <Rect x={0} y={H * 0.05} width={W} height={H * 0.35} fill="url(#stWash)" /> : null}
          <Rect x={0} y={gy} width={W} height={H - gy} fill="#0A0D0C" />
          <Rect x={0} y={0} width={W} height={H} fill="url(#stScrim)" />
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
  base: { backgroundColor: '#06080B' },
});
