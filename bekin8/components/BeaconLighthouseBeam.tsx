// components/BeaconLighthouseBeam.tsx
// The LIGHTHOUSE beam, a full-screen Skia shader layered in FRONT (where BeaconFire normally goes;
// home renders this for the 'lighthouse' skin). Two opposing volumetric light cones ROTATE around the
// lantern (anchorX/anchorY); the lantern blooms brighter each time a beam sweeps toward the viewer
// (the periodic FLASH). Drop-in props with BeaconFire. NATIVE (Skia). Reduced-motion freezes rotation.
import React, { useEffect, useState } from 'react';
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

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [1, 0.96, 0.85];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const BEAM_SKSL = `
uniform float u_time;
uniform float u_lit;       // 0..1 fade
uniform vec2  u_lantern;   // lantern center px
uniform float u_len;       // beam reach px
uniform vec3  u_color;

const float PI = 3.14159265;

half4 main(vec2 fragCoord){
  vec2 d = fragCoord - u_lantern;
  float dist = length(d);
  float ang = atan(d.y, d.x);

  // HORIZONTAL rotation: the lens turns in the horizontal plane. From the side, the beam points
  // up-and-out over the sea and SWEEPS left↔right (sway), fading out as it rotates behind the tower
  // (front<0), reappearing from the other side, i.e. it sweeps, it doesn't spin through the tower.
  float theta = u_time * 0.8;
  float sway = sin(theta);            // -1 (left) .. +1 (right)
  float front = cos(theta);           // 1 = lens facing the viewer
  float vis = smoothstep(-0.15, 0.4, front);   // hide while pointing away (behind)

  float axis = -1.5707963 + sway * 1.25;       // up (−π/2) swung ±~72° horizontally
  float ad = abs(atan(sin(ang - axis), cos(ang - axis)));   // wrapped angular distance to the beam
  float halfAng = 0.085 + 0.06 * smoothstep(0.0, u_len, dist);
  float core = 1.0 - smoothstep(0.0, halfAng, ad);
  float halo = 1.0 - smoothstep(0.0, halfAng * 2.8, ad);
  float falloff = 1.0 - smoothstep(u_len * 0.12, u_len, dist);
  float beam = (core * 0.9 + halo * 0.3) * falloff * vis;

  // SMALL lantern bloom; a sharp FLASH only as the lens swings to face the viewer (front≈1).
  float flash = pow(max(front, 0.0), 7.0);
  float bloom = exp(-dist * dist / (2.0 * 15.0 * 15.0)) * (0.22 + 1.5 * flash);

  float a = clamp((beam + bloom) * u_lit, 0.0, 1.0);
  vec3 col = u_color * (beam * 0.95 + bloom * 1.3);
  return half4(clamp(col, 0.0, 2.0) * u_lit, a);
}
`;

const effect = makeShaderEffect(BEAM_SKSL, 'BeaconLighthouseBeam');

export type BeaconFireProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconLighthouseBeam({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconFireProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const color = rgb(skin.glow.center);
  const len = Math.hypot(W, H);

  const { clock } = useGatedClock(active && !reduce && focused);
  const lit = useSharedValue(active ? 1 : 0);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 700);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 700 : 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_lantern: [anchorX, anchorY],
      u_len: len,
      u_color: [color[0], color[1], color[2]],
    }),
    [anchorX, anchorY, len, skin.id]
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
