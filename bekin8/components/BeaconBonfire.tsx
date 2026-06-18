// components/BeaconBonfire.tsx
// The "Bonfire" beacon STRUCTURE: a big, hearty teepee-pile of real stacked logs (thicker + wider +
// taller than the Campfire) with criss-crossed logs across the front — clearly WOOD, no stray marks.
// Static SVG; the dramatic fire renders on top. Authored 0..100, shares the 180×180 footprint.
import React from 'react';
import Svg, { Rect, Circle, Line, G } from 'react-native-svg';

const BARK_DARK = '#3D2614';
const BARK = '#5C3D1F';
const WOOD = '#8B5A2B';
const WOOD2 = '#7A4E25';
const RING = '#D4A574';

function cut(cx: number, cy: number, r: number) {
  return <Circle cx={cx} cy={cy} r={r} fill={RING} stroke={BARK} strokeWidth="1.1" />;
}

export default function BeaconBonfire({ size = 180 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Back/outer teepee logs */}
      <G transform="rotate(36 22 90)"><Rect x="16.5" y="34" width="11" height="58" rx="5.5" fill={BARK} /></G>
      {cut(22, 90, 5.5)}
      <G transform="rotate(-36 78 90)"><Rect x="72.5" y="34" width="11" height="58" rx="5.5" fill={BARK} /></G>
      {cut(78, 90, 5.5)}

      {/* Inner teepee logs (with a little grain) */}
      <G transform="rotate(18 36 90)">
        <Rect x="30" y="22" width="12" height="70" rx="6" fill={WOOD} />
        <Line x1="33" y1="26" x2="33" y2="88" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="39" y1="26" x2="39" y2="88" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      {cut(36, 90, 6)}
      <G transform="rotate(-18 64 90)">
        <Rect x="58" y="22" width="12" height="70" rx="6" fill={WOOD2} />
        <Line x1="61" y1="26" x2="61" y2="88" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="67" y1="26" x2="67" y2="88" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      {cut(64, 90, 6)}

      {/* Center log (tallest, front) */}
      <Rect x="44" y="16" width="12" height="76" rx="6" fill={BARK} />
      <Line x1="47" y1="20" x2="47" y2="88" stroke={BARK_DARK} strokeWidth="0.8" />
      <Line x1="53" y1="20" x2="53" y2="88" stroke={WOOD} strokeWidth="0.5" opacity="0.6" />
      {cut(50, 90, 6)}

      {/* A log lying across the front of the pile */}
      <G transform="rotate(-7 50 85)">
        <Rect x="17" y="80" width="66" height="11" rx="5.5" fill={WOOD2} />
        <Line x1="20" y1="83" x2="80" y2="83" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      {cut(18, 86, 5.5)}
      {cut(82, 83, 5.5)}
    </Svg>
  );
}
