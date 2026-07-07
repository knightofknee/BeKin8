// components/structures/BeaconPyre.tsx
// The "The Beacons" skin STRUCTURE: a Gondor-style MOUNTAIN SIGNAL PYRE. A disciplined, purpose-built
// crib stack of cut logs (alternating side-on courses and rows of sawn ends) waiting for the call,
// standing on a low dry-stone signal platform with a snow-dusted cap. Cold moonlit wood with thin
// snow-silver rim highlights so the silhouette pops off a dark scene; unlit it is a pure static
// silhouette (nothing pulses, no glow). When lit the rim highlights warm from snow-silver to gold,
// warm slivers show in the seams between log ends (fire seen through the cracks, no glow blob), and
// a soft linear wash falls on the platform cap. The real flame is the Skia fire layer. FLAME SEAT:
// registry origin 0.54 (the upper course, cone-from-wood rule: the crown above burns inside the
// flame, whose base matches the upper log's span); the crown at y=44 is a shallow
// CRADLE (center pair at the seat, flanking shoulders a touch higher, two short poles leaning up the
// sides) so the flame nests instead of perching. Authored 0..100; 180x180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);

// Cold-toned wood + moon/snow rims (unlit), warming to gold when lit.
const WOOD_DK = '#4E3A2A';
const WOOD = '#6A4E36';
const BARK_EDGE = '#2E2216';
const FACE = '#7E6449'; // sawn log ends, pale but cold
const FACE_RING = '#55402C';
const SNOW = '#9FB3D1';
const SNOW_BRIGHT = '#C6D4E8';
const GOLD_RIM = '#F0BE6A';
const EMBER_SLIVER = '#FFC46A'; // lit warmth in the seams between log ends
const STONE = '#26324A';
const STONE_DK = '#1B2438';
const STONE_CAP = '#2E3C58';
const JOINT = '#131B2C';
const IRON = '#161E30';

// The crib stack, bottom to top: side-on log courses alternate with rows of sawn ends facing the
// viewer, each course a little narrower than the one below (a neat pyramid, y=78 up to the crown).
type EndRow = { cy: number; r: number; xs: number[] };
const ROW_BASE: EndRow = { cy: 73.7, r: 4.3, xs: [27.8, 35.2, 42.6, 50, 57.4, 64.8, 72.2] };
const ROW_MID: EndRow = { cy: 61.6, r: 4.0, xs: [31, 38.6, 46.2, 53.8, 61.4, 69] };
const LOG_LOWER = { x: 26, y: 64.6, w: 48, h: 8 };
const LOG_UPPER = { x: 32.5, y: 50.6, w: 35, h: 7.8 };

// The crown row forms a shallow CRADLE instead of a flat top: the center pair's tops sit exactly at
// y=44 (the flame seat, registry origin 0.44, DO NOT MOVE) while the flanking shoulders ride a touch
// higher, so the flame nests between them instead of perching on a flat crown.
type CrownEnd = { cx: number; cy: number; r: number };
const CROWN_ENDS: CrownEnd[] = [
  { cx: 39.05, cy: 45.4, r: 3.7 }, // left shoulder, top at y=41.7
  { cx: 46.35, cy: 47.7, r: 3.7 }, // seat log, top at y=44
  { cx: 53.65, cy: 47.7, r: 3.7 }, // seat log, top at y=44
  { cx: 60.95, cy: 45.4, r: 3.7 }, // right shoulder, top at y=41.7
];
// Two short poles leaning up the crown's sides, tips at roughly (45.5, 37.5) and (54.5, 37.5),
// framing the seat opening. edge marks the moon-facing (outer) side for the rim highlight.
type FramePole = { px: number; py: number; len: number; w: number; rot: number; edge: -1 | 1 };
const FRAME_POLES: FramePole[] = [
  { px: 40.5, py: 51, len: 14.5, w: 2.8, rot: 20, edge: -1 },
  { px: 59.5, py: 51, len: 14.5, w: 2.8, rot: -20, edge: 1 },
];

// Warm slivers in the seams where adjacent log ends meet, shown only while lit: fire glimpsed
// through the cracks of the stack, never a glow blob.
const GAP_SLIVERS = [
  { cx: 50, cy: 48.6, h: 3.4 }, // crown seam right under the seat
  { cx: 42.4, cy: 61.4, h: 3.6 },
  { cx: 57.6, cy: 61.4, h: 3.6 },
  { cx: 46.3, cy: 73.5, h: 3.8 },
  { cx: 53.7, cy: 73.5, h: 3.8 },
] as const;

// A sawn log end facing the viewer: cut face, bark edge, growth rings.
function cutEnd(cx: number, cy: number, r: number, key: string) {
  return (
    <G key={key}>
      <Circle cx={cx} cy={cy} r={r} fill={FACE} stroke={BARK_EDGE} strokeWidth="1" />
      <Circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke={FACE_RING} strokeWidth="0.6" opacity={0.8} />
      <Circle cx={cx} cy={cy} r={r * 0.16} fill={FACE_RING} opacity={0.7} />
    </G>
  );
}

// A side-on log course: rounded trunk + bark grain lines.
function sideLog(x: number, y: number, w: number, h: number, fill: string, key: string) {
  return (
    <G key={key}>
      <Rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />
      <Line x1={x + 4} y1={y + h * 0.45} x2={x + w - 4} y2={y + h * 0.45} stroke={BARK_EDGE} strokeWidth="0.6" opacity={0.55} />
      <Line x1={x + 5} y1={y + h * 0.72} x2={x + w - 5} y2={y + h * 0.72} stroke={BARK_EDGE} strokeWidth="0.5" opacity={0.4} />
    </G>
  );
}

// Top-edge arc of a log end (the moonlight / firelight catch line).
function rimArc(cx: number, cy: number, r: number) {
  const dx = r * 0.71;
  return `M${cx - dx} ${cy - dx} A${r} ${r} 0 0 1 ${cx + dx} ${cy - dx}`;
}

// Every rim highlight on the wood, in one color pass. Rendered once in snow-silver (always) and once
// in gold inside the lit fade group, so lighting the pyre warms the same edges the moon was catching.
function rimHighlights(color: string) {
  return (
    <G stroke={color} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity={0.85}>
      <Line x1={LOG_LOWER.x + 3} y1={LOG_LOWER.y + 1.2} x2={LOG_LOWER.x + LOG_LOWER.w - 3} y2={LOG_LOWER.y + 1.2} />
      <Line x1={LOG_UPPER.x + 3} y1={LOG_UPPER.y + 1.2} x2={LOG_UPPER.x + LOG_UPPER.w - 3} y2={LOG_UPPER.y + 1.2} />
      {[ROW_BASE, ROW_MID].map((row, ri) =>
        row.xs.map((cx, i) => <Path key={`rim${ri}-${i}`} d={rimArc(cx, row.cy, row.r)} />),
      )}
      {CROWN_ENDS.map((e, i) => <Path key={`rimc${i}`} d={rimArc(e.cx, e.cy, e.r)} />)}
      {FRAME_POLES.map((p, i) => (
        <G key={`rimp${i}`} transform={`rotate(${p.rot} ${p.px} ${p.py})`}>
          <Line
            x1={p.px + p.edge * (p.w / 2 - 0.6)}
            y1={p.py - p.len + 2.5}
            x2={p.px + p.edge * (p.w / 2 - 0.6)}
            y2={p.py - 2.5}
          />
        </G>
      ))}
    </G>
  );
}

// Opacity fade wrapper (fixed single hook), conditionally mounted with a fade tail like the Tower's lanterns.
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

export default function BeaconPyre({ size = 180, lit = false, focused = true }: { size?: number; lit?: boolean; focused?: boolean }) {
  const reduce = useReducedMotion();
  const warm = useSharedValue(lit ? 1 : 0); // gold rim crossfade + seam slivers + cap wash

  // Mount the lit layer only while lit (+ a fade tail) so unlit stays a clean cold silhouette.
  const [litMounted, setLitMounted] = useState(lit);
  useEffect(() => {
    if (lit) {
      setLitMounted(true);
      return;
    }
    const t = setTimeout(() => setLitMounted(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: skip the crossfade and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(warm);
    if (lit) {
      warm.value = still ? 1 : withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) });
    } else {
      warm.value = still ? 0 : withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(warm); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="bpCapWash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFB25E" stopOpacity={0.4} />
          <Stop offset="100%" stopColor="#FFB25E" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* ===== STONE SIGNAL PLATFORM (y 78..94): dry-stone pedestal, cap course + two block courses ===== */}
      <Path d="M23 78 L77 78 L78.5 82.5 L21.5 82.5 Z" fill={STONE_CAP} />
      <Path d="M64 78 L77 78 L78.5 82.5 L64.5 82.5 Z" fill={STONE} />
      <Path d="M21.5 82.5 L78.5 82.5 L80 94 L20 94 Z" fill={STONE} />
      <Path d="M64.5 82.5 L78.5 82.5 L80 94 L65 94 Z" fill={STONE_DK} />
      {/* joint lines, staggered like laid blocks */}
      <G stroke={JOINT} strokeWidth="0.6" opacity={0.85}>
        <Line x1="21.5" y1="82.5" x2="78.5" y2="82.5" />
        <Line x1="20.8" y1="88.2" x2="79.2" y2="88.2" />
        <Line x1="33" y1="78.4" x2="33" y2="82.3" />
        <Line x1="50" y1="78.4" x2="50" y2="82.3" />
        <Line x1="67" y1="78.4" x2="67" y2="82.3" />
        <Line x1="27" y1="82.7" x2="27" y2="88" />
        <Line x1="40.5" y1="82.7" x2="40.5" y2="88" />
        <Line x1="54" y1="82.7" x2="54" y2="88" />
        <Line x1="68" y1="82.7" x2="68" y2="88" />
        <Line x1="33.5" y1="88.4" x2="33.5" y2="93.7" />
        <Line x1="50" y1="88.4" x2="50" y2="93.7" />
        <Line x1="66.5" y1="88.4" x2="66.5" y2="93.7" />
      </G>
      {/* snow dusting along the cap */}
      <Line x1="24" y1="78.55" x2="76" y2="78.55" stroke={SNOW_BRIGHT} strokeWidth="1" strokeLinecap="round" opacity={0.8} />
      {/* contact shadow under the stack */}
      <Ellipse cx="50" cy="78.7" rx="25" ry="1.8" fill="#0B1120" opacity={0.5} />

      {/* Iron signal stake behind the stack (character detail): base hidden by the lower courses */}
      <Rect x="70.8" y="49" width="1.8" height="29" rx="0.9" fill={IRON} />
      <Circle cx="71.7" cy="48" r="1.7" fill="none" stroke={IRON} strokeWidth="1.1" />
      <Line x1="70.9" y1="49.4" x2="72.5" y2="49.4" stroke={SNOW} strokeWidth="0.6" strokeLinecap="round" opacity={0.8} />

      {/* ===== THE PYRE (y ~41..78): neat crib stack, side-on courses behind, sawn ends in front ===== */}
      {sideLog(LOG_LOWER.x, LOG_LOWER.y, LOG_LOWER.w, LOG_LOWER.h, WOOD_DK, 'logLower')}
      {sideLog(LOG_UPPER.x, LOG_UPPER.y, LOG_UPPER.w, LOG_UPPER.h, WOOD, 'logUpper')}
      {/* short frame poles leaning up the crown's sides (behind the crown ends) */}
      {FRAME_POLES.map((p, i) => (
        <G key={`fp${i}`} transform={`rotate(${p.rot} ${p.px} ${p.py})`}>
          <Rect x={p.px - p.w / 2} y={p.py - p.len} width={p.w} height={p.len} rx={p.w / 2} fill={WOOD_DK} />
          <Line x1={p.px} y1={p.py - p.len + 3} x2={p.px} y2={p.py - 3} stroke={BARK_EDGE} strokeWidth="0.5" opacity={0.5} />
        </G>
      ))}
      {ROW_BASE.xs.map((cx, i) => cutEnd(cx, ROW_BASE.cy, ROW_BASE.r, `base${i}`))}
      {ROW_MID.xs.map((cx, i) => cutEnd(cx, ROW_MID.cy, ROW_MID.r, `mid${i}`))}
      {CROWN_ENDS.map((e, i) => cutEnd(e.cx, e.cy, e.r, `crown${i}`))}

      {/* Snow-silver rim light on every top edge (the unlit silhouette read; pure static) */}
      {rimHighlights(SNOW)}

      {/* Lit: the rims warm to gold, seams glow through the cracks, a soft wash falls on the cap */}
      {litMounted && (
        <Fade op={warm}>
          <Rect x="23" y="78" width="54" height="4.5" fill="url(#bpCapWash)" />
          {GAP_SLIVERS.map((s, i) => (
            <Rect key={`gs${i}`} x={s.cx - 0.8} y={s.cy - s.h / 2} width="1.6" height={s.h} rx="0.8" fill={EMBER_SLIVER} />
          ))}
          {rimHighlights(GOLD_RIM)}
        </Fade>
      )}
    </Svg>
  );
}
