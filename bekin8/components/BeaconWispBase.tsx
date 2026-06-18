// components/BeaconWispBase.tsx
// The "Will-o'-Wisp" beacon STRUCTURE: a low, weathered dark-stone cairn over which the ethereal
// cyan soul-flame floats. Minimal and grounded so the floating flame reads as otherworldly. Static
// SVG; the cyan flame renders on top. Authored 0..100, shares the 180×180 footprint.
import React from 'react';
import Svg, { Path, Ellipse, Circle } from 'react-native-svg';

const STONE = '#1B232A';
const STONE_HI = '#2A343D';
const MOSS = '#2E4138';

type Props = { size?: number };

export default function BeaconWispBase({ size = 180 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Cairn shadow on the ground */}
      <Ellipse cx="50" cy="90" rx="30" ry="5" fill="#10161B" />
      {/* Stacked weathered stones */}
      <Path d="M30 88 Q50 74 70 88 L72 92 L28 92 Z" fill={STONE} />
      <Ellipse cx="50" cy="76" rx="20" ry="9" fill={STONE} />
      <Ellipse cx="44" cy="72" rx="9" ry="6" fill={STONE_HI} />
      <Ellipse cx="58" cy="74" rx="8" ry="5.5" fill={STONE_HI} />
      <Ellipse cx="50" cy="66" rx="11" ry="6.5" fill={STONE} />
      {/* a touch of moss + a faint cool catch-light on top */}
      <Circle cx="38" cy="80" r="2" fill={MOSS} />
      <Circle cx="64" cy="82" r="1.6" fill={MOSS} />
      <Ellipse cx="50" cy="61" rx="7" ry="2.4" fill={STONE_HI} />
    </Svg>
  );
}
