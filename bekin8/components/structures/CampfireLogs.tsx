// components/structures/CampfireLogs.tsx
// The Campfire skin's tap target: a storybook LOG TEEPEE on a stone fire ring, big and instantly
// readable against the dark clearing. Six crossed logs (cut ends visible at the top) lean to an apex
// at y=46. FLAME SEAT: the registry origin is 0.62 (INSIDE the teepee, where the log spread matches
// the flame's base width) per the cone-from-wood rule; the apex and upper logs burn inside the
// flame rather than poking out under a floating one. Unlit: a pure
// static silhouette, moonlit rim highlights along each log's upper edge only (nothing pulses, no
// glow). Lit: a warm duplicate of the logs fades in over the moonlit one (single opacity crossfade),
// so the rims warm from moon-silver to firelight orange; the big firelight glow itself comes from
// the Skia flame layer above, never from a blob in here. Authored 0..100; 180x180 footprint.
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

// Wood palette (warm browns, back pair darkest for depth)
const BARK_BACK = '#57402A';
const BARK_MID = '#6B4A2F';
const BARK_FRONT = '#8A5A36';
const BARK_DARK = '#3E2A18'; // bark texture strokes + shaded undersides
const RIM_MOON = '#B58254'; // moonlit upper-edge highlight
const RIM_FIRE = '#FFB35C'; // the same edges once firelight hits them
const CUT = '#C1935F'; // pale cut-end face
const CUT_WARM = '#E8A968';
// Stone ring
const STONE_BACK = '#3A4150';
const STONE_FRONT = '#4A5266';
const STONE_HI = '#5D6579';
const STONE_HI_BACK = '#4C5364';

// One teepee log: ground pivot (bx, by), leaned by rot degrees, trunk of len x w. Rendered as a
// rotated capsule so the cut-end circle at the tip stays a clean face. fill/warmFill are the
// unlit/lit wood tones.
type LogSpec = { bx: number; by: number; rot: number; len: number; w: number; fill: string; warmFill: string };

// Back to front. Tips land around (47..53, 42..48), cradling the flame base at (50, 46).
const BACK_LOGS: LogSpec[] = [
  { bx: 21, by: 83, rot: 41, len: 52, w: 6.5, fill: BARK_BACK, warmFill: '#6E4526' },
  { bx: 79, by: 83, rot: -41, len: 52, w: 6.5, fill: BARK_BACK, warmFill: '#6E4526' },
];
const MID_LOGS: LogSpec[] = [
  { bx: 14, by: 86, rot: 44, len: 56, w: 8, fill: BARK_MID, warmFill: '#7E5230' },
  { bx: 86, by: 86, rot: -44, len: 56, w: 8, fill: BARK_MID, warmFill: '#7E5230' },
];
const FRONT_LOGS: LogSpec[] = [
  { bx: 30, by: 88, rot: 26, len: 51, w: 9, fill: BARK_FRONT, warmFill: '#9A6238' },
  { bx: 70, by: 88, rot: -26, len: 51, w: 9, fill: BARK_FRONT, warmFill: '#9A6238' },
];

type StoneSpec = { cx: number; cy: number; rx: number; ry: number; fill: string; hi: string };
const BACK_STONES: StoneSpec[] = [
  { cx: 30, cy: 81, rx: 5, ry: 3.2, fill: STONE_BACK, hi: STONE_HI_BACK },
  { cx: 50, cy: 80.5, rx: 5.5, ry: 3.4, fill: STONE_BACK, hi: STONE_HI_BACK },
  { cx: 70, cy: 81, rx: 5, ry: 3.2, fill: STONE_BACK, hi: STONE_HI_BACK },
];
const FRONT_STONES: StoneSpec[] = [
  { cx: 11, cy: 88, rx: 6, ry: 4, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 26, cy: 90, rx: 7, ry: 4.2, fill: '#434B5D', hi: STONE_HI },
  { cx: 41.5, cy: 90.5, rx: 7.5, ry: 4, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 58, cy: 90.5, rx: 7.5, ry: 4, fill: '#454D60', hi: STONE_HI },
  { cx: 74, cy: 90, rx: 7, ry: 4.2, fill: STONE_FRONT, hi: STONE_HI },
  { cx: 89, cy: 88, rx: 6, ry: 4, fill: '#434B5D', hi: STONE_HI },
];

// A rounded fire-ring stone with a top highlight so the greys read in moonlight.
function Stone({ s }: { s: StoneSpec }) {
  return (
    <>
      <Ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} />
      <Ellipse cx={s.cx - s.rx * 0.18} cy={s.cy - s.ry * 0.42} rx={s.rx * 0.6} ry={s.ry * 0.38} fill={s.hi} opacity={0.85} />
    </>
  );
}

// A leaning log: capsule trunk, bark strokes, shaded underside, rim highlight along the upper edge,
// and the pale cut-end face at the tip. The same geometry renders twice (moonlit base + warm lit
// copy) so the crossfade never misaligns.
function Trunk({ l, warm = false }: { l: LogSpec; warm?: boolean }) {
  const side = l.rot > 0 ? -1 : 1; // upper (moon-facing) edge: left side of "/" logs, right of "\"
  const topY = l.by - l.len;
  const edgeX = l.bx + side * (l.w / 2 - 0.9);
  const cutR = l.w / 2 - 0.4;
  return (
    <G transform={`rotate(${l.rot} ${l.bx} ${l.by})`}>
      <Rect x={l.bx - l.w / 2} y={topY} width={l.w} height={l.len + 3} rx={l.w / 2} fill={warm ? l.warmFill : l.fill} />
      {/* bark texture */}
      <Line x1={l.bx - l.w * 0.18} y1={topY + 6} x2={l.bx - l.w * 0.18} y2={l.by - 4} stroke={BARK_DARK} strokeWidth={0.55} opacity={0.7} />
      <Line x1={l.bx + l.w * 0.22} y1={topY + 8} x2={l.bx + l.w * 0.22} y2={l.by - 6} stroke={BARK_DARK} strokeWidth={0.5} opacity={0.5} />
      {/* shaded underside edge for silhouette depth */}
      <Line x1={l.bx - side * (l.w / 2 - 0.8)} y1={topY + 5} x2={l.bx - side * (l.w / 2 - 0.8)} y2={l.by - 3} stroke={BARK_DARK} strokeWidth={1} opacity={0.55} />
      {/* rim highlight along the upper edge (moon-silver unlit, firelight in the warm copy) */}
      <Line x1={edgeX} y1={topY + l.w + 1.5} x2={edgeX} y2={l.by - 5} stroke={warm ? RIM_FIRE : RIM_MOON} strokeWidth={warm ? 1.25 : 1.1} strokeLinecap="round" opacity={0.9} />
      {/* cut end at the tip */}
      <Circle cx={l.bx} cy={topY + l.w / 2} r={cutR} fill={warm ? CUT_WARM : CUT} stroke={BARK_DARK} strokeWidth={0.6} />
      <Circle cx={l.bx} cy={topY + l.w / 2} r={cutR * 0.45} fill="none" stroke={warm ? '#B57E44' : '#8A5A36'} strokeWidth={0.5} opacity={0.8} />
    </G>
  );
}

// Opacity-animated group (same pattern as the tower's lanterns: mounted only while relevant, with a
// fade tail, so hooks stay inside a stable subcomponent).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function CampfireLogs({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const warmOp = useSharedValue(lit ? 1 : 0); // firelight crossfade (lit only)

  // Mount the warm overlay only while lit, with a fade tail, so unlit is unambiguously cold wood.
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
    // Blur acts like reduced motion: skip the crossfade and pin static values while covered.
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
      {/* Ground shadow seats the whole structure in the clearing */}
      <Ellipse cx="50" cy="89" rx="42" ry="8" fill="#0E1220" opacity={0.4} />

      {/* Fire ring, far side */}
      {BACK_STONES.map((s, i) => <Stone key={`bs${i}`} s={s} />)}

      {/* Back pair of logs */}
      {BACK_LOGS.map((l, i) => <Trunk key={`bl${i}`} l={l} />)}

      {/* Kindling twigs inside the ring */}
      <Line x1="40" y1="79.5" x2="57" y2="76" stroke="#4E3520" strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="43" y1="82" x2="60" y2="79.5" stroke={BARK_MID} strokeWidth={1.3} strokeLinecap="round" />
      <Line x1="38" y1="82.5" x2="48" y2="84" stroke="#5A3E24" strokeWidth={1.2} strokeLinecap="round" />

      {/* Mid + front pairs; cut ends cluster at the apex to cradle the flame base (seat y=46) */}
      {MID_LOGS.map((l, i) => <Trunk key={`ml${i}`} l={l} />)}
      {FRONT_LOGS.map((l, i) => <Trunk key={`fl${i}`} l={l} />)}

      {/* Lit: the warm log copy fades in over the moonlit one (edge warmth only, no glow blob) */}
      {warming && (
        <Fade op={warmOp}>
          {BACK_LOGS.map((l, i) => <Trunk key={`wbl${i}`} l={l} warm />)}
          {MID_LOGS.map((l, i) => <Trunk key={`wml${i}`} l={l} warm />)}
          {FRONT_LOGS.map((l, i) => <Trunk key={`wfl${i}`} l={l} warm />)}
        </Fade>
      )}

      {/* Fire ring, near side (always in front so the ring stays crisp) */}
      {FRONT_STONES.map((s, i) => <Stone key={`fs${i}`} s={s} />)}
    </Svg>
  );
}
