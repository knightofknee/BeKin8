// components/scenes/MiniFlame.tsx
// A small copy of THE SAME FIRE as the main beacon (BeaconFireSkia's shader, the skin's colours and
// shape) for a scene to burn somewhere else, e.g. a distant answering fire. Render inside a Skia
// <Canvas>. `env` 0..1 drives its height.
import React from 'react';
import { Rect as SkRect, Shader } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { fireEffect, rgb } from '../BeaconFireSkia';

type Props = {
  env: SharedValue<number>;
  clock: SharedValue<number>;
  skin: BeaconSkin;
  /** flame base on screen */
  x: number;
  y: number;
  /** flame height in px */
  height: number;
  /** half-width as a fraction of height */
  width?: number;
  offset?: number;
};

export const miniFlameAvailable = !!fireEffect;

export default function MiniFlame({ env, clock, skin, x, y, height, width = 0.27, offset = 0 }: Props) {
  const c0 = rgb(skin.core[0]);
  const c1 = rgb(skin.mid[0]);
  const c2 = rgb(skin.outer[1]);
  const gl = rgb(skin.glow.center);
  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value + offset,
      u_progress: env.value < 0 ? 0 : env.value,
      u_ignite: 0,
      u_shock: 0,
      u_intensity: 1.0,
      u_origin: [x, y],
      u_scale: height,
      u_width: width,
      u_turb: skin.flameShape.turb,
      u_speed: skin.flameShape.speed,
      u_col0: [c0[0], c0[1], c0[2]],
      u_col1: [c1[0], c1[1], c1[2]],
      u_col2: [c2[0], c2[1], c2[2]],
      u_glow: [gl[0], gl[1], gl[2]],
    }),
    [x, y, height, width, offset, skin.id]
  );
  if (!fireEffect) return null;
  return (
    <SkRect x={x - height * 1.3} y={y - height * 2.6} width={height * 2.6} height={height * 3.6}>
      <Shader source={fireEffect} uniforms={uniforms} />
    </SkRect>
  );
}
