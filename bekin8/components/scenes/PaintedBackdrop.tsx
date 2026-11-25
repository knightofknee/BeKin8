// components/scenes/PaintedBackdrop.tsx
// Shared placement for the PAINTED skins (art/build_skins.py -> paintedArt.ts). A painting is drawn
// art.zoom screen-widths wide and positioned so the spot it paints for the beacon (art.ledge) lands
// under the foot of the sprite in the 180px structure box. Above the painting the sky carries on as
// flat colour; below it the ground falls away to the floor colour (both are what the build script
// faded the painting's edges to, so there is no seam).
import React from 'react';
import { Rect, Image as SvgImage } from 'react-native-svg';
import type { BeaconSkin } from '../../lib/beaconSkins';
import type { PaintedArt } from './paintedArt';

export type PaintedLayout = {
  /** painting box on screen */
  ix: number; iy: number; imgW: number; imgH: number;
  /** the beacon's foot on screen (centre x, ground y) */
  ax: number; footY: number;
  /** the flame seat on screen */
  seatY: number;
};

export function paintedLayout(
  art: PaintedArt,
  skin: BeaconSkin,
  W: number,
  H: number,
  anchorX: number | undefined,
  anchorY: number | undefined,
  measured: boolean
): PaintedLayout {
  const ax = measured && anchorX != null ? anchorX : W * 0.5;
  // anchorY is the flame seat, skin.origin of the way down the 180px box. Clamped so a bad
  // measurement can never push the painting off screen.
  const rawSeat = measured && anchorY != null ? anchorY : H * 0.66;
  const seatY = Math.min(Math.max(rawSeat, H * 0.45), H * 0.85);
  const footY = seatY + (art.foot / 100 - skin.origin) * 180;
  const imgW = W * art.zoom;
  const imgH = imgW / art.aspect;
  const ix = Math.min(0, Math.max(W - imgW, ax - art.ledge.u * imgW));
  const iy = footY - art.ledge.v * imgH;
  return { ix, iy, imgW, imgH, ax, footY, seatY };
}

/** A marked point on the painting -> screen px. */
export function paintedPoint(l: PaintedLayout, p: { u: number; v: number }) {
  return { x: l.ix + p.u * l.imgW, y: l.iy + p.v * l.imgH };
}

/** The painting itself, with its sky and floor carried on. Render inside an <Svg>. */
export function PaintedBackdrop({ art, layout, W, H }: { art: PaintedArt; layout: PaintedLayout; W: number; H: number }) {
  return (
    <>
      <Rect x={0} y={0} width={W} height={H} fill={art.floor} />
      {layout.iy > 0 ? <Rect x={0} y={0} width={W} height={layout.iy + 2} fill={art.sky} /> : null}
      <SvgImage x={layout.ix} y={layout.iy} width={layout.imgW} height={layout.imgH} href={art.bg} preserveAspectRatio="none" />
    </>
  );
}
