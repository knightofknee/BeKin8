// components/BeaconBonfire.tsx
// The "Bonfire" beacon STRUCTURE: a big, deliberately-BUILT pyre, a stacked log-cabin base, a dense
// teepee of leaning logs, and a criss-cross of logs over the front. Clearly stacked WOOD (cut-end
// rings + grain), heartier/wider than the Campfire. Static SVG; the dramatic fire renders on top.
// Authored 0..100, shares the 180×180 footprint.
import React from 'react';
import Svg, { Rect, Circle, Line, G } from 'react-native-svg';

const BARK_DARK = '#33200F';
const BARK = '#5C3D1F';
const WOOD = '#8B5A2B';
const WOOD2 = '#7A4E25';
const WOOD3 = '#9C6633';
const RING = '#D4A574';
const RING_DK = '#B98A57';

function cut(cx: number, cy: number, r: number) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={RING} stroke={BARK} strokeWidth="1.1" />
      <Circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke={RING_DK} strokeWidth="0.7" />
    </G>
  );
}

function grain(x: number, y1: number, y2: number) {
  return (
    <>
      <Line x1={x} y1={y1} x2={x} y2={y2} stroke={BARK_DARK} strokeWidth="0.7" />
      <Line x1={x + 3} y1={y1} x2={x + 3} y2={y2} stroke={WOOD} strokeWidth="0.5" opacity={0.5} />
    </>
  );
}

export default function BeaconBonfire({ size = 180 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* ===== Teepee logs leaning in (BACK to FRONT) ===== */}
      <G transform="rotate(38 20 90)"><Rect x="14.5" y="30" width="11" height="62" rx="5.5" fill={BARK} />{grain(17, 34, 88)}</G>
      <G transform="rotate(-38 80 90)"><Rect x="74.5" y="30" width="11" height="62" rx="5.5" fill={BARK} />{grain(77, 34, 88)}</G>

      <G transform="rotate(20 34 90)"><Rect x="28" y="20" width="12" height="72" rx="6" fill={WOOD} />{grain(31, 24, 88)}</G>
      <G transform="rotate(-20 66 90)"><Rect x="60" y="20" width="12" height="72" rx="6" fill={WOOD2} />{grain(63, 24, 88)}</G>

      {/* Center log (tallest, front of the teepee) */}
      <Rect x="44" y="14" width="12" height="78" rx="6" fill={WOOD3} />{grain(47, 18, 88)}

      {/* ===== Log-cabin base: two stacked horizontal courses ===== */}
      {/* upper (back) course, slightly inset */}
      <G transform="rotate(2 50 74)">
        <Rect x="20" y="69" width="60" height="11" rx="5.5" fill={WOOD2} />
        <Line x1="24" y1="72" x2="76" y2="72" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      {cut(21, 74, 5.5)}
      {cut(79, 74, 5.5)}

      {/* lower (front) course, full width */}
      <G transform="rotate(-3 50 86)">
        <Rect x="13" y="81" width="74" height="12" rx="6" fill={WOOD} />
        <Line x1="18" y1="84.5" x2="82" y2="84.5" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="18" y1="89" x2="82" y2="89" stroke={WOOD2} strokeWidth="0.5" opacity={0.6} />
      </G>
      {cut(14, 87, 6)}
      {cut(86, 84, 6)}

      {/* ===== Criss-cross logs over the front (an X) ===== */}
      <G transform="rotate(28 50 78)"><Rect x="26" y="73" width="48" height="9" rx="4.5" fill={BARK} />{grain(40, 75, 80)}</G>
      <G transform="rotate(-28 50 78)"><Rect x="26" y="73" width="48" height="9" rx="4.5" fill={WOOD3} />{grain(40, 75, 80)}</G>
      {cut(28, 90, 4.6)}
      {cut(72, 90, 4.6)}

      {/* base cut-ends for the teepee logs */}
      {cut(20, 90, 5.5)}
      {cut(80, 90, 5.5)}
      {cut(34, 90, 6)}
      {cut(66, 90, 6)}
      {cut(50, 90, 6)}
    </Svg>
  );
}
