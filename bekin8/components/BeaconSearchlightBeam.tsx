// components/BeaconSearchlightBeam.tsx
// The PREMIERE SEARCHLIGHT's shaft, a full-screen Skia shader in the FIRE slot (in front of the
// tiles, so it stays TIGHT and modest). One rigid rod of carbon-arc light from the lens anchor
// (anchorX, anchorY = the structure's viewBox (50, 30)): a 0.05 rad core with a soft 2.5x halo,
// widening only slightly with distance (a premiere shaft, tighter than the lighthouse's 0.085),
// colored by skin.glow.center (blue-white #EAF4FF). The shaft FADES OUT as it enters the cloud
// band (u_cloudY = 0.26 * H, the same CLOUD_FRAC as SearchlightScene's canvas), where the scene's
// disc takes over: the beam reads as terminating ON the cloud deck. A small ~15px lens bloom sits
// at the anchor (the lighthouse precedent), plus a cheap one-vnoise dust-mote shimmer inside the
// core.
//
// SWEEP CONTRACT (shared by RooftopSearchlight, SearchlightScene, BeaconSearchlightBeam):
//   SWEEP_PERIOD = 22.0 s; sway = sin(2*PI*t/22); shaped = sway^3 (dwells near vertical);
//   theta = 0.62 * shaped (radians off vertical, max ~35.5 deg). t is a gated clock ZEROED on the
//   real unlit-to-lit edge in ALL THREE components; they mount together on a skin switch and pause
//   together on blur, so the barrel, the shaft and the cloud disc stay in lockstep. The beam axis
//   here is straight up rotated by theta.
//
// STRIKE (matches the structure's 1.6s one-shot and the ignite clip): the beam gates in ~450ms
// after the lit edge (the lever throws 0-0.25, the rods sputter 0.25-0.55) with an uneven hash
// flicker for u_time < 0.62, snapping steady at the arc catch. u_strike is 1 only on a REAL
// unlit -> lit edge (prevActive ref): a first mount while already lit skips the whole strike
// (u_time restarts at 0 but the gate stays open). Extinguish: 220ms fade, an arc cuts instantly.
// Reduced motion: a static vertical beam, no sweep, no flicker, no mote motion.
//
// LEGIBILITY: gains sit below the lighthouse beam's (core 0.60-0.68 vs 0.9; alpha capped 0.85)
// and the tight half-angle keeps most of the 12-62% tile band clear of the shaft.
// KNOBS: HALF_ANG / halo multiple + the gain constants in the SkSL; CLOUD_FRAC (must match the
// scene); the strike gate times (0.44 / 0.55 / 0.62) in the SkSL.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';
import { makeShaderEffect } from '../lib/makeShaderEffect';
import { useGatedClock } from '../lib/useGatedClock';

// Must match SearchlightScene's CLOUD_FRAC: the shaft hands off to the scene's disc here.
const CLOUD_FRAC = 0.26;

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0.92, 0.96, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const BEAM_SKSL = `
uniform float u_time;   // SWEEP CONTRACT t: seconds since the real lit edge (gated clock)
uniform float u_lit;    // 0..1 fade
uniform vec2  u_anchor; // lens center px (structure viewBox (50, 30))
uniform float u_len;    // beam reach px
uniform vec3  u_color;  // skin.glow.center
uniform float u_cloudy; // cloud band bottom px (0.26 * H): the shaft fades out entering it
uniform float u_strike; // 1 = real lit edge: play the strike gate; 0 = already-lit mount
uniform float u_static; // 1 = reduced motion: vertical, steady, no flicker

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

half4 main(vec2 fragCoord){
  vec2 d = fragCoord - u_anchor;
  float dist = length(d);
  float ang = atan(d.y, d.x);

  // SWEEP CONTRACT: theta = 0.62 * sin(2*PI*t/22)^3, the axis is straight up rotated by theta.
  float theta = 0.0;
  if (u_static < 0.5){
    float sway = sin(6.2831853 * u_time / 22.0);
    theta = 0.62 * sway * sway * sway;
  }
  float axis = -1.5707963 + theta;
  float ad = abs(atan(sin(ang - axis), cos(ang - axis)));

  // Tight premiere shaft: 0.05 rad core widening slightly with distance, soft 2.5x halo.
  float halfAng = 0.05 + 0.018 * smoothstep(0.0, u_len, dist);
  float core = 1.0 - smoothstep(0.0, halfAng, ad);
  float halo = 1.0 - smoothstep(0.0, halfAng * 2.5, ad);
  float falloff = 1.0 - smoothstep(u_len * 0.2, u_len, dist);
  // hand off to the scene's cloud disc: fade out entering the band
  float cloudFade = smoothstep(u_cloudy - 90.0, u_cloudy + 30.0, fragCoord.y);
  // cheap dust-mote shimmer riding the core (one vnoise along the axis)
  float mote = vnoise(vec2(dist * 0.06 - u_time * 1.5, ad * 55.0));
  float beam = (core * (0.60 + 0.08 * mote) + halo * 0.22) * falloff * cloudFade;

  // STRIKE gate: dark until ~0.45, uneven hash flicker through the sputter, steady from 0.62
  // (pure function of u_time; only a real lit edge arms it via u_strike).
  float gate = 1.0;
  if (u_static < 0.5 && u_strike > 0.5 && u_time < 0.62){
    float on = smoothstep(0.44, 0.50, u_time);
    float fl = 0.25 + 0.75 * step(0.5, hash(vec2(floor(u_time * 36.0), 3.7)));
    gate = on * mix(fl, 1.0, smoothstep(0.55, 0.62, u_time));
  }

  // small steady lens bloom at the anchor (~15px, the lighthouse precedent; never pulses)
  float bloom = exp(-dist * dist / (2.0 * 15.0 * 15.0)) * 0.30;

  float a = clamp((beam + bloom) * gate * u_lit, 0.0, 0.85);
  vec3 col = u_color * (beam * 0.95 + bloom * 1.2) * gate;
  return half4(clamp(col, 0.0, 2.0) * u_lit, a);
}
`;

const effect = makeShaderEffect(BEAM_SKSL, 'BeaconSearchlightBeam');

export type BeaconFireProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconSearchlightBeam({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconFireProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const color = rgb(skin.glow.center);
  const len = Math.hypot(W, H);
  const cloudY = Math.round(H * CLOUD_FRAC);

  // SWEEP CONTRACT clock: gated with the scene's sweep clock and the structure's barrel clock
  // (same condition), zeroed on the real lit edge below, so all three stay in lockstep.
  const { clock } = useGatedClock(active && !reduce && focused);
  const lit = useSharedValue(active ? 1 : 0);
  const [visible, setVisible] = useState(active);
  // u_strike arms the in-shader strike gate ONLY on a real unlit -> lit edge; a first mount while
  // already lit keeps it 0 so no one-shot replays (FireworkRocket rule).
  const [strike, setStrike] = useState(0);
  const prevActive = useRef(active);

  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    if (active) {
      if (!was) {
        clock.value = 0; // the lit edge zeroes the shared sweep t
        setStrike(1);
      }
      setVisible(true);
      return;
    }
    // Keep the strike gate ARMED through the 220ms extinguish fade: dropping it immediately while
    // u_time is still inside the sputter window (< 0.62s) would snap the gate to steady and flash
    // the beam ON as it dies. Reset it only once the layer hides; a relight within 400ms clears
    // this timeout and re-runs the lit branch (clock zeroed, strike re-armed) anyway.
    const t = setTimeout(() => { setStrike(0); setVisible(false); }, 400);
    return () => clearTimeout(t);
  }, [active, clock]);

  useEffect(() => {
    cancelAnimation(lit);
    if (reduce) { lit.value = active ? 1 : 0; return; }
    // In: the strike gate holds the shaft dark until ~0.45s anyway. Out: an arc cuts instantly.
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 500 : 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_anchor: [anchorX, anchorY],
      u_len: len,
      u_color: [color[0], color[1], color[2]],
      u_cloudy: cloudY,
      u_strike: strike,
      u_static: reduce ? 1 : 0,
    }),
    [anchorX, anchorY, len, cloudY, strike, reduce, skin.id]
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
