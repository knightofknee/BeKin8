// components/structures/SignalFireRing.tsx
// The Smoke Signal skin's tap target: a high-desert SIGNAL FIRE at golden hour, southwest graphic
// style, redrawn to read instantly at a glance. A LARGE ring of eight chunky terracotta boulders
// (ring ellipse roughly x 24..76, y 60..82) circles a big crossed-log fire lay. The lay's top tips
// still cross at (50, 58), but the REGISTRY ORIGIN IS 0.63: the full-screen Skia flame emerges
// lower, at wood width (y=63), so the crossed tips at (50, 58) burn INSIDE the flame cone rather
// than sitting under it. DO NOT redraw the lay and DO NOT move the tips; the registry seat owns
// where the flame sits. The structure is now just the stone ring + crossed-log lay + ground shadow;
// the teepee dwelling that tells the story lives in SmokeSignalScene, next to the fire.
// Unlit is fully static: silhouette plus warm sun-side highlights carry the "this can be lit" read.
// No pulsing, no glow orbs. Lit adds a steady (non-animated) warm wash over the stones and ground;
// the only animation left is the one-shot fade when lit toggles, and reduced motion or blur pins it.
// Authored 0..100; 180x180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, RadialGradient, Stop, Ellipse, Rect, Circle, Line, Path, G } from 'react-native-svg';
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

// Desert stone palette (terracotta/umber, low golden sun from the left)
const STONE_WARM = '#6E4A3A';
const STONE_DEEP = '#4A2E26';
const STONE_MID = '#5E3E30';
const STONE_SUN = '#9C6A4E'; // sun-side highlight
const STONE_SHADE = '#3A241D'; // settled-base shading
// Dry wood
const WOOD = '#6B4530';
const WOOD_BACK = '#4A3020';
const WOOD_DARK = '#3A241A'; // bark strokes + shaded edges
const WOOD_RIM = '#E0A268'; // golden-hour rim light
const WOOD_CUT = '#C79A66'; // pale cut-end face
// Lit warmth (steady, no pulsing)
const LIT_FACE = '#FFAA5C';

const n = (v: number) => Math.round(v * 100) / 100;

// One ring boulder: an irregular chunky silhouette (not a plain ellipse) so each stone reads as its
// own rock. k in -1..1 skews the top bump for shape variety.
type StoneSpec = { cx: number; cy: number; rx: number; ry: number; fill: string; hiOp: number; k: number };

function boulderPath({ cx, cy, rx, ry, k }: StoneSpec): string {
  return [
    `M ${n(cx - rx * 0.92)} ${n(cy + ry * 0.5)}`,
    `Q ${n(cx - rx * 1.1)} ${n(cy - ry * 0.25)} ${n(cx - rx * 0.55 + k * rx * 0.12)} ${n(cy - ry * 0.85)}`,
    `Q ${n(cx + k * rx * 0.22)} ${n(cy - ry * 1.18)} ${n(cx + rx * 0.58 + k * rx * 0.1)} ${n(cy - ry * 0.72)}`,
    `Q ${n(cx + rx * 1.1)} ${n(cy - ry * 0.08)} ${n(cx + rx * 0.86)} ${n(cy + ry * 0.55)}`,
    `Q ${n(cx + rx * 0.4)} ${n(cy + ry * 1.08)} ${n(cx - rx * 0.34)} ${n(cy + ry * 1.02)}`,
    `Q ${n(cx - rx * 0.94)} ${n(cy + ry * 0.92)} ${n(cx - rx * 0.92)} ${n(cy + ry * 0.5)}`,
    'Z',
  ].join(' ');
}

// The ring reads as an ellipse centered near (50, 71): back arc high and smaller, sides at the full
// x 24..76 width, front arc low and biggest.
const BACK_STONES: StoneSpec[] = [
  { cx: 36, cy: 63.5, rx: 5.4, ry: 3.0, fill: STONE_DEEP, hiOp: 0.5, k: -0.6 },
  { cx: 50, cy: 63, rx: 5.8, ry: 3.0, fill: STONE_MID, hiOp: 0.55, k: 0.3 },
  { cx: 64, cy: 63.5, rx: 5.4, ry: 3.0, fill: STONE_DEEP, hiOp: 0.5, k: 0.7 },
];
const SIDE_STONES: StoneSpec[] = [
  { cx: 29.6, cy: 70.5, rx: 5.6, ry: 3.7, fill: STONE_WARM, hiOp: 0.85, k: 0.5 },
  { cx: 70.4, cy: 70.5, rx: 5.6, ry: 3.7, fill: STONE_MID, hiOp: 0.6, k: -0.4 },
];
const FRONT_STONES: StoneSpec[] = [
  { cx: 37.5, cy: 77.5, rx: 6.6, ry: 4.2, fill: STONE_WARM, hiOp: 0.9, k: -0.3 },
  { cx: 50.5, cy: 78.4, rx: 7.0, ry: 4.1, fill: '#654234', hiOp: 0.9, k: 0.6 },
  { cx: 63, cy: 77.3, rx: 6.4, ry: 4.0, fill: STONE_WARM, hiOp: 0.85, k: -0.7 },
];
const ALL_STONES: StoneSpec[] = [...BACK_STONES, ...SIDE_STONES, ...FRONT_STONES];

function Stone({ s }: { s: StoneSpec }) {
  const hx = n(s.cx - s.rx * 0.3);
  const hy = n(s.cy - s.ry * 0.42);
  return (
    <>
      <Path d={boulderPath(s)} fill={s.fill} />
      {/* settled base shading */}
      <Ellipse cx={n(s.cx + s.rx * 0.12)} cy={n(s.cy + s.ry * 0.58)} rx={n(s.rx * 0.68)} ry={n(s.ry * 0.34)} fill={STONE_SHADE} opacity={0.35} />
      {/* sun-side facet, low golden sun from the left */}
      <G transform={`rotate(-14 ${hx} ${hy})`}>
        <Ellipse cx={hx} cy={hy} rx={n(s.rx * 0.5)} ry={n(s.ry * 0.4)} fill={STONE_SUN} opacity={s.hiOp} />
      </G>
    </>
  );
}

// One fire-lay log: ground pivot (bx, by), leaned by rot degrees, capsule of len x w, with a golden
// rim line on the sun side and a pale cut-end face at the tip. The two pairs cross so the tips
// cluster at (50, 58); the registry origin is 0.63, so the flame cone emerges from within the lay
// and the crossed tips burn inside the flame.
type StickSpec = { bx: number; by: number; rot: number; len: number; w: number; fill: string };

// tip = (bx + len*sin(rot), by - len*cos(rot)); all four land within ~1 unit of (50, 58), which now
// sits inside the flame cone (the flame's seat is lower, at y=63).
const BACK_STICKS: StickSpec[] = [
  { bx: 42.2, by: 72.4, rot: 26, len: 16, w: 3.2, fill: WOOD_BACK },
  { bx: 57.8, by: 72.4, rot: -26, len: 16, w: 3.2, fill: WOOD_BACK },
];
const FRONT_STICKS: StickSpec[] = [
  { bx: 39, by: 73.8, rot: 34, len: 19, w: 4, fill: WOOD },
  { bx: 61, by: 73.8, rot: -34, len: 19, w: 4, fill: WOOD },
];

function Stick({ s }: { s: StickSpec }) {
  const topY = s.by - s.len;
  const left = s.bx - s.w / 2;
  const right = s.bx + s.w / 2;
  return (
    <G transform={`rotate(${s.rot} ${s.bx} ${s.by})`}>
      <Rect x={left} y={topY} width={s.w} height={s.len + 3} rx={s.w / 2} fill={s.fill} />
      {/* shaded away-side edge */}
      <Line x1={right - 0.6} y1={topY + 3.4} x2={right - 0.6} y2={s.by} stroke={WOOD_DARK} strokeWidth={0.9} opacity={0.6} />
      {/* bark crack down the middle */}
      <Line x1={s.bx + 0.2} y1={topY + s.w + 2} x2={s.bx - 0.3} y2={s.by - 3} stroke={WOOD_DARK} strokeWidth={0.5} opacity={0.5} />
      {/* golden-hour rim on the sun side */}
      <Line x1={left + 0.7} y1={topY + s.w + 0.8} x2={left + 0.7} y2={s.by - 1.5} stroke={WOOD_RIM} strokeWidth={0.9} strokeLinecap="round" opacity={0.9} />
      {/* pale cut end at the tip */}
      <Circle cx={s.bx} cy={topY + s.w / 2} r={s.w / 2 - 0.35} fill={WOOD_CUT} stroke={WOOD_DARK} strokeWidth={0.45} />
    </G>
  );
}

// Steady warm facet on a stone's fire-facing side while lit (part of the static warm wash).
function WarmFacet({ s }: { s: StoneSpec }) {
  const dx = 50 - s.cx;
  const dy = 69 - s.cy;
  const d = Math.hypot(dx, dy) || 1;
  return (
    <Ellipse
      cx={n(s.cx + (dx / d) * s.rx * 0.4)}
      cy={n(s.cy + (dy / d) * s.ry * 0.5)}
      rx={n(s.rx * 0.55)}
      ry={n(s.ry * 0.42)}
      fill={LIT_FACE}
      opacity={0.42}
    />
  );
}

// Opacity-animated group (same pattern as the sibling structures: mounted only while relevant, with
// a fade tail, so hooks stay inside a stable subcomponent).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function SignalFireRing({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const warmOp = useSharedValue(lit ? 1 : 0); // steady warm wash (lit only)

  // Mount the warm overlay only while lit, with a fade tail on the way out.
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
    // Blur acts like reduced motion: skip the fade transition and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(warmOp);
    if (still) {
      warmOp.value = lit ? 1 : 0;
      return;
    }
    warmOp.value = lit
      ? withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) })
      : withTiming(0, { duration: 420 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(warmOp); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="sfrWash" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFB35C" stopOpacity={0.34} />
          <Stop offset="55%" stopColor="#FF8A2A" stopOpacity={0.16} />
          <Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* Warm ground shadow seats the station on the mesa */}
      <Ellipse cx="51" cy="82.5" rx="43" ry="7.5" fill="#2A1712" opacity={0.4} />

      {/* Stone ring: far arc, then the two side stones at full width */}
      {BACK_STONES.map((s, i) => <Stone key={`bs${i}`} s={s} />)}
      {SIDE_STONES.map((s, i) => <Stone key={`ss${i}`} s={s} />)}

      {/* Chunky kindling logs lying inside the ring */}
      <G transform="rotate(-4 50 72)">
        <Rect x={42.5} y={70.8} width={15} height={3} rx={1.5} fill={WOOD_BACK} />
        <Circle cx={57.3} cy={72.3} r={1.25} fill={WOOD_CUT} stroke={WOOD_DARK} strokeWidth={0.35} />
      </G>
      <G transform="rotate(3 50 74)">
        <Rect x={44} y={73} width={13} height={2.6} rx={1.3} fill={WOOD_DARK} />
        <Circle cx={44.4} cy={74.3} r={1.1} fill={WOOD_CUT} stroke={WOOD_DARK} strokeWidth={0.3} />
      </G>

      {/* Crossed-log fire lay; the tips cross at (50, 58) and burn inside the flame cone, which
          emerges lower at wood width (registry origin 0.63 puts the flame seat at y=63) */}
      {BACK_STICKS.map((s, i) => <Stick key={`bk${i}`} s={s} />)}
      {FRONT_STICKS.map((s, i) => <Stick key={`fk${i}`} s={s} />)}

      {/* Stone ring, near arc (always in front so the fire lay sits inside the ring) */}
      {FRONT_STONES.map((s, i) => <Stone key={`fs${i}`} s={s} />)}

      {/* A couple of small pebbles at the left edge so the ground doesn't read empty */}
      <Ellipse cx="14" cy="82.5" rx="2.4" ry="1.5" fill={STONE_MID} />
      <Ellipse cx="13.4" cy="82.1" rx="1.2" ry="0.65" fill={STONE_SUN} opacity={0.55} />
      <Ellipse cx="20.5" cy="85" rx="1.8" ry="1.1" fill={STONE_DEEP} />
      <Ellipse cx="20" cy="84.7" rx="0.9" ry="0.5" fill={STONE_SUN} opacity={0.4} />

      {/* Lit: steady warm wash over the stones and ground. No pulsing, no glow orbs: a wide flat
          pool of firelight on the dirt plus a fire-facing warm facet on every stone. */}
      {warming && (
        <Fade op={warmOp}>
          <Ellipse cx="50" cy="73.5" rx="35" ry="11.5" fill="url(#sfrWash)" />
          {ALL_STONES.map((s, i) => <WarmFacet key={`wf${i}`} s={s} />)}
        </Fade>
      )}
    </Svg>
  );
}
