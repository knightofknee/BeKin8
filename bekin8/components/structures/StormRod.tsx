// components/structures/StormRod.tsx
// The Storm Caller skin's tap target: a weathered SKY-ALTAR on a dark moor knoll. Research-true
// Franklin hardware sells the premise: a tapered POINTED iron air terminal (vintage rods came
// pointed to enhance ionization, with a small ball partway up the shaft), its tip at EXACTLY
// (50, 14) = the registry origin 0.14 anchor; a BRAIDED down conductor (stranded copper, NFPA 780
// style) lashed to the rod with two collar bands, running down over the plinth's side into the
// ground; a stepped stone plinth (two big flat slabs over a rough base, wet-looking, moss hints)
// on a rocky knoll, base ~y 88. A small bronze rain-drum relic (Dong Son flavor: squat drum, frog
// figure hint on the rim; their boom called rain) leans at the base.
// TIMING CONTRACT (shared with BeaconStormBolt and the storm-ignite clip; t = 0 at the lit edge):
//   0.00-0.55  ST. ELMO'S CHARGE-UP: a corona BRUSH at the tip, 5 tiny flickering blue-violet
//              stroke filaments (research: a brush of blue-violet light; strokes only, no glow
//              ball), fading in and growing slightly over the window
//   0.55-0.62  hold (the bolt layer's stepped leader is descending; its streamer answers 0.52)
//   0.62       RETURN STROKE: the rod flashes WHITE-HOT, a bright stroke overlay along the rod
//              plus hot rim strokes on the slab edges, instant on (the bolt attaches at 0.58,
//              the rod's heat trails it by a beat)
//   0.70/0.88  restrike re-flashes, dimmer each time, fast decays (the strobe feel)
//   1.0-1.6    decay into the steady lit state
// LIT STEADY: the corona brush lives at the tip (filaments flicker in changing subsets, three
// opacity loops at incommensurate periods, the fireworks sparkler precedent) and the braided
// cable carries a faint steady charged shimmer (a thin pale static line highlight). Slab rim
// strokes cool blue. The corona is the readable lit cue and the extinguish target.
// LEGIBILITY GUARDS (user law): no radial glow balls, no pulsing/breathing hints lit or unlit.
// Unlit is a pure static silhouette: cold grey-blue rim light plus STATIC linear wet-sheen
// highlights on the slab tops. All warmth = rim/edge strokes only.
// First mount while already lit, reduce, and blur SKIP the one-shot (steady corona; reduce and
// blur freeze the filaments). Extinguish fades the corona over 400ms.
// Authored 0..100; 180x180 footprint. Fixed hook count (conditional layers mount via state with
// hooks in stable subcomponents); every loop cancels + snaps on blur/reduce (FireworkRocket).
import React, { useEffect, useRef, useState } from 'react';
import Svg, { Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);
const SIN = Easing.inOut(Easing.sin);

// Stone (cold wet slate)
const STONE = '#242B35';
const STONE_LT = '#2E3742';
const STONE_DK = '#161C24';
const CRACK = '#0E141B';
const MOSS = '#39482F';
const MOSS_2 = '#465A3C';
// Iron rod + hardware
const IRON = '#272C35';
const IRON_DK = '#12161C';
const IRON_HI = '#4E5A6C';
const COLLAR = '#2E3540';
const CABLE = '#1E232B';
const CABLE_HI = '#39424F';
// Dong Son bronze (patinated)
const BRONZE = '#33413A';
const BRONZE_LT = '#455649';
const BRONZE_HI = '#6E8266';
const BRONZE_DK = '#202A25';
// Ground
const GROUND = '#10151A';
const ROCK = '#1A2129';
const SHADOW = '#070B10';
// Unlit readability: cold grey-blue rim light + static wet sheen
const RIM_COOL = '#93A6C0';
const SHEEN = '#AFC4DA';
// St. Elmo's corona (blue-violet, strokes only)
const CORONA = '#8F7BFF';
const CORONA_LT = '#B9A8FF';
const CORONA_CORE = '#E9E4FF';
// Lit steady charge
const LIT_RIM = '#7FA0D8';
const CHARGE = '#B9C8F2';
// Return-stroke white-hot flash
const FLASH_HOT = '#FFFFFF';
const FLASH_FRINGE = '#D9D2FF';
const FLASH_EDGE = '#F4F1FF';

// One-shot clock (ms from the lit edge; the ignite clip and the bolt shader share this line:
// corona hiss 0-550, leader 300-550 in the bolt, bolt return stroke 580, rod flash 620,
// bolt restrikes 720/920, rod re-flashes 700/880, rumble from 1000).
const CHARGE_MS = 550;
const RETURN_MS = 620;

// The braided down conductor: exits the upper collar, hugs the rod's right side under the lower
// collar, crosses the slab tops and drops over the plinth's side into the ground at (66.3, 88.4).
const CABLE_D =
  'M51.15 40.2 C51.8 44.5 51.3 50 51.9 55.8 C52.2 59 52.1 62.5 52.5 66.4 ' +
  'C54.8 68.2 60.2 69.3 63.2 71.6 C65.3 73.3 64.9 75.6 65.5 77.8 C66.2 81.2 66.7 84.8 66.3 88.4';
// Short alternating cross ticks along the cable read as braid strands (static, cheap).
const BRAID_TICKS: [number, number, number][] = [
  [51.4, 42.5, 1], [51.7, 45.5, -1], [51.5, 48.5, 1], [51.8, 51.5, -1], [51.95, 54.5, 1],
  [52.2, 58, -1], [52.3, 61.5, 1], [52.45, 64.5, -1], [55.5, 67.7, 1], [59, 69, -1],
  [62.2, 70.9, 1], [64.5, 73.2, -1], [65.2, 75.8, 1], [65.8, 78.9, -1], [66.3, 82.5, 1], [66.5, 85.8, -1],
];

// Opacity crossfade group (CampfireLogs pattern: mounted only while relevant, hooks stay in a
// stable subcomponent).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// ===== THE CORONA BRUSH (St. Elmo's fire at the rod tip) =====
// 5 tiny blue-violet stroke filaments radiating from the tip, flickering in changing subsets:
// three opacity loops over grouped strokes at incommensurate periods (640/720/810ms), so the
// visible subset never settles onto a beat (the fireworks sparkler precedent). A compact bead
// caps the point (sparkler-core precedent, not a halo). `grow` scales the whole brush 0.72 -> 1
// over the charge-up window; `still` (reduce or blur) cancels the loops and pins a mixed subset.
function CoronaBrush({ still, grow }: { still: boolean; grow: SharedValue<number> }) {
  const gA = useSharedValue(0.9);
  const gB = useSharedValue(0.4);
  const gC = useSharedValue(0.7);

  useEffect(() => {
    cancelAnimation(gA);
    cancelAnimation(gB);
    cancelAnimation(gC);
    if (still) {
      gA.value = 0.9;
      gB.value = 0.4;
      gC.value = 0.7;
      return;
    }
    // Each loop lands back on its start value so the repeat is seamless; totals 640/720/810ms
    // share no small common multiple.
    gA.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 170, easing: SIN }),
        withTiming(0.95, { duration: 130, easing: SIN }),
        withTiming(0.4, { duration: 180, easing: SIN }),
        withTiming(0.9, { duration: 160, easing: SIN })
      ),
      -1,
      false
    );
    gB.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 150, easing: SIN }),
        withTiming(0.2, { duration: 210, easing: SIN }),
        withTiming(0.75, { duration: 160, easing: SIN }),
        withTiming(0.4, { duration: 200, easing: SIN })
      ),
      -1,
      false
    );
    gC.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 240, easing: SIN }),
        withTiming(0.95, { duration: 160, easing: SIN }),
        withTiming(0.45, { duration: 190, easing: SIN }),
        withTiming(0.7, { duration: 220, easing: SIN })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => () => {
    cancelAnimation(gA);
    cancelAnimation(gB);
    cancelAnimation(gC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = useAnimatedProps(() => ({ transform: [{ scale: 0.72 + 0.28 * grow.value }] }));
  const a = useAnimatedProps(() => ({ opacity: gA.value }));
  const b = useAnimatedProps(() => ({ opacity: gB.value }));
  const c = useAnimatedProps(() => ({ opacity: gC.value }));

  return (
    <AnimatedG animatedProps={scale}>
      <AnimatedG animatedProps={a}>
        <Line x1={0.2} y1={-0.6} x2={1.0} y2={-3.4} stroke={CORONA_LT} strokeWidth={0.45} strokeLinecap="round" />
        <Line x1={-0.8} y1={-0.5} x2={-1.8} y2={-2.6} stroke={CORONA} strokeWidth={0.4} strokeLinecap="round" />
      </AnimatedG>
      <AnimatedG animatedProps={b}>
        <Line x1={0.9} y1={-0.2} x2={2.4} y2={-1.3} stroke={CORONA} strokeWidth={0.4} strokeLinecap="round" />
        <Line x1={-0.2} y1={-0.8} x2={-0.5} y2={-3.8} stroke={CORONA_LT} strokeWidth={0.45} strokeLinecap="round" />
      </AnimatedG>
      <AnimatedG animatedProps={c}>
        <Line x1={-1.2} y1={-0.1} x2={-2.7} y2={-0.9} stroke={CORONA} strokeWidth={0.4} strokeLinecap="round" />
      </AnimatedG>
      {/* the charged point itself: compact bead, hot pale center, no halo */}
      <Circle cx={0} cy={-0.2} r={0.7} fill={CORONA_LT} opacity={0.8} />
      <Circle cx={0} cy={-0.2} r={0.35} fill={CORONA_CORE} />
    </AnimatedG>
  );
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function StormRod({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const coronaOp = useSharedValue(lit ? 1 : 0); // corona brush visibility
  const coronaGrow = useSharedValue(lit ? 1 : 0); // charge-up brush growth 0 -> 1
  const litWarm = useSharedValue(lit ? 1 : 0); // steady lit rims + cable shimmer
  const flashOp = useSharedValue(0); // white-hot return stroke + restrikes
  const prevLit = useRef(lit); // first mount while lit must skip the one-shot

  // Mount the lit layers only while lit (fade tail covers the 400ms extinguish), the flash
  // overlay only for the one-shot run.
  const [litOn, setLitOn] = useState(lit);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (lit) {
      setLitOn(true);
      return;
    }
    const t = setTimeout(() => setLitOn(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    const wasLit = prevLit.current;
    prevLit.current = lit;
    // Blur acts like reduced motion: pin static values, no one-shots, no loops.
    const still = reduce || !focused;
    cancelAnimation(coronaOp);
    cancelAnimation(coronaGrow);
    cancelAnimation(litWarm);
    cancelAnimation(flashOp);
    if (lit) {
      if (still || wasLit) {
        // First mount while already lit, refocus, or reduce: steady corona, no replay.
        setFlashing(false);
        coronaOp.value = 1;
        coronaGrow.value = 1;
        litWarm.value = 1;
        flashOp.value = 0;
        return;
      }
      // Real unlit -> lit edge: the full strike one-shot on the shared clock.
      setFlashing(true);
      coronaOp.value = 0;
      coronaGrow.value = 0;
      litWarm.value = 0;
      flashOp.value = 0;
      // 0-550ms: St. Elmo's charge-up (filaments fade in and grow slightly).
      coronaOp.value = withTiming(1, { duration: CHARGE_MS, easing: Easing.out(Easing.quad) });
      coronaGrow.value = withTiming(1, { duration: CHARGE_MS, easing: Easing.inOut(Easing.quad) });
      // 620ms: return stroke, instant on; re-flashes land at 700 and 880 (25+55, then 20+70+90).
      flashOp.value = withDelay(
        RETURN_MS,
        withSequence(
          withTiming(1, { duration: 25, easing: Easing.out(Easing.quad) }),
          withTiming(0.1, { duration: 55, easing: Easing.in(Easing.quad) }),
          withTiming(0.55, { duration: 20, easing: Easing.out(Easing.quad) }),
          withTiming(0.06, { duration: 70, easing: Easing.in(Easing.quad) }),
          withDelay(90, withTiming(0.32, { duration: 20, easing: Easing.out(Easing.quad) })),
          withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) })
        )
      );
      // Steady lit state ramps in under the strobes, settled by ~1.5s.
      litWarm.value = withDelay(RETURN_MS, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
      const t = setTimeout(() => setFlashing(false), 1700);
      return () => clearTimeout(t);
    }
    // Unlit: kill any in-flight one-shot; the corona fades over 400ms (instant when pinned).
    setFlashing(false);
    flashOp.value = 0;
    coronaGrow.value = 1;
    if (still) {
      coronaOp.value = 0;
      litWarm.value = 0;
      return;
    }
    coronaOp.value = withTiming(0, { duration: 400 });
    litWarm.value = withTiming(0, { duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => {
    cancelAnimation(coronaOp);
    cancelAnimation(coronaGrow);
    cancelAnimation(litWarm);
    cancelAnimation(flashOp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* ===== ROCKY KNOLL (the moor rises to meet the scene's ground line) ===== */}
      <Path d="M4 97 Q16 87 30 88 Q40 84.5 50 84.8 Q60 84.5 70 88 Q84 87 96 97 L96 100 L4 100 Z" fill={GROUND} />
      <Ellipse cx={22} cy={91} rx={5} ry={1.6} fill={ROCK} opacity={0.8} />
      <Ellipse cx={77} cy={90.4} rx={6} ry={1.8} fill={ROCK} opacity={0.8} />
      <Ellipse cx={50} cy={90} rx={30} ry={4.5} fill={SHADOW} opacity={0.5} />

      {/* ===== ROUGH BASE COURSE (y 78..88, jagged, half sunk in the knoll) ===== */}
      <Path d="M32.5 78 L67.5 78 L66.2 82 L67.2 88 L33 88 L33.8 83 Z" fill={STONE_DK} />
      <Path d="M33.2 78.4 L66.8 78.4 L66 81.4 L34.2 81.6 Z" fill={STONE} opacity={0.5} />
      <Path d="M42 79 Q41 82.5 42.4 86.8" stroke={CRACK} strokeWidth={0.45} fill="none" opacity={0.8} />
      <Path d="M58.5 78.6 Q59.4 82 58.6 87.4" stroke={CRACK} strokeWidth={0.4} fill="none" opacity={0.7} />
      <Ellipse cx={36.5} cy={85} rx={2.6} ry={1.5} fill={MOSS} opacity={0.8} />
      <Ellipse cx={63} cy={86} rx={2.2} ry={1.2} fill={MOSS_2} opacity={0.7} />

      {/* ===== SLAB 1 (big lower slab, y 72..78): flat top face + front face ===== */}
      <Path d="M31.5 72 L68.5 72 L67.5 73.6 L32.5 73.6 Z" fill={STONE_LT} />
      <Path d="M32.5 73.6 L67.5 73.6 L67 78 L33 78 Z" fill={STONE} />
      <Line x1={31.7} y1={72.1} x2={68.3} y2={72.1} stroke={RIM_COOL} strokeWidth={0.45} opacity={0.4} />
      {/* static wet sheen: linear highlights lying flat on the slab top, nothing pulses */}
      <Line x1={36} y1={72.75} x2={57} y2={72.75} stroke={SHEEN} strokeWidth={0.35} opacity={0.3} />
      <Line x1={60} y1={73.1} x2={66} y2={73.1} stroke={SHEEN} strokeWidth={0.3} opacity={0.22} />
      <Path d="M47 74 Q46.4 76 47.2 78" stroke={CRACK} strokeWidth={0.4} fill="none" opacity={0.7} />
      <Ellipse cx={34.6} cy={76} rx={1.6} ry={1} fill={MOSS_2} opacity={0.7} />

      {/* ===== SLAB 2 (upper slab, y 66.5..72) ===== */}
      <Path d="M36.5 66.5 L63.5 66.5 L62.6 68 L37.4 68 Z" fill={STONE_LT} />
      <Path d="M37.4 68 L62.6 68 L62 72 L38 72 Z" fill={STONE} />
      <Line x1={36.7} y1={66.6} x2={63.3} y2={66.6} stroke={RIM_COOL} strokeWidth={0.45} opacity={0.45} />
      <Line x1={41} y1={67.2} x2={55} y2={67.2} stroke={SHEEN} strokeWidth={0.35} opacity={0.3} />
      <Path d="M55.5 68.4 Q56.2 70 55.8 72" stroke={CRACK} strokeWidth={0.35} fill="none" opacity={0.6} />
      <Ellipse cx={61} cy={70.2} rx={1.3} ry={0.8} fill={MOSS} opacity={0.65} />

      {/* ===== THE FRANKLIN ROD (mount flange on the top slab, tip EXACTLY (50, 14)) ===== */}
      <Path d="M47.4 66.5 L52.6 66.5 L52 64.2 L48 64.2 Z" fill={IRON} />
      <Circle cx={48.3} cy={65.8} r={0.35} fill={IRON_DK} />
      <Circle cx={51.7} cy={65.8} r={0.35} fill={IRON_DK} />
      {/* tapered shaft: pointed vintage terminal */}
      <Path d="M48.9 64.2 L50 14 L51.1 64.2 Z" fill={IRON} />
      <Path d="M50 14 L51.1 64.2 L50 64.2 Z" fill={IRON_DK} opacity={0.7} />
      {/* the small ball partway up the shaft (research-true vintage detail) */}
      <Circle cx={50} cy={30} r={1.7} fill={IRON} />
      <Path d="M48.7 29.5 A1.7 1.7 0 0 1 50.4 28.35" stroke={RIM_COOL} strokeWidth={0.4} fill="none" opacity={0.6} />
      <Path d="M50.2 31.6 A1.7 1.7 0 0 0 51.5 30.6" stroke={IRON_DK} strokeWidth={0.4} fill="none" opacity={0.8} />
      {/* cold unlit rim light up the moonward edge of the shaft */}
      <Line x1={49.55} y1={17} x2={49.1} y2={62} stroke={RIM_COOL} strokeWidth={0.4} opacity={0.55} />
      <Line x1={49.45} y1={20} x2={49.35} y2={40} stroke={IRON_HI} strokeWidth={0.3} opacity={0.5} />

      {/* ===== BRAIDED DOWN CONDUCTOR (lashed with two collar bands, into the ground) ===== */}
      <Path d={CABLE_D} stroke={CABLE} strokeWidth={1.15} strokeLinecap="round" fill="none" />
      {BRAID_TICKS.map(([x, y, s], i) => (
        <Line
          key={i}
          x1={x - 0.45}
          y1={y - 0.32 * s}
          x2={x + 0.45}
          y2={y + 0.32 * s}
          stroke={CABLE_HI}
          strokeWidth={0.3}
          opacity={0.5}
        />
      ))}
      {/* ground termination: the conductor dives at the knoll (min 3 m of rod below, unseen) */}
      <Ellipse cx={66.3} cy={88.6} rx={2} ry={0.8} fill={ROCK} />
      {/* the two collar bands lashing the cable to the rod */}
      <Rect x={48.7} y={39.6} width={3} height={1.4} fill={COLLAR} />
      <Line x1={48.8} y1={39.75} x2={51.6} y2={39.75} stroke={RIM_COOL} strokeWidth={0.3} opacity={0.5} />
      <Line x1={48.8} y1={40.85} x2={51.6} y2={40.85} stroke={IRON_DK} strokeWidth={0.35} opacity={0.9} />
      <Rect x={48.5} y={55.4} width={3.4} height={1.4} fill={COLLAR} />
      <Line x1={48.6} y1={55.55} x2={51.8} y2={55.55} stroke={RIM_COOL} strokeWidth={0.3} opacity={0.5} />
      <Line x1={48.6} y1={56.65} x2={51.8} y2={56.65} stroke={IRON_DK} strokeWidth={0.35} opacity={0.9} />

      {/* ===== THE RAIN-DRUM RELIC (Dong Son bronze, leaning on the plinth's left side) ===== */}
      <G transform="translate(30 82.5) rotate(8)">
        <Path d="M-3.6 -3.2 Q-4.6 -1.4 -3.4 1 L-3.1 3.2 L-4 6.2 L4 6.2 L3.1 3.2 L3.4 1 Q4.6 -1.4 3.6 -3.2 Z" fill={BRONZE} />
        <Path d="M-3.6 -3.2 Q-4.6 -1.4 -3.4 1 L-3.1 3.2 L-3.6 6.2 L-2.2 6.2 L-2 3 L-2.4 0.6 Q-3 -1.6 -2.4 -3.2 Z" fill={BRONZE_LT} opacity={0.6} />
        <Ellipse cx={0} cy={-3.4} rx={4.3} ry={1.3} fill={BRONZE_LT} stroke={BRONZE_HI} strokeWidth={0.25} strokeOpacity={0.6} />
        <Ellipse cx={0} cy={-3.4} rx={2.6} ry={0.75} fill="none" stroke={BRONZE_DK} strokeWidth={0.3} opacity={0.9} />
        <Circle cx={0} cy={-3.4} r={0.5} fill={BRONZE_DK} opacity={0.8} />
        <Path d="M-4.2 -3.6 A4.35 1.35 0 0 1 0.4 -4.72" stroke={RIM_COOL} strokeWidth={0.35} fill="none" opacity={0.4} />
        {/* the frog figure hint on the tympanum rim */}
        <Circle cx={2.9} cy={-4.15} r={0.55} fill={BRONZE_DK} />
        <Line x1={3.3} y1={-3.8} x2={3.9} y2={-3.5} stroke={BRONZE_DK} strokeWidth={0.3} strokeLinecap="round" />
        <Line x1={2.5} y1={-3.75} x2={2} y2={-3.45} stroke={BRONZE_DK} strokeWidth={0.3} strokeLinecap="round" />
        {/* patina blooms + a band of cast decoration */}
        <Line x1={-3.3} y1={1.6} x2={3.3} y2={1.6} stroke={BRONZE_DK} strokeWidth={0.3} opacity={0.7} />
        <Ellipse cx={1.6} cy={3.4} rx={1.3} ry={0.8} fill="#4F6B52" opacity={0.6} />
      </G>

      {/* ===== LIT STEADY STATE: cool blue slab rims + the cable's charged shimmer ===== */}
      {litOn && (
        <Fade op={litWarm}>
          <Line x1={32.7} y1={73.7} x2={67.3} y2={73.7} stroke={LIT_RIM} strokeWidth={0.45} opacity={0.55} />
          <Line x1={37.6} y1={68.1} x2={62.4} y2={68.1} stroke={LIT_RIM} strokeWidth={0.45} opacity={0.6} />
          <Line x1={33} y1={78.15} x2={67} y2={78.15} stroke={LIT_RIM} strokeWidth={0.4} opacity={0.35} />
          {/* the braided conductor carries a faint steady charge: one thin pale static line */}
          <Path d={CABLE_D} stroke={CHARGE} strokeWidth={0.3} fill="none" opacity={0.55} />
          <Line x1={50.5} y1={17} x2={50.9} y2={62} stroke={LIT_RIM} strokeWidth={0.35} opacity={0.5} />
        </Fade>
      )}

      {/* ===== THE CORONA BRUSH at the tip (charge-up, then the steady lit cue) ===== */}
      {litOn && (
        <Fade op={coronaOp}>
          <G transform="translate(50 14)">
            <CoronaBrush still={reduce || !focused} grow={coronaGrow} />
          </G>
        </Fade>
      )}

      {/* ===== RETURN STROKE FLASH (one-shot only): the rod goes white-hot, slab edges catch ===== */}
      {flashing && (
        <Fade op={flashOp}>
          <Line x1={50} y1={14.4} x2={50} y2={64} stroke={FLASH_FRINGE} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
          <Line x1={50} y1={14.2} x2={50} y2={64} stroke={FLASH_HOT} strokeWidth={1.5} strokeLinecap="round" />
          <Circle cx={50} cy={30} r={2.1} fill={FLASH_HOT} opacity={0.9} />
          <Path d={CABLE_D} stroke={FLASH_HOT} strokeWidth={0.5} fill="none" opacity={0.85} />
          <Line x1={36.7} y1={66.6} x2={63.3} y2={66.6} stroke={FLASH_EDGE} strokeWidth={0.6} opacity={0.9} />
          <Line x1={31.7} y1={72.1} x2={68.3} y2={72.1} stroke={FLASH_EDGE} strokeWidth={0.6} opacity={0.85} />
          <Line x1={32.8} y1={78.1} x2={67.2} y2={78.1} stroke={FLASH_EDGE} strokeWidth={0.5} opacity={0.7} />
          {/* ground splash strokes where the current dumps into the earth */}
          <Line x1={64.9} y1={87.6} x2={62.6} y2={86.2} stroke={FLASH_FRINGE} strokeWidth={0.5} strokeLinecap="round" opacity={0.8} />
          <Line x1={67.6} y1={87.8} x2={69.6} y2={86.6} stroke={FLASH_FRINGE} strokeWidth={0.5} strokeLinecap="round" opacity={0.8} />
        </Fade>
      )}
    </Svg>
  );
}
