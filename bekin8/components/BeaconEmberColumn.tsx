// components/BeaconEmberColumn.tsx
// The matchbox Bonfire's behind-tiles effect (smokeKind 'embers'): PRINTED SPARK DOTS. Hard-edged
// ink dots in the skin's print palette (gold / vermilion / cream) climb a loose column above the
// fire, and the whole layer runs on QUANTIZED time (floor(t*8)/8), so the dots HOP between
// positions at the same 8fps cadence as the flame frames, like sparks stamped on successive
// printing passes. Some dots skip a frame entirely (blink), the way limited animation drops
// in-betweens. No soft glow, no haze: flat ink on the night, matching BeaconPrintFire.
//
// Renders in home's SMOKE slot, BEHIND the friend tiles, alpha-capped like the other behind-tiles
// effects. Stateless: every dot is a pure function of u_time + hash traits, so cold-mounting into
// an already-lit beacon at arbitrary time looks right.
//
// TIMING CONTRACT (t=0 = lit edge, shared with BonfirePyre + BeaconPrintFire): torch 0-0.9s,
// flame + burst at 0.9s, sparks fade in from ~1.05s. Extinguish fades with no delay.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  withDelay,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';
import { makeShaderEffect } from '../lib/makeShaderEffect';
import { useGatedClock } from '../lib/useGatedClock';

const SPARK_SKSL = `
uniform float u_time;     // seconds (gated clock)
uniform float u_act;      // 0..1 lit-fade
uniform float u_density;  // per-skin intensity (skin.smoke.opacity)
uniform vec2  u_origin;   // flame seat (page px); sparks climb from above it

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

half4 main(vec2 fragCoord){
  if (u_act <= 0.003) return half4(0.0);
  float dx = fragCoord.x - u_origin.x;
  if (abs(dx) > 130.0 || fragCoord.y > u_origin.y) return half4(0.0);

  // Quantized time: the sparks hop at the flame's 8fps cadence instead of gliding.
  float t = floor(u_time * 8.0) / 8.0;
  float frame = floor(u_time * 8.0);

  vec3 prem = vec3(0.0);
  float a = 0.0;

  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float per = 4.5 + 3.5 * hash(vec2(fi, 3.1));            // 4.5-8s ride up the column
    float h = fract(t / per + hash(vec2(fi, 9.7)));          // 0 leaving the fire -> 1 up high
    // a loose printed zigzag: each dot weaves as it climbs, wider higher up
    float wob = sin(6.2831853 * (h * (1.6 + hash(vec2(fi, 4.4))) + hash(vec2(fi, 7.7))));
    float x = u_origin.x + (hash(vec2(fi, 1.9)) - 0.5) * 56.0 + wob * 24.0 * h;
    float y = u_origin.y - 34.0 - h * (u_origin.y + 80.0);
    float cool = 1.0 - h;                                    // dots die before they wrap: no pop
    // limited-animation blink: some frames a dot simply isn't printed
    float blink = hash(vec2(fi, frame)) < 0.82 ? 1.0 : 0.0;
    float sz = (3.4 - 1.9 * h) * (0.75 + 0.5 * hash(vec2(fi, 2.2)));
    vec2 dv = fragCoord - vec2(x, y);
    float d2 = dot(dv, dv);
    float mark = 1.0 - smoothstep(sz * sz * 0.5, sz * sz, d2); // hard-edged ink dot
    float pick = hash(vec2(fi, 1.3));
    vec3 col = pick < 0.45 ? vec3(0.957, 0.725, 0.259)         // gold
             : pick < 0.80 ? vec3(0.902, 0.294, 0.173)         // vermilion
                           : vec3(0.957, 0.914, 0.804);        // cream
    float ea = mark * cool * blink * u_act * u_density;
    prem += col * ea;
    a += ea;
  }

  a = min(a, 0.6); // behind-tiles cap: the sparks never wash out the content above them
  return half4(clamp(prem, 0.0, 1.2), a);
}
`;

const effect = makeShaderEffect(SPARK_SKSL, 'BeaconEmberColumn');

export type BeaconEmberColumnProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconEmberColumn({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconEmberColumnProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const density = Math.max(0.35, Math.min(1, skin.smoke.opacity));

  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  const { clock } = useGatedClock(active && !reduce && focused);

  // Mount only while lit (+ fade tail) so nothing renders when unlit.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 900);
    return () => clearTimeout(t);
  }, [active]);

  // Fade with the lit state: a fresh light waits for the torch impact (timing contract above);
  // a cold mount into an already-lit beacon is instant, extinguish fades with no delay.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    cancelAnimation(act);
    if (active) {
      if (first) act.value = 1;
      else act.value = withDelay(1050, withTiming(1, { duration: 900 }));
    } else if (!first) {
      act.value = withTiming(0, { duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(
    () => () => {
      cancelAnimation(act);
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
    }),
    [anchorX, anchorY, density]
  );

  // Reduced motion: frozen sparks scattered mid-air read as stray marks, so render nothing
  // (the printed flame's own reduced-motion branch still shows a lit fire).
  if (!measured || !visible || reduce || !effect) return null;

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
