import React from 'react';
import Svg, { Rect, Circle, Line, G } from 'react-native-svg';

type Props = { size?: number };

// Wood palette
const BARK_DARK = '#3D2614';
const BARK = '#5C3D1F';
const WOOD = '#8B5A2B';
const RING_MID = '#A0612E';
const RING_PALE = '#D4A574';
const HEART = '#3D2614';

// Each log = a rotated trunk (rect with bark texture) + a non-rotated cut-end circle
// at the base showing the wood rings. Logs lean inward to a point at the top.
// Order: outermost first (back), center last (front) for proper z-stacking at the apex.
export default function UnlitLogs({ size = 180 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* === Far left log === */}
      <G transform="rotate(34 18 87)">
        <Rect x="13.5" y="22" width="9" height="65" rx="4.5" fill={BARK} />
        <Line x1="15.5" y1="25" x2="15.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="20.5" y1="25" x2="20.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      <Circle cx="18" cy="87" r="4.5" fill={RING_PALE} stroke={BARK} strokeWidth="1" />

      {/* === Far right log === */}
      <G transform="rotate(-34 82 87)">
        <Rect x="77.5" y="22" width="9" height="65" rx="4.5" fill={BARK} />
        <Line x1="79.5" y1="25" x2="79.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="84.5" y1="25" x2="84.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      <Circle cx="82" cy="87" r="4.5" fill={RING_PALE} stroke={BARK} strokeWidth="1" />

      {/* === Inner left log === */}
      <G transform="rotate(16 32 87)">
        <Rect x="27" y="15" width="10" height="72" rx="5" fill={WOOD} />
        <Line x1="29.5" y1="18" x2="29.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="32" y1="18" x2="32" y2="85" stroke={BARK} strokeWidth="0.5" />
        <Line x1="34.5" y1="18" x2="34.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      <Circle cx="32" cy="87" r="5" fill={RING_PALE} stroke={BARK} strokeWidth="1.1" />

      {/* === Inner right log === */}
      <G transform="rotate(-16 68 87)">
        <Rect x="63" y="15" width="10" height="72" rx="5" fill={WOOD} />
        <Line x1="65.5" y1="18" x2="65.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
        <Line x1="68" y1="18" x2="68" y2="85" stroke={BARK} strokeWidth="0.5" />
        <Line x1="70.5" y1="18" x2="70.5" y2="85" stroke={BARK_DARK} strokeWidth="0.7" />
      </G>
      <Circle cx="68" cy="87" r="5" fill={RING_PALE} stroke={BARK} strokeWidth="1.1" />

      {/* === Center log (front, slightly tallest) === */}
      <Rect x="44.5" y="11" width="11" height="76" rx="5.5" fill={BARK} />
      <Line x1="47" y1="14" x2="47" y2="85" stroke={BARK_DARK} strokeWidth="0.8" />
      <Line x1="50" y1="14" x2="50" y2="85" stroke={WOOD} strokeWidth="0.5" opacity="0.6" />
      <Line x1="53" y1="14" x2="53" y2="85" stroke={BARK_DARK} strokeWidth="0.8" />
      <Circle cx="50" cy="87" r="5.5" fill={RING_PALE} stroke={BARK} strokeWidth="1.2" />
    </Svg>
  );
}
