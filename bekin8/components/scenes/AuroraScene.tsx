// components/scenes/AuroraScene.tsx
// The AURORA backdrop (behind all tiles): an arctic night rendered by a single Skia shader. This
// skin has NO flame layer, the sky itself is the lit payoff. Unlit: deep polar night, cell-hashed
// twinkling stars, a low distant ridge, a cold blue snowfield with faint wind-drift texture, and a
// barely-there teal whisper of aurora as a tease. Lit: ribbons unfurl outward from above the rune
// stone over ~1600ms: three fbm-warped curtains (teal through ice into violet, with a rare magenta
// upper fringe) carrying vertical ray striations, waving slowly; the snowfield picks up a soft
// moving cyan sheen. Extinguishing drains the ribbons over ~900ms. The legibility scrim (dark top
// and bottom) is applied INSIDE the shader, over the aurora, so tiles and buttons stay readable.
// Reduced motion: static mid-intensity aurora when lit, plain sky when not. If the shader fails to
// compile we fall back to a static SVG gradient sky (never a blank screen).
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';

const AURORA_SKSL = `
uniform float u_time;
uniform float u_lit;    // 0..1 aurora ramp (1 = fully unfurled)
uniform float u_tease;  // unlit whisper amplitude (0 under reduced motion)
uniform vec2  u_res;
uniform float u_snow;   // snowfield line (px), aligned to the rune stone's base
uniform float u_ax;     // rune stone x (px): ribbons unfurl outward from above it

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ return vnoise(p) * 0.65 + vnoise(p * 2.3 + 11.7) * 0.35; }

// One aurora curtain: an fbm-warped horizontal band with a hot teal lower edge cooling to violet
// above, times vertical ray striations (x-only noise). Returns color premultiplied by intensity
// in rgb, plain intensity in a.
vec4 curtain(vec2 p, float t, float yc, float amp, float fx, float w, float ph){
  float wob = fbm(vec2(p.x * fx + ph, t * 0.05 + ph * 0.7)) - 0.5;
  float d = (p.y - (yc + wob * amp)) / w;
  float body = exp(-d * d * 0.5);
  float rays = 0.55 + 0.45 * vnoise(vec2(p.x * 26.0 + wob * 7.0, t * 0.12 + ph));
  float a = body * rays;
  vec3 c = mix(vec3(0.216, 1.0, 0.706), vec3(0.184, 0.831, 1.0), smoothstep(-1.2, 0.3, d));
  c = mix(c, vec3(0.482, 0.482, 1.0), smoothstep(0.3, 1.7, d));
  return vec4(c * a, a);
}

// Legibility scrim, applied over EVERYTHING (aurora included): 0.5 black at the top fading out by
// 22%, and 0 at 78% deepening to 0.58 at the bottom.
vec3 scrim(vec3 c, float py){
  float a = 0.5 * (1.0 - smoothstep(0.0, 0.22, py)) + 0.58 * smoothstep(0.78, 1.0, py);
  return c * (1.0 - a);
}

half4 main(vec2 uv){
  vec2 p = uv / u_res;
  float t = u_time;

  // ---------- SNOWFIELD ----------
  if (uv.y >= u_snow) {
    float sd = clamp((uv.y - u_snow) / max(u_res.y - u_snow, 1.0), 0.0, 1.0);
    vec3 snow = mix(vec3(0.086, 0.125, 0.180), vec3(0.050, 0.075, 0.115), sd);
    float dr = vnoise(vec2(uv.x * 0.025 + t * 0.02, uv.y * 0.06));      // faint wind-drift texture
    snow *= 0.92 + 0.18 * dr;
    float rim = 1.0 - smoothstep(0.0, 9.0, uv.y - u_snow);              // pale far edge of the field
    snow += vec3(0.09, 0.13, 0.19) * rim * 0.5;
    float rf = vnoise(vec2(uv.x * 0.012 - t * 0.06, uv.y * 0.03));      // cyan sheen while lit (~0.10)
    snow += vec3(0.15, 0.75, 0.85) * u_lit * (0.04 + 0.11 * rf) * (1.0 - sd * 0.6);
    return half4(scrim(snow, p.y), 1.0);
  }

  // ---------- SKY ----------
  float sy = clamp(uv.y / max(u_snow, 1.0), 0.0, 1.0);
  vec3 col = mix(vec3(0.020, 0.031, 0.059), vec3(0.039, 0.082, 0.141), sy);

  // low distant ridge just above the field, faintly rimmed cyan while the sky burns
  float ridgeTop = u_snow - (0.02 + 0.045 * vnoise(vec2(p.x * 3.1 + 7.0, 2.0))) * u_res.y;
  if (uv.y > ridgeTop) {
    vec3 ridge = vec3(0.031, 0.047, 0.075);
    float rimr = exp(-(uv.y - ridgeTop) * 0.10);
    ridge += vec3(0.10, 0.45, 0.50) * rimr * (0.05 + 0.12 * u_lit);
    return half4(scrim(ridge, p.y), 1.0);
  }

  // aurora: three layered curtains plus a rare magenta upper fringe
  vec4 c1 = curtain(p, t, 0.15, 0.07, 2.1, 0.075, 0.0);
  vec4 c2 = curtain(p, t, 0.24, 0.09, 1.5, 0.100, 4.3);
  vec4 c3 = curtain(p, t, 0.32, 0.05, 2.9, 0.055, 9.1);
  vec3 aurC = c1.rgb + c2.rgb * 0.8 + c3.rgb * 0.55;
  float aurA = c1.a + c2.a * 0.8 + c3.a * 0.55;
  float my = (p.y - 0.12) * 9.0;
  float mag = smoothstep(0.72, 0.85, vnoise(vec2(p.x * 1.3, t * 0.03 + 5.0))) * exp(-my * my);
  aurC += vec3(0.784, 0.42, 1.0) * mag * 0.4;
  aurA += mag * 0.4;

  // confine to the 4%..45% band; the 45..62% tile band stays nearly clean
  float env = smoothstep(0.03, 0.10, p.y) * (1.0 - smoothstep(0.36, 0.46, p.y));
  float axn = u_ax / u_res.x;
  // unfurl outward from above the stone: full width by ~3/4 of the lit ramp, then brightens
  float spread = u_lit * 2.2;
  float unfurl = 1.0 - smoothstep(spread - 0.55, spread, abs(p.x - axn));
  float fx2 = (p.x - axn) * 2.0;
  float focus = 0.8 + 0.35 * exp(-fx2 * fx2);                          // brightest above the stone
  float strength = u_tease * (0.6 + 0.4 * sin(t * 0.11)) + 0.55 * u_lit * unfurl;
  col += aurC * env * strength * focus * 0.7;

  // stars: cell-hashed crisp sparkle, damped where the aurora burns over them
  vec2 sg = uv / 42.0;
  float h = hash(floor(sg));
  vec2 spos = 0.15 + 0.7 * vec2(fract(h * 7.31), fract(h * 13.77));
  float ds = length(fract(sg) - spos);
  float tw = 0.62 + 0.38 * sin(t * (0.7 + h * 1.6) + h * 6.28);
  float star = exp(-ds * ds * 300.0) * step(0.7, h) * tw;
  col += vec3(0.85, 0.92, 1.0) * star * 0.8 * (1.0 - clamp(aurA * env * strength, 0.0, 1.0) * 0.6);

  return half4(scrim(col, p.y), 1.0);
}
`;

const effect = makeShaderEffect(AURORA_SKSL, 'AuroraScene');

// Reduced motion shows a frozen mid-intensity aurora while lit (no ramp, no waving).
const REDUCE_LIT = 0.7;
// Snow horizon sits this many px above the rune stone's base, so the stone stands IN the field.
const SNOW_ABOVE_BASE = 46;

export type AuroraSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function AuroraScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: AuroraSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Scene clock (shared gated clock: registered + paused off-tab or under reduced motion). Not
  // gated on `active`: the star twinkle and the unlit tease breathe whether the stone is lit or not.
  const { clock } = useGatedClock(focused && !reduce);

  // Lit ramp: initialized to the end state so a mount while already lit shows the ribbons up
  // (no ignition replay). Unfurl ~1600ms, drain ~900ms; reduced motion snaps.
  const lit = useSharedValue(active ? (reduce ? REDUCE_LIT : 1) : 0);
  useEffect(() => {
    cancelAnimation(lit);
    if (reduce) { lit.value = active ? REDUCE_LIT : 0; return; }
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 1600 : 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry: the snowfield line tracks the rune stone's base when measured; the ribbons unfurl
  // from above the stone's x. structureTop = anchorY - origin * 180, base = structureTop + 180.
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = measured && anchorY != null ? anchorY - skin.origin * 180 + 180 : H * 0.74 + SNOW_ABOVE_BASE;
  const snowY = Math.min(Math.max(structureBottom - SNOW_ABOVE_BASE, H * 0.58), H * 0.86);

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_tease: reduce ? 0 : 0.06,
      u_res: [W, H],
      u_snow: snowY,
      u_ax: seatX,
    }),
    [W, H, snowY, seatX, reduce]
  );

  // Compile-failure fallback: a static SVG polar sky (gradient + snowfield + scrim), plus a soft
  // teal wash in the aurora band while lit. Never a blank screen.
  if (!effect) {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <LinearGradient id="auSky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#05080F" /><Stop offset="100%" stopColor="#0A1524" />
            </LinearGradient>
            <LinearGradient id="auGlow" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#37FFB4" stopOpacity={0} />
              <Stop offset="45%" stopColor="#2FD4FF" stopOpacity={0.16} />
              <Stop offset="100%" stopColor="#7B7BFF" stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="auScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
              <Stop offset="22%" stopColor="#000" stopOpacity={0} />
              <Stop offset="78%" stopColor="#000" stopOpacity={0} />
              <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={snowY} fill="url(#auSky)" />
          {active ? <Rect x={0} y={H * 0.04} width={W} height={H * 0.41} fill="url(#auGlow)" /> : null}
          <Rect x={0} y={snowY} width={W} height={H - snowY} fill="#16202E" />
          <Rect x={0} y={0} width={W} height={H} fill="url(#auScrim)" />
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
