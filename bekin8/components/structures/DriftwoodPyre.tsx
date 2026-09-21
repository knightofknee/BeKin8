// components/structures/DriftwoodPyre.tsx
// The Lakeshore skin's tap target (the DEFAULT skin): a teepee of sun-bleached DRIFTWOOD on a ring
// of smooth beach stones, flanked by two sitting logs. The empty seats are the point: an unlit
// fire with places kept for friends. Pale silvery wood (not the campfire's warm brown) so the two
// log skins never read as the same object. FLAME SEAT: the registry origin is 0.62 (seat y=62,
// INSIDE the teepee where the log spread is ~32 units wide, matching the flame's base per the
// cone-from-wood rule); the apex and upper wood burn inside the flame. Unlit: static silhouette
// with cool moonlit rim highlights only (nothing pulses, no glow). Lit: a warm duplicate of the
// wood crossfades in over the moonlit one; the firelight itself comes from the Skia flame layer
// above, never from a blob in here. Authored 0..100; 180x180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Ellipse, Rect, Circle, Line, G } from 'react-native-svg';
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

// Driftwood palette: grey-tan, back darkest; warm copies for the lit crossfade.
const WOOD_BACK = '#5E5748';
const WOOD_MID = '#7C7260';
const WOOD_FRONT = '#9A8E76';
const WOOD_DARK = '#2E2A22'; // grain strokes + shaded undersides
const RIM_MOON = '#C2D0E0'; // cool lakeside moonlight on the upper edges
const RIM_FIRE = '#FFB35C';
const CUT = '#C9BCA0'; // pale cut-end face
const CUT_WARM = '#E8C08A';
// Smooth beach stones (cool slate, wet-looking pale tops)
const STONE_BACK = '#39404E';
const STONE_FRONT = '#485065';
const STONE_HI = '#5E6880';
const STONE_HI_BACK = '#4A5262';

// One teepee log: ground pivot (bx, by), leaned by rot degrees, capsule trunk len x w. `fork` adds
// a stubby driftwood branch partway up (bleached wood is gnarled, not clean lumber).
type LogSpec = { bx: number; by: number; rot: number; len: number; w: number; fill: string; warmFill: string; fork?: boolean };

// Back to front. Tips cross around (46..54, 42..47); seat line y=62 spans ~x34..x66.
const BACK_LOGS: LogSpec[] = [
  { bx: 22, by: 83, rot: 38, len: 50, w: 6, fill: WOOD_BACK, warmFill: '#77543A' },
  { bx: 78, by: 83, rot: -38, len: 50, w: 6, fill: WOOD_BACK, warmFill: '#77543A' },
];
const MID_LOGS: LogSpec[] = [
  { bx: 12, by: 86, rot: 47, len: 58, w: 7.5, fill: WOOD_MID, warmFill: '#8F6242', fork: true },
  { bx: 88, by: 86, rot: -47, len: 58, w: 7.5, fill: WOOD_MID, warmFill: '#8F6242' },
];
const FRONT_LOGS: LogSpec[] = [
  { bx: 31, by: 88, rot: 24, len: 50, w: 8.5, fill: WOOD_FRONT, warmFill: '#AC7448', fork: true },
  { bx: 69, by: 88, rot: -24, len: 50, w: 8.5, fill: WOOD_FRONT, warmFill: '#AC7448' },
];

type StoneSpec = { cx: number; cy: number; rx: number; ry: number; fill: string; hi: string };
const BACK_STONES: StoneSpec[] = [
  { cx: 31, cy: 80.5, rx: 5, ry: 3.4, fill: STONE_BACK, hi: STONE_HI_BACK },
  { cx: 50, cy: 80, rx: 5.5, ry: 3.6, fill: STONE_BACK, hi: STONE_HI_BACK },
  { cx: 69, cy: 80.5, rx: 5, ry: 3.4, fill: STONE_BACK, hi: STONE_HI_BACK },
];
const FRONT_STONES: StoneSpec[] = [
  { cx: 13, cy: 88, rx: 6, ry: 4.2, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 27, cy: 90, rx: 7, ry: 4.4, fill: '#414958', hi: STONE_HI },
  { cx: 42, cy: 90.5, rx: 7.5, ry: 4.2, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 58, cy: 90.5, rx: 7.5, ry: 4.2, fill: '#434B5B', hi: STONE_HI },
  { cx: 73, cy: 90, rx: 7, ry: 4.4, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 87, cy: 88, rx: 6, ry: 4.2, fill: '#414958', hi: STONE_HI },
];

// A smooth beach stone: rounded body + pale top so the greys read in moonlight.
function Stone({ s }: { s: StoneSpec }) {
  return (
    <>
      <Ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} />
      <Ellipse cx={s.cx - s.rx * 0.15} cy={s.cy - s.ry * 0.45} rx={s.rx * 0.62} ry={s.ry * 0.4} fill={s.hi} opacity={0.85} />
    </>
  );
}

// A leaning driftwood log: capsule trunk, grain strokes, shaded underside, rim highlight along the
// upper edge, pale cut-end face at the tip, optional fork stub. The same geometry renders twice
// (moonlit base + warm lit copy) so the crossfade never misaligns.
function Trunk({ l, warm = false }: { l: LogSpec; warm?: boolean }) {
  const side = l.rot > 0 ? -1 : 1; // moon-facing upper edge
  const topY = l.by - l.len;
  const edgeX = l.bx + side * (l.w / 2 - 0.9);
  const cutR = l.w / 2 - 0.4;
  const forkY = topY + l.len * 0.32;
  return (
    <G transform={`rotate(${l.rot} ${l.bx} ${l.by})`}>
      <Rect x={l.bx - l.w / 2} y={topY} width={l.w} height={l.len + 3} rx={l.w / 2} fill={warm ? l.warmFill : l.fill} />
      {l.fork && (
        <Rect
          x={l.bx - 1.1}
          y={forkY}
          width={2.2}
          height={10}
          rx={1.1}
          transform={`rotate(${-side * 38} ${l.bx} ${forkY})`}
          fill={warm ? l.warmFill : l.fill}
        />
      )}
      {/* weathered grain */}
      <Line x1={l.bx - l.w * 0.18} y1={topY + 6} x2={l.bx - l.w * 0.18} y2={l.by - 4} stroke={WOOD_DARK} strokeWidth={0.55} opacity={0.6} />
      <Line x1={l.bx + l.w * 0.22} y1={topY + 9} x2={l.bx + l.w * 0.22} y2={l.by - 7} stroke={WOOD_DARK} strokeWidth={0.5} opacity={0.45} />
      {/* shaded underside edge for silhouette depth */}
      <Line x1={l.bx - side * (l.w / 2 - 0.8)} y1={topY + 5} x2={l.bx - side * (l.w / 2 - 0.8)} y2={l.by - 3} stroke={WOOD_DARK} strokeWidth={1} opacity={0.55} />
      {/* rim highlight along the upper edge (moon-silver unlit, firelight in the warm copy) */}
      <Line x1={edgeX} y1={topY + l.w + 1.5} x2={edgeX} y2={l.by - 5} stroke={warm ? RIM_FIRE : RIM_MOON} strokeWidth={warm ? 1.25 : 1.05} strokeLinecap="round" opacity={0.85} />
      {/* cut end at the tip */}
      <Circle cx={l.bx} cy={topY + l.w / 2} r={cutR} fill={warm ? CUT_WARM : CUT} stroke={WOOD_DARK} strokeWidth={0.6} />
      <Circle cx={l.bx} cy={topY + l.w / 2} r={cutR * 0.45} fill="none" stroke={warm ? '#B58A50' : '#8F846C'} strokeWidth={0.5} opacity={0.8} />
    </G>
  );
}

// A sitting log beside the fire: a low horizontal driftwood trunk with a cut end facing the pyre
// and a rim highlight along its top. rot leans it slightly into the scene; endX is the fire-facing
// cut face.
type BenchSpec = { x: number; y: number; len: number; h: number; rot: number; px: number; py: number; endX: number };
const BENCHES: BenchSpec[] = [
  { x: 6, y: 83, len: 23, h: 5.4, rot: -4, px: 17, py: 85.5, endX: 29 },
  { x: 71, y: 84.5, len: 23, h: 5.4, rot: 4, px: 83, py: 87, endX: 71 },
];

function Bench({ b, warm = false }: { b: BenchSpec; warm?: boolean }) {
  return (
    <G transform={`rotate(${b.rot} ${b.px} ${b.py})`}>
      <Rect x={b.x} y={b.y} width={b.len} height={b.h} rx={b.h / 2} fill={warm ? '#9A6F46' : '#8A7F68'} />
      <Line x1={b.x + 2.5} y1={b.y + 1.1} x2={b.x + b.len - 2.5} y2={b.y + 1.1} stroke={warm ? RIM_FIRE : RIM_MOON} strokeWidth={1} strokeLinecap="round" opacity={0.8} />
      <Line x1={b.x + 3} y1={b.y + b.h - 1} x2={b.x + b.len - 3} y2={b.y + b.h - 1} stroke={WOOD_DARK} strokeWidth={0.8} opacity={0.55} />
      <Circle cx={b.endX} cy={b.y + b.h / 2} r={b.h / 2 - 0.4} fill={warm ? CUT_WARM : CUT} stroke={WOOD_DARK} strokeWidth={0.6} />
      <Circle cx={b.endX} cy={b.y + b.h / 2} r={(b.h / 2 - 0.4) * 0.45} fill="none" stroke={warm ? '#B58A50' : '#8F846C'} strokeWidth={0.5} opacity={0.8} />
    </G>
  );
}

// Opacity-animated group (same pattern as the other structures: mounted only while relevant, with
// a fade tail, so hooks stay inside a stable subcomponent).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function DriftwoodPyre({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const warmOp = useSharedValue(lit ? 1 : 0);

  // Mount the warm overlay only while lit (+ fade tail) so unlit is unambiguously cold wood.
  const [warming, setWarming] = useState(lit);
  useEffect(() => {
    if (lit) {
      setWarming(true);
      return;
    }
    const t = setTimeout(() => setWarming(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    const still = reduce || !focused;
    cancelAnimation(warmOp);
    if (lit) {
      warmOp.value = still ? 1 : withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) });
    } else {
      warmOp.value = still ? 0 : withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(warmOp); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Ground shadow seats the whole site on the shingle */}
      <Ellipse cx="50" cy="89" rx="45" ry="8" fill="#0A0E16" opacity={0.45} />

      {/* Fire ring, far side */}
      {BACK_STONES.map((s, i) => <Stone key={`bs${i}`} s={s} />)}

      {/* Back pair of logs */}
      {BACK_LOGS.map((l, i) => <Trunk key={`bl${i}`} l={l} />)}

      {/* Kindling inside the ring */}
      <Line x1="40" y1="79" x2="57" y2="75.5" stroke="#4A4132" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="43" y1="81.5" x2="60" y2="79" stroke={WOOD_MID} strokeWidth={1.3} strokeLinecap="round" />
      <Line x1="38" y1="82" x2="48" y2="83.5" stroke="#575043" strokeWidth={1.2} strokeLinecap="round" />

      {/* Mid + front pairs; cut ends cluster at the apex, the seat sits inside the stack (y=62) */}
      {MID_LOGS.map((l, i) => <Trunk key={`ml${i}`} l={l} />)}
      {FRONT_LOGS.map((l, i) => <Trunk key={`fl${i}`} l={l} />)}

      {/* The two sitting logs: seats kept by the fire, waiting to be filled */}
      {BENCHES.map((b, i) => <Bench key={`bn${i}`} b={b} />)}

      {/* Lit: warm copies crossfade in over the moonlit wood (edge warmth only, no glow blob) */}
      {warming && (
        <Fade op={warmOp}>
          {BACK_LOGS.map((l, i) => <Trunk key={`wbl${i}`} l={l} warm />)}
          {MID_LOGS.map((l, i) => <Trunk key={`wml${i}`} l={l} warm />)}
          {FRONT_LOGS.map((l, i) => <Trunk key={`wfl${i}`} l={l} warm />)}
          {BENCHES.map((b, i) => <Bench key={`wbn${i}`} b={b} warm />)}
        </Fade>
      )}

      {/* Fire ring, near side (always in front so the ring stays crisp) */}
      {FRONT_STONES.map((s, i) => <Stone key={`fs${i}`} s={s} />)}
    </Svg>
  );
}
