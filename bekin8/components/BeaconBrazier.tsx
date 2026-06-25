// components/BeaconBrazier.tsx
// The "Old Guard" beacon STRUCTURE: a forged iron brazier on splayed legs, cradling stacked wood,
// the grand-signal-beacon read (not a campfire). Static SVG; the fire/glow render on top via
// BeaconFire. Authored in a 0..100 box so it shares the old 180×180 footprint. Unlit appearance
// (dark iron + bare wood + faint banked coals); the flame is the fire layer's job.
import React from 'react';
import Svg, { Path, Rect, Line, Circle, Ellipse, G } from 'react-native-svg';

const IRON = '#2A2622';
const IRON_RIM = '#6E7480';
const RIVET = '#565B63';
const WOOD = '#8B5A2B';
const WOOD_DK = '#5C3D1F';
const GRAIN = '#3D2614';
const RING = '#D4A574';
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

      {/* Real logs cradled in the bowl, poking above the rim (rounded trunks + cut-end grain) */}
      <G transform="rotate(16 41 32)">
        <Rect x="37" y="9" width="8.5" height="23" rx="4.2" fill={WOOD} />
        <Line x1="40" y1="13" x2="40" y2="30" stroke={GRAIN} strokeWidth="0.6" />
        <Line x1="42.5" y1="13" x2="42.5" y2="30" stroke={GRAIN} strokeWidth="0.6" />
        <Circle cx="41.2" cy="10" r="4.2" fill={RING} stroke={WOOD_DK} strokeWidth="0.9" />
      </G>
      <Rect x="45.5" y="5" width="9" height="27" rx="4.5" fill={WOOD_DK} />
      <Line x1="48.5" y1="9" x2="48.5" y2="30" stroke={GRAIN} strokeWidth="0.7" />
      <Line x1="51.5" y1="9" x2="51.5" y2="30" stroke={GRAIN} strokeWidth="0.7" />
      <Circle cx="50" cy="6.5" r="4.5" fill={RING} stroke={GRAIN} strokeWidth="0.9" />
      <G transform="rotate(-16 59 32)">
        <Rect x="54.5" y="9" width="8.5" height="23" rx="4.2" fill={WOOD} />
        <Line x1="57.5" y1="13" x2="57.5" y2="30" stroke={GRAIN} strokeWidth="0.6" />
        <Line x1="60" y1="13" x2="60" y2="30" stroke={GRAIN} strokeWidth="0.6" />
        <Circle cx="58.8" cy="10" r="4.2" fill={RING} stroke={WOOD_DK} strokeWidth="0.9" />
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
