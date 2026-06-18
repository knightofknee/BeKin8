// components/BeaconPyre.tsx
// The "Wildfire" beacon STRUCTURE: a heavy, chaotic stacked-wood pyre — thick split logs piled high
// at angry angles, charred near-black with smoldering glowing cracks (pent-up energy before it
// blasts). Static SVG; the fire renders on top. Authored 0..100, shares the 180×180 footprint.
import React from 'react';
import Svg, { Line, Circle, G } from 'react-native-svg';

const CHAR = '#1A1410';
const CHAR2 = '#241B12';
const WOOD = '#4A3320';
const CRACK = '#FF6A1E';
const CAP = '#6B4A28';

type Props = { size?: number };

export default function BeaconPyre({ size = 180 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Stone base */}
      <Line x1="20" y1="94" x2="80" y2="94" stroke="#2C2A28" strokeWidth="7" strokeLinecap="round" />

      {/* Piled split logs at angry angles (back to front) */}
      <G strokeLinecap="round">
        <Line x1="24" y1="92" x2="60" y2="50" stroke={CHAR} strokeWidth="11" />
        <Line x1="78" y1="92" x2="44" y2="48" stroke={CHAR2} strokeWidth="11" />
        <Line x1="34" y1="93" x2="66" y2="54" stroke={WOOD} strokeWidth="9" />
        <Line x1="68" y1="93" x2="40" y2="52" stroke={CHAR} strokeWidth="9" />
        <Line x1="50" y1="94" x2="52" y2="44" stroke={CHAR2} strokeWidth="10" />
        <Line x1="30" y1="74" x2="72" y2="70" stroke={WOOD} strokeWidth="8" />
        <Line x1="58" y1="40" x2="40" y2="60" stroke={CHAR} strokeWidth="7" />
      </G>

      {/* Smoldering glowing cracks in the wood (the pent-up energy) */}
      <G stroke={CRACK} strokeLinecap="round" opacity="0.85">
        <Line x1="46" y1="64" x2="50" y2="56" strokeWidth="1.4" />
        <Line x1="58" y1="68" x2="54" y2="60" strokeWidth="1.2" />
        <Line x1="40" y1="72" x2="44" y2="66" strokeWidth="1.2" />
      </G>

      {/* A couple of cut log-ends catching light */}
      <Circle cx="60" cy="50" r="4.5" fill={CAP} />
      <Circle cx="44" cy="48" r="4" fill={CAP} />
    </Svg>
  );
}
