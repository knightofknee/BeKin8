// components/structures/RooftopSearchlight.tsx
// The PREMIERE SEARCHLIGHT skin's tap target: a research-true 60-inch Sperry-style carbon-arc
// searchlight on a city rooftop (1930s Hollywood premiere hardware: ~$60k anti-aircraft surplus,
// rhodium-plated parabolic mirror, two carbon rods arcing at the focal point, manually struck).
// Composition, authored 0..100 at a 180x180 footprint: a big round BARREL (drum) seen from
// behind-side with its glass face angled straight up, lens center at EXACTLY (50, 30) (the
// registry origin is 0.30, so the beam layer's anchor lands on the lens); riveted seams and two
// art-deco cooling fins around the tail; the drum hangs on TRUNNION hubs held by a fixed yoke over
// a pedestal whose base plate is bolted to the rooftop deck (feet y 86-88.5); a thick power CABLE
// snakes from the pedestal off-frame right (to the generator trailer we cannot see); and the star
// of the tap moment: a chunky CONTACTOR LEVER on the pedestal's right flank.
//
// SWEEP CONTRACT (shared by RooftopSearchlight, SearchlightScene, BeaconSearchlightBeam):
//   SWEEP_PERIOD = 22.0 s; sway = sin(2*PI*t/22); shaped = sway^3 (dwells near vertical);
//   theta = 0.62 * shaped (radians off vertical, max ~35.5 deg). t is a gated clock ZEROED on the
//   real unlit-to-lit edge in ALL THREE components; they mount together on a skin switch and pause
//   together on blur, so the barrel, the shaft and the cloud disc stay in lockstep. The barrel
//   group here visibly rotates by that same theta AROUND THE LENS POINT (50, 30).
//
// TIMING CONTRACT (lit-edge one-shot, 1.6s, matches the ignite clip): t 0.00-0.27 the LEVER THROWS
// (rotates ~38 deg with a snap and a slight overshoot; clunk in the clip at 0.05); t 0.255-0.555
// the STRIKE SPUTTER (carbon rods touch and draw the arc: the lens flickers unevenly via keyframed
// opacity, a one-shot, not an idle pulse); t 0.55 the arc CATCHES (lens snaps to steady blue-white,
// thin rim strokes bloom along the barrel's front edge, settling by ~1.2s). The beam layer gates
// itself in at ~0.45-0.6 on the same zeroed clock. EXTINGUISH: the lens dies in 200ms (an arc cuts
// instantly), the lever returns over 600ms, the barrel eases back upright.
//
// LEGIBILITY: unlit is a pure static silhouette (cool moon rim from camera-LEFT, faint amber city
// underglow on the lower edges, one static reflection line on the dark glass; nothing pulses).
// Warmth while lit = rim/edge strokes only, no radial glow balls. First mount while already lit,
// reduced motion, and blur all SKIP the one-shot (lever already thrown, lens steady); reduced
// motion pins the barrel at theta = 0.
//
// KNOBS: SWEEP_PERIOD / SWEEP_AMPL below (must match the other two files); LEVER_BASE_DEG /
// LEVER_THROW_DEG for the lever pose; the sputter keyframes in the lit-edge branch.
import React, { useEffect, useRef } from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { useGatedClock } from '../../lib/useGatedClock';

const AnimatedG = Animated.createAnimatedComponent(G);

// SWEEP CONTRACT constants (see header; identical in SearchlightScene + BeaconSearchlightBeam).
const SWEEP_PERIOD = 22.0;
const SWEEP_AMPL = 0.62; // radians off vertical at the sway extreme

// Lever pose: authored pointing straight up, tilted LEVER_BASE_DEG at rest, thrown by
// LEVER_THROW_DEG (the one-shot overshoots to ~1.12x for the snap).
const LEVER_BASE_DEG = -16;
const LEVER_THROW_DEG = 38;
const LEVER_PIVOT = { x: 59.4, y: 74.6 };

// Gunmetal hardware palette
const DRUM_DK = '#161A21';
const DRUM_HI = '#2E3540';
const RING = '#3A414D';
const GLASS = '#0D1118';
const MIRROR = '#1B2531';
const MIRROR_HI = '#33465A';
const STEEL = '#262B33';
const STEEL_DK = '#1C2129';
const STEEL_HI = '#4A525E';
const YOKE = '#232830';
const YOKE_R = '#20252D';
const PLATE = '#171A21';
const CABLE = '#0B0E13';
const KNOB = '#6E2A20';
const KNOB_HI = '#A85648';
// Unlit readability: moon fills from camera-LEFT (cool), the amber city glows from BELOW (warm).
const RIM_MOON = '#C7D2E0';
const RIM_AMBER = '#E8B978';
// Lit: carbon-arc blue-white (matches the skin's glow.center family)
const ARC = '#EAF4FF';
const ARC_RIM = '#DDEBFF';
const ARC_EDGE = '#BFD9F2';

// Opacity crossfade group (CampfireLogs / FireworkRocket pattern: hooks live in a stable
// subcomponent so the parent's hook count never changes).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function RooftopSearchlight({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();

  // The sweep clock: zeroed on the real lit edge below, paused on blur/reduce alongside the scene
  // and beam clocks (they share the gate condition, so all three freeze and resume in lockstep).
  const { clock } = useGatedClock(lit && focused && !reduce);

  const lever = useSharedValue(lit ? 1 : 0); // 0 rest .. 1 thrown (overshoots to 1.12 in the snap)
  const lens = useSharedValue(lit ? 1 : 0); // arc brightness (keyframed sputter on the lit edge)
  const warm = useSharedValue(lit ? 1 : 0); // post-catch rim strokes ramp
  const amp = useSharedValue(lit ? 1 : 0); // sweep amplitude gate: eases the barrel home on extinguish
  const prevLit = useRef(lit); // first mount while lit must skip the one-shot

  useEffect(() => {
    const wasLit = prevLit.current;
    prevLit.current = lit;
    const still = reduce || !focused;
    cancelAnimation(lever);
    cancelAnimation(lens);
    cancelAnimation(warm);
    cancelAnimation(amp);
    if (lit) {
      if (still) {
        // Covered or reduced: settle straight into the steady lit state. Reduced motion pins the
        // barrel at theta = 0 (amp 0); blur keeps amp 1 so the frozen clock holds the exact pose
        // the other layers froze at.
        lever.value = 1;
        lens.value = 1;
        warm.value = 1;
        if (reduce) {
          amp.value = 0;
          clock.value = 0;
        } else {
          amp.value = 1;
        }
        return;
      }
      if (wasLit) {
        // First mount while already lit, refocus, or reduce toggling off: steady state, no
        // one-shot, barrel animating from wherever the shared clock sits.
        lever.value = 1;
        lens.value = 1;
        warm.value = 1;
        amp.value = 1;
        return;
      }
      // REAL unlit -> lit edge: the 1.6s ignition (see TIMING CONTRACT). Zero the sweep clock
      // (theta stays ~0 through the whole one-shot thanks to the sway^3 dwell).
      clock.value = 0;
      amp.value = 1;
      lever.value = 0;
      lens.value = 0;
      warm.value = 0;
      lever.value = withSequence(
        withTiming(1.12, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 90, easing: Easing.inOut(Easing.quad) })
      );
      // Strike sputter: uneven keyframed pulses 0.255-0.555, then the catch snaps it steady.
      lens.value = withDelay(
        255,
        withSequence(
          withTiming(0.72, { duration: 42, easing: Easing.out(Easing.quad) }),
          withTiming(0.12, { duration: 52, easing: Easing.in(Easing.quad) }),
          withTiming(0.85, { duration: 48, easing: Easing.out(Easing.quad) }),
          withTiming(0.18, { duration: 68, easing: Easing.in(Easing.quad) }),
          withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) })
        )
      );
      warm.value = withDelay(560, withTiming(1, { duration: 640, easing: Easing.out(Easing.quad) }));
      return;
    }
    // Extinguish: the arc cuts instantly (lens 200ms), the lever eases home (600ms), the barrel
    // rotates back upright as amp drains against the frozen clock.
    if (still) {
      lever.value = 0;
      lens.value = 0;
      warm.value = 0;
      amp.value = 0;
      clock.value = 0;
      return;
    }
    lens.value = withTiming(0, { duration: 200 });
    warm.value = withTiming(0, { duration: 400 });
    lever.value = withTiming(0, { duration: 600, easing: Easing.inOut(Easing.quad) });
    amp.value = withTiming(0, { duration: 500, easing: Easing.inOut(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => {
    cancelAnimation(lever);
    cancelAnimation(lens);
    cancelAnimation(warm);
    cancelAnimation(amp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Barrel rotation: theta from the SWEEP CONTRACT, applied around the lens point (50, 30) via a
  // translate-rotate-translate sandwich (composes as T * R * T^-1, pivot-exact regardless of the
  // group's own origin).
  const barrelProps = useAnimatedProps(() => {
    const sway = Math.sin((2 * Math.PI * clock.value) / SWEEP_PERIOD);
    const shaped = sway * sway * sway;
    const deg = ((SWEEP_AMPL * shaped * 180) / Math.PI) * amp.value;
    const tr: any[] = [
      { translateX: 50 },
      { translateY: 30 },
      { rotate: `${deg}deg` },
      { translateX: -50 },
      { translateY: -30 },
    ];
    return { transform: tr };
  });

  const leverProps = useAnimatedProps(() => {
    const deg = LEVER_BASE_DEG + lever.value * LEVER_THROW_DEG;
    const tr: any[] = [
      { translateX: LEVER_PIVOT.x },
      { translateY: LEVER_PIVOT.y },
      { rotate: `${deg}deg` },
      { translateX: -LEVER_PIVOT.x },
      { translateY: -LEVER_PIVOT.y },
    ];
    return { transform: tr };
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* Drum shell: cylindrical shading, cool highlight left of center (moon side) */}
        <LinearGradient id="rsDrum" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor={DRUM_DK} />
          <Stop offset="35%" stopColor="#262C36" />
          <Stop offset="58%" stopColor={DRUM_HI} />
          <Stop offset="100%" stopColor="#1B2028" />
        </LinearGradient>
      </Defs>

      {/* Ground contact shadow: the pedestal is planted on the deck */}
      <Ellipse cx={50} cy={88.8} rx={17} ry={2.4} fill="#000000" opacity={0.38} />

      {/* ===== POWER CABLE: from the pedestal flank, snaking off-frame right to the generator
           trailer we cannot see (the scene continues it along the deck) ===== */}
      <Path d="M56.5 84 C63 88.5 70 85.5 78 89 C86 92.4 93 89.8 100.5 91.5" stroke={CABLE} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <Path d="M57 83.6 C63 87.8 69 85.2 76 88.2" stroke="#262D38" strokeWidth={0.6} fill="none" opacity={0.5} />
      <Rect x={55} y={81.5} width={3.4} height={3} rx={0.8} fill={STEEL} />

      {/* ===== PEDESTAL: tapered column, top cap, bolted base plate (feet y 86-88.5) ===== */}
      <Path d="M45 62.5 L55 62.5 L57.2 86 L42.8 86 Z" fill="#21252E" />
      <Path d="M50 62.5 L55 62.5 L57.2 86 L50 86 Z" fill="#000000" opacity={0.16} />
      <Line x1={45} y1={63.2} x2={43.1} y2={85.4} stroke={RIM_MOON} strokeWidth={0.5} opacity={0.16} />
      <Rect x={42.6} y={60.4} width={14.8} height={2.6} rx={1} fill="#2B313B" />
      <Line x1={43.2} y1={60.9} x2={57} y2={60.9} stroke="#3D4550" strokeWidth={0.5} opacity={0.8} />
      <Rect x={40} y={86} width={20} height={2.5} rx={0.7} fill={PLATE} />
      <Line x1={40.6} y1={86.3} x2={59.4} y2={86.3} stroke="#2A303A" strokeWidth={0.45} opacity={0.8} />
      <Circle cx={41.8} cy={87.2} r={0.62} fill="#3A4149" />
      <Circle cx={46.6} cy={87.6} r={0.62} fill="#3A4149" />
      <Circle cx={53.4} cy={87.6} r={0.62} fill="#3A4149" />
      <Circle cx={58.2} cy={87.2} r={0.62} fill="#3A4149" />
      <Circle cx={41.65} cy={87.05} r={0.2} fill={STEEL_HI} opacity={0.7} />
      <Circle cx={58.05} cy={87.05} r={0.2} fill={STEEL_HI} opacity={0.7} />
      {/* faint warm underglow from the amber city below (static, edge strokes only) */}
      <Line x1={41} y1={88.4} x2={59} y2={88.4} stroke={RIM_AMBER} strokeWidth={0.5} opacity={0.2} />
      <Line x1={43.4} y1={85.6} x2={56.6} y2={85.6} stroke={RIM_AMBER} strokeWidth={0.45} opacity={0.13} />

      {/* ===== THE BARREL (rotates around the lens point (50, 30) per the SWEEP CONTRACT) ===== */}
      <AnimatedG animatedProps={barrelProps}>
        {/* tail cap + art-deco cooling fins + rod-feed motor housing */}
        <Ellipse cx={50} cy={52} rx={13} ry={4.6} fill="#14181F" />
        <Ellipse cx={50} cy={49.2} rx={13.7} ry={4.5} fill="none" stroke="#2A313C" strokeWidth={1.1} />
        <Ellipse cx={50} cy={52.6} rx={14.1} ry={4.3} fill="none" stroke="#232932" strokeWidth={1.1} />
        <Circle cx={50} cy={54.6} r={2.1} fill="#10141A" />
        <Circle cx={50} cy={54.6} r={0.8} fill={STEEL} />
        {/* drum shell with riveted seams */}
        <Rect x={37} y={30} width={26} height={22} fill="url(#rsDrum)" />
        <Path d="M37.3 37.6 Q50 39.4 62.7 37.6" stroke="#10141B" strokeWidth={0.55} opacity={0.8} fill="none" />
        <Path d="M37.3 44.8 Q50 46.6 62.7 44.8" stroke="#10141B" strokeWidth={0.55} opacity={0.7} fill="none" />
        {[40.5, 45, 50, 55, 59.5].map((x, i) => (
          <Circle key={`rv1${i}`} cx={x} cy={i === 0 || i === 4 ? 38.4 : i === 2 ? 39.2 : 39} r={0.35} fill={STEEL_HI} opacity={0.85} />
        ))}
        {[40.5, 45, 50, 55, 59.5].map((x, i) => (
          <Circle key={`rv2${i}`} cx={x} cy={i === 0 || i === 4 ? 45.6 : i === 2 ? 46.4 : 46.2} r={0.35} fill={STEEL_HI} opacity={0.7} />
        ))}
        <Line x1={37.3} y1={30.8} x2={37.3} y2={51.6} stroke="#0D1117" strokeWidth={0.7} opacity={0.8} />
        <Line x1={62.7} y1={30.8} x2={62.7} y2={51.6} stroke="#0D1117" strokeWidth={0.7} opacity={0.8} />
        {/* moon rim (camera-left) + amber wash on the tail's underside */}
        <Line x1={37.4} y1={31} x2={37.4} y2={51} stroke={RIM_MOON} strokeWidth={0.5} opacity={0.28} />
        <Path d="M38.6 53.4 A12 4 0 0 0 61.4 53.4" stroke={RIM_AMBER} strokeWidth={0.5} opacity={0.16} fill="none" />
        {/* face ring + dark glass + rhodium-mirror hint (lens center EXACTLY (50, 30)) */}
        <Ellipse cx={50} cy={30} rx={13.6} ry={5} fill={RING} />
        <Path d="M36.6 30.6 A13.4 4.8 0 0 0 63.4 30.6" stroke="#12161C" strokeWidth={0.8} fill="none" opacity={0.7} />
        <Ellipse cx={50} cy={29.7} rx={13.2} ry={4.7} fill="none" stroke={RIM_MOON} strokeWidth={0.5} opacity={0.18} />
        <Ellipse cx={50} cy={29.8} rx={11.9} ry={4.1} fill={GLASS} />
        <Ellipse cx={50} cy={30.3} rx={10} ry={3.2} fill={MIRROR} opacity={0.85} />
        <Path d="M41.5 31.3 A10 3.1 0 0 0 58.5 31.3" stroke={MIRROR_HI} strokeWidth={0.7} opacity={0.6} fill="none" />
        {/* one static faint reflection line on the dark glass (the unlit hint; never pulses) */}
        <Line x1={43.5} y1={28.6} x2={52.5} y2={30.9} stroke="#8FA5BF" strokeWidth={0.5} opacity={0.35} />
        {/* door latches */}
        <Rect x={35.9} y={29.2} width={1.5} height={1.8} rx={0.4} fill={STEEL_HI} />
        <Rect x={62.6} y={29.2} width={1.5} height={1.8} rx={0.4} fill={STEEL_HI} />

        {/* LIT: the arc. Lens fill snaps steady after the sputter; one static glare streak. */}
        <Fade op={lens}>
          <Ellipse cx={50} cy={29.8} rx={11.9} ry={4.1} fill={ARC} />
          <Ellipse cx={50} cy={29.8} rx={8.2} ry={2.7} fill="#FFFFFF" />
          <Line x1={43} y1={28.4} x2={57} y2={31.2} stroke="#FFFFFF" strokeWidth={1} opacity={0.55} strokeLinecap="round" />
          <Ellipse cx={50} cy={30} rx={12.6} ry={4.5} fill="none" stroke={ARC_RIM} strokeWidth={0.6} opacity={0.9} />
        </Fade>
        {/* LIT: thin rim strokes along the barrel's front edge (the catch's bloom, no glow balls) */}
        <Fade op={warm}>
          <Line x1={37.35} y1={30.6} x2={37.35} y2={38} stroke={ARC_EDGE} strokeWidth={0.55} opacity={0.5} />
          <Line x1={62.65} y1={30.6} x2={62.65} y2={38} stroke={ARC_EDGE} strokeWidth={0.55} opacity={0.5} />
          <Ellipse cx={50} cy={29.9} rx={13.6} ry={5} fill="none" stroke={ARC_EDGE} strokeWidth={0.5} opacity={0.45} />
        </Fade>
      </AnimatedG>

      {/* ===== TRUNNION YOKE (fixed): arms from the pedestal shoulders up to hub caps that grip
           the drum sides; the drum slides behind them through the sweep ===== */}
      <Path d="M42.2 66 L44.9 66 L41.6 40 L38.4 40.6 Z" fill={YOKE} />
      <Path d="M57.8 66 L55.1 66 L58.4 40 L61.6 40.6 Z" fill={YOKE_R} />
      <Line x1={38.8} y1={41} x2={42} y2={65.6} stroke={RIM_MOON} strokeWidth={0.4} opacity={0.14} />
      <Circle cx={39} cy={38.9} r={2.7} fill="#2C333D" />
      <Circle cx={39} cy={38.9} r={0.95} fill={STEEL_HI} />
      <Circle cx={38.4} cy={38.3} r={0.3} fill={RIM_MOON} opacity={0.5} />
      <Circle cx={61} cy={38.9} r={2.7} fill="#2C333D" />
      <Circle cx={61} cy={38.9} r={0.95} fill={STEEL_HI} />

      {/* ===== CONTACTOR BOX + LEVER on the pedestal's right flank (the tap-moment star) ===== */}
      <Rect x={56} y={68.5} width={6.8} height={8.6} rx={0.9} fill={STEEL} />
      <Rect x={56.7} y={69.2} width={5.4} height={7.2} rx={0.6} fill={STEEL_DK} />
      <Circle cx={58.2} cy={70.6} r={0.7} fill="#98A2AE" opacity={0.75} />
      <Circle cx={60.8} cy={70.6} r={0.7} fill="#98A2AE" opacity={0.75} />
      <Path d="M59.5 77 L59 81.5" stroke={CABLE} strokeWidth={1.4} fill="none" />
      <Circle cx={LEVER_PIVOT.x} cy={LEVER_PIVOT.y} r={1.5} fill={RING} />
      <AnimatedG animatedProps={leverProps}>
        <Line x1={59.4} y1={74.6} x2={59.4} y2={66.4} stroke="#59616D" strokeWidth={1.7} strokeLinecap="round" />
        <Line x1={59.05} y1={74} x2={59.05} y2={67} stroke="#7A8494" strokeWidth={0.5} opacity={0.7} />
        <Circle cx={59.4} cy={65.6} r={1.9} fill={KNOB} />
        <Circle cx={58.9} cy={65.1} r={0.6} fill={KNOB_HI} opacity={0.8} />
      </AnimatedG>
      <Circle cx={LEVER_PIVOT.x} cy={LEVER_PIVOT.y} r={0.6} fill={STEEL_HI} />

      {/* LIT: arc light landing on the nearest fixed hardware, edge strokes only */}
      <Fade op={warm}>
        <Line x1={43} y1={60.6} x2={57} y2={60.6} stroke={ARC_EDGE} strokeWidth={0.5} opacity={0.3} />
        <Line x1={37.2} y1={37.2} x2={40.6} y2={36.9} stroke={ARC_EDGE} strokeWidth={0.45} opacity={0.4} />
        <Line x1={59.4} y1={37.2} x2={62.8} y2={36.9} stroke={ARC_EDGE} strokeWidth={0.45} opacity={0.4} />
      </Fade>
    </Svg>
  );
}
