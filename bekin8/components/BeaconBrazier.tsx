// components/BeaconBrazier.tsx
// The "Old Guard" beacon STRUCTURE: a forged iron brazier on splayed legs, cradling stacked wood —
// the grand-signal-beacon read (not a campfire). Static SVG; the fire/glow render on top via
// BeaconFire. Authored in a 0..100 box so it shares the old 180×180 footprint. Unlit appearance
// (dark iron + bare wood + faint banked coals); the flame is the fire layer's job.
import React from 'react';
import Svg, { Path, Line, Circle, Ellipse, G } from 'react-native-svg';

const IRON = '#2A2622';
const IRON_RIM = '#6E7480';
const RIVET = '#565B63';
const WOOD = '#8B5A2B';
const WOOD_DK = '#5C3D1F';
const COAL = '#241A0E';

type Props = { size?: number };

export default function BeaconBrazier({ size = 180 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Legs + base ring (behind the bowl) */}
      <Line x1="38" y1="56" x2="22" y2="94" stroke={IRON} strokeWidth="4.5" strokeLinecap="round" />
      <Line x1="62" y1="56" x2="78" y2="94" stroke={IRON} strokeWidth="4.5" strokeLinecap="round" />
      <Line x1="50" y1="58" x2="50" y2="94" stroke={IRON} strokeWidth="4" strokeLinecap="round" />
      <Ellipse cx="50" cy="82" rx="22" ry="3.6" fill="none" stroke={IRON} strokeWidth="2.6" />

      {/* Banked coals in the bowl (dim when unlit) */}
      <Ellipse cx="50" cy="44" rx="24" ry="6.5" fill={COAL} />

      {/* Stacked wood, poking above the rim */}
      <G strokeLinecap="round">
        <Line x1="40" y1="30" x2="34" y2="15" stroke={WOOD_DK} strokeWidth="4.5" />
        <Line x1="50" y1="30" x2="50" y2="11" stroke={WOOD} strokeWidth="5" />
        <Line x1="60" y1="30" x2="66" y2="16" stroke={WOOD_DK} strokeWidth="4.5" />
        <Line x1="38" y1="26" x2="62" y2="22" stroke={WOOD} strokeWidth="4" />
      </G>

      {/* Iron fire-bowl: wide riveted rim, curved sides */}
      <Path d="M12 26 L88 26 L80 52 Q50 64 20 52 Z" fill={IRON} />
      <Path d="M12 26 L88 26 L87 30 L13 30 Z" fill={IRON_RIM} />
      <G fill={RIVET}>
        <Circle cx="18" cy="28" r="1.4" />
        <Circle cx="34" cy="28" r="1.4" />
        <Circle cx="50" cy="28" r="1.4" />
        <Circle cx="66" cy="28" r="1.4" />
        <Circle cx="82" cy="28" r="1.4" />
      </G>
      {/* Iron band lower on the bowl */}
      <Path d="M22 44 Q50 54 78 44" fill="none" stroke="#201C18" strokeWidth="2" />
    </Svg>
  );
}
