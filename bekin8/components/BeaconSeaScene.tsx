// components/BeaconSeaScene.tsx
// The LIGHTHOUSE backdrop (behind all tiles): a moonlit, animated SEA rendered by a single Skia
// shader, night sky + moon + stars above the horizon; below it, perspective swells (summed sines),
// cool moonlight ripple highlights, a shimmering moon-glint column, foam on the crests, and the
// lighthouse BEAM'S reflection sweeping the water in sync with the beam (pulses on each flash, only
// while lit). The sea animates whenever this skin is shown; reduced-motion freezes it.
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue, withTiming, cancelAnimation, useReducedMotion } from 'react-native-reanimated';
import { makeShaderEffect } from '../lib/makeShaderEffect';
import { useGatedClock } from '../lib/useGatedClock';

const SEA_SKSL = `
uniform float u_time;
uniform float u_lit;       // 0..1, gates the beam reflection
uniform vec2  u_res;
uniform float u_horizon;   // sea/sky line (px)
uniform vec2  u_moon;      // moon center px
uniform float u_lhX;       // lighthouse x (reflection center)

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// a star: soft dot with a gentle twinkle that NEVER reaches 0 (0.72..1.0 of peak)
float twpt(vec2 uv, vec2 c, float r, float t){
  float d = length(uv - c);
  return exp(-d * d / (2.0 * r * r)) * (0.72 + 0.28 * sin(t));
}
half4 main(vec2 fragCoord){
  vec2 uv = fragCoord;
  float Hh = u_res.y;
  float horizon = u_horizon;

  // ---------- SKY ----------
  if (uv.y < horizon) {
    float ty = uv.y / max(horizon, 1.0);
    vec3 sky = mix(vec3(0.02, 0.035, 0.09), vec3(0.09, 0.12, 0.22), ty);
    float md = length(uv - u_moon);
    sky += vec3(1.0, 0.97, 0.86) * exp(-md * md / (2.0 * 26.0 * 26.0)) * 0.85;     // moon halo
    sky = mix(sky, vec3(0.99, 0.97, 0.90), 1.0 - smoothstep(12.0, 15.0, md));       // moon disc
    float R = u_res.x; float Ht = u_res.y; float t = u_time * 1.4;
    vec3 sc = vec3(1.0, 0.98, 0.94);   // star color (slightly warm white)
    // CONSTELLATIONS only, no scattered filler, no connecting lines; read the patterns yourself.
    // Orion (left-upper): shoulders, belt of 3, feet
    sky += sc * (twpt(uv, vec2(0.09 * R, 0.09 * Ht), 1.8, t) + twpt(uv, vec2(0.21 * R, 0.10 * Ht), 1.7, t + 1.0)
      + twpt(uv, vec2(0.125 * R, 0.155 * Ht), 1.4, t + 2.0) + twpt(uv, vec2(0.15 * R, 0.163 * Ht), 1.4, t + 3.0) + twpt(uv, vec2(0.175 * R, 0.171 * Ht), 1.4, t + 4.0)
      + twpt(uv, vec2(0.10 * R, 0.235 * Ht), 1.7, t + 1.5) + twpt(uv, vec2(0.205 * R, 0.225 * Ht), 1.6, t + 2.5));
    // Big Dipper (center-upper): bowl + handle
    sky += sc * (twpt(uv, vec2(0.34 * R, 0.12 * Ht), 1.6, t + 0.5) + twpt(uv, vec2(0.40 * R, 0.10 * Ht), 1.6, t + 1.2) + twpt(uv, vec2(0.41 * R, 0.155 * Ht), 1.4, t + 2.2) + twpt(uv, vec2(0.345 * R, 0.165 * Ht), 1.4, t + 3.2)
      + twpt(uv, vec2(0.46 * R, 0.095 * Ht), 1.5, t + 0.8) + twpt(uv, vec2(0.51 * R, 0.105 * Ht), 1.5, t + 1.8) + twpt(uv, vec2(0.55 * R, 0.135 * Ht), 1.7, t + 2.8));
    // Cassiopeia (the W, left-lower)
    sky += sc * (twpt(uv, vec2(0.06 * R, 0.36 * Ht), 1.6, t + 0.3) + twpt(uv, vec2(0.11 * R, 0.31 * Ht), 1.6, t + 1.1) + twpt(uv, vec2(0.16 * R, 0.355 * Ht), 1.5, t + 2.1) + twpt(uv, vec2(0.21 * R, 0.315 * Ht), 1.6, t + 3.1) + twpt(uv, vec2(0.26 * R, 0.37 * Ht), 1.7, t + 0.9));
    // Cygnus (the Northern Cross, center-lower)
    sky += sc * (twpt(uv, vec2(0.50 * R, 0.27 * Ht), 1.7, t + 0.6) + twpt(uv, vec2(0.50 * R, 0.33 * Ht), 1.4, t + 1.6) + twpt(uv, vec2(0.50 * R, 0.39 * Ht), 1.5, t + 2.6) + twpt(uv, vec2(0.44 * R, 0.32 * Ht), 1.4, t + 3.6) + twpt(uv, vec2(0.56 * R, 0.34 * Ht), 1.4, t + 0.4));
    // Lyra (Vega + parallelogram, far upper-right, clear of the moon)
    sky += sc * (twpt(uv, vec2(0.90 * R, 0.08 * Ht), 1.9, t + 1.4) + twpt(uv, vec2(0.88 * R, 0.12 * Ht), 1.3, t + 2.4) + twpt(uv, vec2(0.93 * R, 0.13 * Ht), 1.3, t + 3.4) + twpt(uv, vec2(0.895 * R, 0.165 * Ht), 1.3, t + 0.7) + twpt(uv, vec2(0.945 * R, 0.17 * Ht), 1.3, t + 1.7));
    // Leo (sickle + hindquarters, right-lower)
    sky += sc * (twpt(uv, vec2(0.81 * R, 0.40 * Ht), 1.8, t + 0.2) + twpt(uv, vec2(0.81 * R, 0.345 * Ht), 1.4, t + 1.0) + twpt(uv, vec2(0.835 * R, 0.31 * Ht), 1.4, t + 2.0) + twpt(uv, vec2(0.875 * R, 0.325 * Ht), 1.4, t + 3.0) + twpt(uv, vec2(0.92 * R, 0.355 * Ht), 1.4, t + 0.5) + twpt(uv, vec2(0.95 * R, 0.40 * Ht), 1.6, t + 1.5));
    return half4(sky, 1.0);
  }

  // ---------- SEA ----------
  float depth = clamp((uv.y - horizon) / (Hh - horizon), 0.0, 1.0);   // 0 horizon → 1 near viewer
  float scaleX = mix(0.05, 0.014, depth);
  float sp = mix(1.4, 0.45, depth);
  // noise-warped swell so crests look like water, not regular stripes
  float warp = (vnoise(vec2(uv.x * 0.006, uv.y * 0.012 - u_time * 0.25)) - 0.5) * 2.2;
  float w = sin(uv.x * scaleX + u_time * sp + warp) * 0.5
          + sin(uv.x * scaleX * 2.3 - u_time * sp * 1.25 + warp * 0.7) * 0.28
          + sin(uv.x * scaleX * 0.45 + u_time * sp * 0.6) * 0.42;
  float band = sin((uv.y - horizon) * mix(0.5, 0.085, depth) - u_time * 1.6 + w * 1.7);
  band += (vnoise(vec2(uv.x * 0.04, (uv.y - horizon) * 0.06 - u_time * 1.2)) - 0.5) * 0.5;  // break up stripes

  vec3 col = mix(vec3(0.05, 0.10, 0.17), vec3(0.012, 0.035, 0.075), depth);
  col += vec3(0.42, 0.56, 0.70) * smoothstep(0.5, 1.0, band) * (0.16 + 0.34 * depth);   // ripple highlights

  // moon-glint column under the moon
  float gx = abs(uv.x - u_moon.x);
  float colMask = exp(-gx * gx / (2.0 * pow(mix(14.0, 95.0, depth), 2.0)));
  col += vec3(1.0, 0.96, 0.84) * colMask * smoothstep(0.45, 1.0, band) * (0.4 + 0.6 * depth) * 0.8;

  // foam on the crests (noisy, broken up)
  float crest = smoothstep(0.86, 1.0, band);
  float foam = crest * smoothstep(0.45, 0.8, vnoise(vec2(uv.x * 0.25, uv.y * 0.22 - u_time * 2.5)));
  col += vec3(0.82, 0.87, 0.93) * foam * (0.25 + 0.6 * depth) * 0.6;

  // beam reflection, pulses in sync with the lighthouse beam facing the viewer (only while lit)
  float theta = u_time * 0.8;
  float flash = pow(max(cos(theta), 0.0), 7.0);
  float bx = abs(uv.x - u_lhX);
  float refl = exp(-bx * bx / (2.0 * pow(mix(18.0, 85.0, depth), 2.0))) * smoothstep(0.4, 1.0, band);
  col += vec3(1.0, 0.95, 0.82) * refl * flash * (0.4 + 0.6 * depth) * 1.1 * u_lit;

  // ---------- ROCK the lighthouse stands on (so it's on land, not floating in the sea) ----------
  float rx = uv.x - u_lhX;
  float mound = exp(-rx * rx / (2.0 * pow(u_res.x * 0.17, 2.0)));      // rises to a peak under the tower
  float islandTop = Hh * 0.80 - mound * Hh * 0.20;
  islandTop += (vnoise(vec2(uv.x * 0.05, 7.0)) - 0.5) * 16.0;          // jagged rocky top edge
  if (uv.y > islandTop) {
    float n = vnoise(vec2(uv.x * 0.06, uv.y * 0.06));
    vec3 rock = vec3(0.055 + n * 0.05, 0.05 + n * 0.045, 0.045 + n * 0.04);  // dark wet rock (warm-grey)
    float rim = 1.0 - smoothstep(0.0, 9.0, uv.y - islandTop);                // wet shoreline highlight
    rock += vec3(0.3, 0.36, 0.42) * rim * 0.45;
    return half4(rock, 1.0);
  }

  return half4(col, 1.0);
}
`;

const effect = makeShaderEffect(SEA_SKSL, 'BeaconSeaScene');

export default function BeaconSeaScene({ active, focused = true }: { active: boolean; focused?: boolean }) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Pause the (full-screen) wave shader when off the Home tab or under reduced-motion.
  const { clock } = useGatedClock(!reduce && focused);
  const lit = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 700 : 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const horizon = H * 0.42;
  const moon: [number, number] = [W * 0.7, H * 0.16];
  const lhX = W * 0.5;

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_res: [W, H],
      u_horizon: horizon,
      u_moon: [moon[0], moon[1]],
      u_lhX: lhX,
    }),
    [W, H, horizon, lhX]
  );

  if (!effect) return null;
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
  // Opaque dark base so a not-yet-painted Skia frame never shows the screen behind it (no white flash).
  base: { backgroundColor: '#05070C' },
});
