// components/BeaconSmokeSignal.tsx
// The SMOKE SIGNAL beacon, the smoke IS the hero. A forked, retuned version of BeaconSmokeSkia:
// a thick, NEAR-WHITE column (steam-heavy white smoke, like green/damp fuel heaped on a small hot
// fire), narrower and taller and denser than the ambient skin smoke, rising in discrete PUFFS (a
// vertical puff gate, mimicking a hide lifted off the fire). A small, hot base fire glows at the
// source. Real mechanics: a small wood fire stays hot but clean; green/damp material on top makes the
// thick white column; signals were lit on ridgelines for line of sight. Rendered in home's FIRE slot
// (like BeaconLighthouseBeam); the generic BeaconSmoke is disabled for this skin (smoke.plumes:0).
// NATIVE: needs a dev/EAS rebuild, Skia is a native module.
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

// Near-white, slightly cool, white signal smoke is mostly water vapor + pale fine particulate.
const SMOKE_RGB: [number, number, number] = [0.92, 0.94, 0.97];

// Same hash/value-noise FBM as the ambient smoke (NO trig in the noise, a mobile-GPU killer); one sin
// drives the gentle sway. The differences from the ambient smoke: a narrow/tall/dense column, a vertical
// PUFF GATE that pinches density to near-zero between rising puffs, and a small warm base FIRE.
const SMOKE_SKSL = `
uniform float u_time;     // seconds since lit
uniform float u_act;      // 0..1 lit-fade
uniform float u_density;  // per-skin intensity multiplier
uniform vec2  u_origin;   // smoke source (page px): the small fire base
uniform vec3  u_color;    // near-white smoke tint

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
  float h  = u_origin.y - fragCoord.y;       // px above the fire (up = positive)
  float dx = fragCoord.x - u_origin.x;
  float dy = fragCoord.y - u_origin.y;

  // --- small base FIRE: a tight, gently flickering warm glow at the source (the hot wood fire) ---
  float flick  = 0.86 + 0.14 * sin(u_time * 8.0) * sin(u_time * 5.3 + 1.7);
  float fr     = 24.0 * flick;
  float fire   = exp(-(dx * dx + dy * dy) / (2.0 * fr * fr));
  float aFire  = clamp(fire * 0.95, 0.0, 1.0);
  vec3  fireCol = vec3(1.0, 0.60, 0.26);

  // --- SMOKE column: the HERO. Narrow, tall, dense, near-white, rising in PUFFS. ---
  float aSmoke = 0.0;
  vec3  smokeCol = u_color;
  if (h > -16.0) {
    float width = 20.0 + max(h, 0.0) * 0.16;          // narrow; widens slowly with height
    float col   = 1.0 - smoothstep(0.0, width, abs(dx));
    if (col > 0.0) {
      float vIn  = smoothstep(-16.0, 80.0, h);                                 // ramp on just above the fire
      float vOut = 1.0 - smoothstep(u_origin.y * 0.96, u_origin.y + 160.0, h); // climbs almost the full height
      float env  = col * vIn * vOut;
      if (env > 0.002) {
        float t  = u_time * 50.0;                       // upward scroll → reads as rising
        vec2  sp = vec2(dx * 0.85, fragCoord.y + t) * 0.012;
        sp.x += sin(h * 0.010 + u_time * 0.6) * 0.18;   // gentle sway, grows with height
        vec2  warp = vec2(fbm(sp + 2.7), fbm(sp + 9.1));
        float d = fbm(sp + warp * 1.6);
        d = smoothstep(0.20, 0.82, d);                  // fuller, denser body (less wispy than ambient smoke)

        // PUFF GATE: discrete puffs rising up the column. A soft blob per cell of a height phase that
        // scrolls upward over time; density pinches toward ~0.1 in the gaps between puffs.
        float ph   = fract(h / 240.0 - u_time * 0.30);
        float puff = smoothstep(0.0, 0.42, ph) * (1.0 - smoothstep(0.52, 1.0, ph));
        puff = 0.10 + 0.90 * puff;

        aSmoke = clamp(env * d * puff * 0.66 * u_density, 0.0, 1.0);

        // The small fire underlights only the lowest stretch of the column; it cools to white fast.
        float warm = exp(-max(h, 0.0) / 64.0);
        smokeCol = mix(u_color, vec3(1.0, 0.58, 0.30), warm * 0.28);
      }
    }
  }

  // Composite: smoke OVER the small base fire (premultiplied), then fade by the lit state.
  vec3  rgb = smokeCol * aSmoke + fireCol * aFire * (1.0 - aSmoke);
  float a   = aSmoke + aFire * (1.0 - aSmoke);
  return half4(rgb * u_act, a * u_act);
}
`;

const effect = Skia.RuntimeEffect.Make(SMOKE_SKSL);
if (!effect && __DEV__) {
  // eslint-disable-next-line no-console
  console.warn('BeaconSmokeSignal: smoke shader failed to compile');
}

export type BeaconSmokeSignalProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconSmokeSignal({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconSmokeSignalProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Per-skin column intensity (from the skin's smoke.opacity knob), normalized to a sane multiplier.
  // No plumes gate here, the smoke signal ALWAYS renders its column (its smoke.plumes is 0 only to
  // disable the generic BeaconSmoke layer for this skin).
  const density = Math.max(0.5, Math.min(1, skin.smoke.opacity * 2.0));

  const clock = useSharedValue(0);
  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  // Always-registered frame loop gated by `motion` (see BeaconFire), reliable across cold/skin mounts.
  // The GPU shader still only paints while the Canvas is mounted (visible = lit), so the expensive work
  // hard-stops when unlit; only this counter advances.
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

  // Mount only while lit (+ a fade tail) so nothing renders when unlit.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(t);
  }, [active]);

  // Fade the column in/out with the lit state.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.9 : 0;
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
