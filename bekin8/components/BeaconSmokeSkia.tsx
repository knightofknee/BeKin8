// components/BeaconSmokeSkia.tsx
// The beacon SMOKE, rendered with a GPU shader (Skia RuntimeEffect / SkSL) instead of SVG puffs —
// a real volumetric column that rises the full background height BEHIND the tiles. One full-screen
// fragment shader: multi-octave value-noise FBM + domain warp, scrolled upward so it reads as
// rising, shaped into a column that widens and thins with height. Neutral wood-smoke color, shared
// by every skin (per product decision); per-skin intensity still rides skin.smoke.opacity. Drop-in
// for the SVG BeaconSmoke (same props). NATIVE: needs a dev/EAS rebuild — Skia is a native module.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  useFrameCallback,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';

// Neutral wood-smoke (linear-ish RGB, 0..1). Same for every skin.
const SMOKE_RGB: [number, number, number] = [0.64, 0.66, 0.70];

// FBM uses hash-based value noise (NO trig in the noise — a known mobile-GPU killer); a single sin
// drives the column's gentle sway. 5 octaves + one warp pass reads as soft, organic smoke.
const SMOKE_SKSL = `
uniform float u_time;     // seconds since lit
uniform float u_act;      // 0..1 lit-fade
uniform float u_density;  // per-skin intensity multiplier
uniform vec2  u_origin;   // smoke source (page px): flame base
uniform vec3  u_color;    // smoke tint

float hash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++){
    v += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

half4 main(vec2 fragCoord){
  float h = u_origin.y - fragCoord.y;              // px above the fire (up = positive)
  if (h < -30.0) return half4(0.0);                // nothing below the flame

  float width = 40.0 + max(h, 0.0) * 0.42;         // column widens as it rises
  float dx = fragCoord.x - u_origin.x;
  float col = 1.0 - smoothstep(0.0, width, abs(dx));
  if (col <= 0.0) return half4(0.0);

  float vIn  = smoothstep(-30.0, 120.0, h);                                 // ramp on above the fire
  float vOut = 1.0 - smoothstep(u_origin.y * 0.72, u_origin.y + 90.0, h);   // thin out near the top
  float env = col * vIn * vOut;
  if (env <= 0.002) return half4(0.0);

  float t = u_time * 44.0;                          // upward scroll (px/s) → reads as rising
  vec2 sp = vec2(dx * 0.9, fragCoord.y + t) * 0.011;
  sp.x += sin(h * 0.012 + u_time * 0.7) * 0.22;     // gentle sway, grows with height
  vec2 warp = vec2(fbm(sp + 2.7), fbm(sp + 9.1));
  float d = fbm(sp + warp * 1.7);
  d = smoothstep(0.30, 0.93, d);                    // wispy contrast

  float a = clamp(env * d * 0.62 * u_act * u_density, 0.0, 1.0);
  return half4(u_color * a, a);                     // premultiplied
}
`;

const effect = Skia.RuntimeEffect.Make(SMOKE_SKSL);
if (!effect && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn('BeaconSmokeSkia: smoke shader failed to compile');
}

export type BeaconSmokeProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
};

export default function BeaconSmokeSkia({ skin, active, anchorX, anchorY, measured }: BeaconSmokeProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const hasSmoke = skin.smoke.plumes > 0; // the lantern tower (plumes:0) renders no smoke
  // Per-skin intensity from the old opacity knob, normalized to a sane shader multiplier.
  const density = Math.max(0.35, Math.min(1, skin.smoke.opacity * 2.0));

  const clock = useSharedValue(0);
  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  // Always-registered frame loop gated by `motion` (see BeaconFire) — reliable across cold/skin
  // mounts. The GPU shader still only paints while the Canvas is mounted (visible = lit), so the
  // expensive work is still hard-stopped when unlit; only this counter advances.
  const motion = useSharedValue(active && !reduce && hasSmoke ? 1 : 0);
  useEffect(() => {
    motion.value = active && !reduce && hasSmoke ? 1 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, hasSmoke]);
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    if (motion.value === 0) return;
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrameCallback(tick, true);

  // Mount only while lit (+ a fade tail) so nothing renders when unlit.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(t);
  }, [active]);

  // Fade the smoke in/out with the lit state.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.85 : 0;
      return;
    }
    if (active) act.value = withTiming(1, { duration: first ? 0 : 1100 });
    else if (!first) act.value = withTiming(0, { duration: 850 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(
    () => () => {
      cancelAnimation(act);
      cancelAnimation(clock);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_act: act.value,
      u_density: density,
      u_origin: [anchorX, anchorY],
      u_color: [SMOKE_RGB[0], SMOKE_RGB[1], SMOKE_RGB[2]],
    }),
    [anchorX, anchorY, density]
  );

  if (!measured || !visible || !hasSmoke || !effect) return null;

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
