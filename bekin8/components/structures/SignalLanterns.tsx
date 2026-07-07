// components/structures/SignalLanterns.tsx
// The Two Lanterns skin's tap target: the TOP OF THE OLD NORTH CHURCH STEEPLE, the real deal.
// Bottom to top in the 0..100 box: a hint of the red-brick tower top capped by a white cornice,
// the white wooden belfry stage (clapboard siding, corner pilasters) with TWO tall arched openings
// side by side, a lantern hanging inside each on a small chain, then a smaller open stage, the
// tapering spire, and a tiny weathervane. THIS STRUCTURE OWNS ITS LIGHT (skin fire: 'none', so no
// flame seat anchors here; registry origin 0.5 is free): the lit prop kindles the candles. Unlit:
// dark glass, faint cool brass edge glints, NO pulsing hints anywhere. Lit: the left lantern
// catches first, the right follows ~300ms later, then both flicker on independent gentle loops and
// spill warm light onto the arch jambs. Extinguish fades right first, left trails. Authored
// 0..100; 180x180 footprint. Animated (reanimated); reduced motion gets static lit/unlit states.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, RadialGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
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

// Aged white woodwork (lit face / shadow side) + siding line tone
const WHITE = '#ECE8DC';
const WHITE_SH = '#C9C4B4';
const WHITE_HI = '#F4F0E4';
const SIDING = '#B4AF9F';
// Brick tower top
const BRICK = '#8C3B2C';
const MORTAR = '#6E2E23';
// Dark interiors behind the arches (and the unlit glass)
const DARK = '#10131E';
// Brass lantern frames (light face / shadow side / mullions catching candlelight)
const BRASS = '#C9A24B';
const BRASS_SH = '#8A6D33';
const BRASS_HOT = '#E8C06A';
// Ironwork (chains, weathervane)
const IRON = '#2A2C33';
const IRON_HI = '#4A4F5E';
// Cool moon glint strokes (unlit readability)
const MOON = '#C7D2E0';
// Candle
const WAX = '#D8D2BE';
const WAX_WARM = '#FFF0C0';
const GLASS_WARM = '#FFD98C';
const FLAME_OUT = '#FFC24A';
const FLAME_CORE = '#FFF6D8';
// Warm spill on the arch jambs while lit
const SPILL = '#FFB05A';

// Belfry clapboard course lines (y positions across the stage).
const SIDING_YS = Array.from({ length: 15 }, (_, i) => 40.6 + i * 2.8);

// Brick coursing for the tower-top hint: mortar rows plus staggered vertical joints.
const BRICK_ROWS = [88, 91, 94, 97];
const BRICK_JOINTS: [number, number, number][] = [];
for (let r = 0; r < 5; r++) {
  const y1 = 85 + r * 3;
  const y2 = Math.min(y1 + 3, 100);
  const xs = r % 2 === 0 ? [33, 41.5, 50, 58.5, 67] : [37.2, 45.7, 54.2, 62.7];
  for (const x of xs) BRICK_JOINTS.push([x, y1 + 0.5, y2 - 0.5]);
}

// One belfry arch opening (14 wide): apex ~y44, springs at y51, dark interior down to the sill.
function archD(cx: number): string {
  return `M${cx - 7} 75.8 L${cx - 7} 51 A7 7 0 0 1 ${cx + 7} 51 L${cx + 7} 75.8 Z`;
}

// The four glass panes of one lantern (a 2x2 grid inside the brass frame). Shared by the
// near-black unlit fills and the warm lit fills so the two states never misalign.
function panes(cx: number) {
  return [
    { x: cx - 3.2, y: 53.4, w: 2.75, h: 3.0 },
    { x: cx + 0.45, y: 53.4, w: 2.75, h: 3.0 },
    { x: cx - 3.2, y: 57.1, w: 2.75, h: 3.3 },
    { x: cx + 0.45, y: 57.1, w: 2.75, h: 3.3 },
  ];
}

// One unlit lantern hanging inside an arch at cx (~9 wide, y 48..64, glass centered ~y56): chain
// links from the arch soffit, brass ring, flared cap, 2x2 glass body, base dish with a drip
// finial, and a pale wax candle waiting behind the glass. Right-hand brass takes the shadow tone;
// cool moon glints trace the left edges so it reads as a lantern even in the dark.
function Lantern({ cx }: { cx: number }) {
  return (
    <G>
      {/* chain down from inside the arch */}
      <Line x1={cx} y1={45.2} x2={cx} y2={48.2} stroke={IRON} strokeWidth={0.7} />
      <Circle cx={cx} cy={46.2} r={0.5} fill="none" stroke={IRON_HI} strokeWidth={0.35} />
      <Circle cx={cx} cy={47.4} r={0.5} fill="none" stroke={IRON_HI} strokeWidth={0.35} />
      {/* ring top */}
      <Circle cx={cx} cy={49.2} r={1.1} fill="none" stroke={BRASS} strokeWidth={0.7} />
      {/* flared top cap */}
      <Path d={`M${cx - 4.4} 52.6 L${cx - 1.4} 50.2 L${cx + 1.4} 50.2 L${cx + 4.4} 52.6 Z`} fill={BRASS} />
      <Path d={`M${cx} 50.2 L${cx + 1.4} 50.2 L${cx + 4.4} 52.6 L${cx} 52.6 Z`} fill={BRASS_SH} />
      {/* glass panes, near-black until a candle warms them */}
      {panes(cx).map((p, i) => (
        <Rect key={`p${i}`} x={p.x} y={p.y} width={p.w} height={p.h} fill={DARK} />
      ))}
      {/* the waiting candle, a faint wax stub behind the glass */}
      <Rect x={cx - 0.9} y={57.4} width={1.8} height={2.9} rx={0.5} fill={WAX} opacity={0.35} />
      {/* frame: corner posts, rails, and the 2x2 mullions */}
      <Rect x={cx - 4.2} y={52.6} width={1} height={8.4} fill={BRASS} />
      <Rect x={cx + 3.2} y={52.6} width={1} height={8.4} fill={BRASS_SH} />
      <Rect x={cx - 4.2} y={52.6} width={8.4} height={0.8} fill={BRASS} />
      <Rect x={cx - 0.45} y={53.4} width={0.9} height={7} fill={BRASS} />
      <Rect x={cx - 3.2} y={56.4} width={6.4} height={0.7} fill={BRASS} />
      <Rect x={cx - 4.2} y={60.4} width={8.4} height={1} fill={BRASS} />
      {/* base dish + drip finial */}
      <Path d={`M${cx - 4.2} 61.4 L${cx - 3} 62.6 L${cx + 3} 62.6 L${cx + 4.2} 61.4 Z`} fill={BRASS_SH} />
      <Circle cx={cx} cy={63.3} r={0.7} fill={BRASS_SH} />
      {/* cool moon glints on the brass edges */}
      <Line x1={cx - 4.1} y1={52.9} x2={cx - 1.6} y2={50.7} stroke={MOON} strokeWidth={0.45} opacity={0.6} strokeLinecap="round" />
      <Line x1={cx - 3.9} y1={53.2} x2={cx - 3.9} y2={60.2} stroke={MOON} strokeWidth={0.4} opacity={0.45} />
    </G>
  );
}

// One lantern's kindled light, mounted only while lit (plus the fade tail): warm pane
// translucency, inner glow, the candle with its teardrop flame, mullions re-drawn hot in front of
// the flame so the fire stays behind the glass, a soft bloom halo bleeding onto the white boards,
// and the warm spill on the arch jambs and sill.
function LanternLight({ cx, op }: { cx: number; op: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      {panes(cx).map((p, i) => (
        <Rect key={`w${i}`} x={p.x} y={p.y} width={p.w} height={p.h} fill={GLASS_WARM} opacity={0.6} />
      ))}
      <Circle cx={cx} cy={56.8} r={5.2} fill="url(#sglInner)" />
      <Rect x={cx - 0.9} y={57.4} width={1.8} height={2.9} rx={0.5} fill={WAX_WARM} opacity={0.95} />
      <Path d={`M${cx} 54.4 C${cx - 1.25} 55.9 ${cx - 1} 57 ${cx} 57.6 C${cx + 1} 57 ${cx + 1.25} 55.9 ${cx} 54.4 Z`} fill={FLAME_OUT} />
      <Path d={`M${cx} 55.2 C${cx - 0.7} 56.2 ${cx - 0.55} 57 ${cx} 57.3 C${cx + 0.55} 57 ${cx + 0.7} 56.2 ${cx} 55.2 Z`} fill={FLAME_CORE} />
      <Rect x={cx - 0.45} y={53.4} width={0.9} height={7} fill={BRASS_HOT} />
      <Rect x={cx - 3.2} y={56.4} width={6.4} height={0.7} fill={BRASS_HOT} />
      <Circle cx={cx} cy={56.5} r={12} fill="url(#sglHalo)" />
      {/* warm light finding the arch: jambs, the curve overhead, and the sill below */}
      <Rect x={cx - 7} y={51.5} width={1.3} height={24} fill={SPILL} opacity={0.38} />
      <Rect x={cx + 5.7} y={51.5} width={1.3} height={24} fill={SPILL} opacity={0.3} />
      <Path d={`M${cx - 6.6} 51 A6.6 6.6 0 0 1 ${cx + 6.6} 51`} fill="none" stroke={SPILL} strokeWidth={1.2} opacity={0.28} />
      <Ellipse cx={cx} cy={76.4} rx={8.8} ry={1.8} fill="url(#sglWash)" />
    </AnimatedG>
  );
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function SignalLanterns({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const litL = useSharedValue(lit ? 1 : 0); // left lantern: kindles first, dies last
  const litR = useSharedValue(lit ? 1 : 0); // right lantern: follows ~300ms, fades first

  // Mount the lantern light only while lit, with a fade tail (covers the 120ms extinguish stagger
  // + 450ms fade). No unlit hint layer: the steeple holds the dark on its own, nothing pulses.
  const [glowing, setGlowing] = useState(lit);
  useEffect(() => {
    if (lit) {
      setGlowing(true);
      return;
    }
    const t = setTimeout(() => setGlowing(false), 640);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: cancel the loops and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(litL);
    cancelAnimation(litR);
    if (lit) {
      if (still) {
        litL.value = 1;
        litR.value = 1;
        return;
      }
      // Left kindles, right follows ~300ms later; then independent gentle flickers on slightly
      // different periods so they never sync (same trick as the old belfry pair).
      const flick = (lo: number, dur: number) =>
        withRepeat(withSequence(withTiming(lo, { duration: dur, easing: SIN }), withTiming(1, { duration: dur, easing: SIN })), -1, true);
      if (litR.value > 0.99) {
        // Both already burning (refocus while lit, or a cold mount into a lit beacon):
        // skip the kindle stagger and resume the flickers directly.
        litL.value = flick(0.8, 860);
        litR.value = flick(0.8, 990);
        return;
      }
      litL.value = withSequence(withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) }), flick(0.8, 860));
      litR.value = withDelay(300, withSequence(withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) }), flick(0.8, 990)));
    } else {
      if (still || litL.value < 0.01) {
        // Already dark (or pinned): no extinguish to play, and nothing loops while unlit.
        litL.value = 0;
        litR.value = 0;
        return;
      }
      // Extinguish: right first, left trails.
      litR.value = withTiming(0, { duration: 450 });
      litL.value = withDelay(120, withTiming(0, { duration: 450 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(litL); cancelAnimation(litR); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="sglInner" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFF6D8" stopOpacity={0.9} />
          <Stop offset="55%" stopColor="#FFD98C" stopOpacity={0.4} />
          <Stop offset="100%" stopColor="#FFD98C" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="sglHalo" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFD89A" stopOpacity={0.5} />
          <Stop offset="55%" stopColor="#FF9A3C" stopOpacity={0.18} />
          <Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="sglWash" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFC97E" stopOpacity={0.45} />
          <Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.18} />
          <Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* ===== BRICK TOWER TOP (y 85..100): courses of red brick under the belfry ===== */}
      <Rect x={27} y={85} width={46} height={15} fill={BRICK} />
      {BRICK_ROWS.map((y, i) => (
        <Line key={`br${i}`} x1={27.5} y1={y} x2={72.5} y2={y} stroke={MORTAR} strokeWidth={0.7} />
      ))}
      {BRICK_JOINTS.map(([x, y1, y2], i) => (
        <Line key={`bj${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={MORTAR} strokeWidth={0.6} opacity={0.9} />
      ))}
      <Rect x={64} y={85} width={9} height={15} fill="#3A150F" opacity={0.4} />
      <Line x1={27.5} y1={85.5} x2={27.5} y2={99.5} stroke={MOON} strokeWidth={0.5} opacity={0.2} />
      {/* white cornice capping the brick */}
      <Rect x={25.6} y={82.5} width={48.8} height={2.7} fill={WHITE} />
      <Rect x={25.6} y={85} width={48.8} height={0.9} fill={WHITE_SH} />
      <Line x1={26} y1={82.8} x2={74} y2={82.8} stroke={MOON} strokeWidth={0.5} opacity={0.22} />

      {/* ===== BELFRY STAGE (x 30..70, y 38..82.5): white clapboard, pilasters, two arches ===== */}
      <Rect x={30} y={38} width={40} height={44.6} fill={WHITE} />
      <Rect x={58} y={38} width={12} height={44.6} fill={WHITE_SH} />
      {SIDING_YS.map((y, i) => (
        <Line key={`sd${i}`} x1={30.6} y1={y} x2={69.4} y2={y} stroke={SIDING} strokeWidth={0.4} opacity={0.7} />
      ))}
      {/* corner pilasters */}
      <Rect x={30} y={38} width={2.8} height={44.6} fill={WHITE_HI} />
      <Line x1={32.8} y1={38.5} x2={32.8} y2={82} stroke={SIDING} strokeWidth={0.5} opacity={0.8} />
      <Rect x={67.2} y={38} width={2.8} height={44.6} fill={WHITE_SH} />
      <Line x1={67.2} y1={38.5} x2={67.2} y2={82} stroke={SIDING} strokeWidth={0.5} opacity={0.8} />
      {/* the two tall arched openings, dark inside */}
      <Path d={archD(41)} fill={DARK} />
      <Path d={archD(41)} fill="none" stroke={WHITE_HI} strokeWidth={0.8} opacity={0.85} />
      <Path d={archD(59)} fill={DARK} />
      <Path d={archD(59)} fill="none" stroke={WHITE_HI} strokeWidth={0.8} opacity={0.85} />
      {/* sills */}
      <Rect x={32.8} y={75.6} width={16.4} height={1.5} fill={WHITE} />
      <Rect x={32.8} y={77.1} width={16.4} height={0.7} fill={WHITE_SH} />
      <Rect x={50.8} y={75.6} width={16.4} height={1.5} fill={WHITE} />
      <Rect x={50.8} y={77.1} width={16.4} height={0.7} fill={WHITE_SH} />

      {/* ===== THE TWO LANTERNS, hanging inside the arches ===== */}
      <Lantern cx={41} />
      <Lantern cx={59} />

      {/* ===== ABOVE THE BELFRY: cornice, small open stage, spire, weathervane ===== */}
      <Rect x={28} y={35.8} width={44} height={2.9} fill={WHITE} />
      <Rect x={28} y={38.4} width={44} height={0.9} fill={WHITE_SH} />
      <Rect x={37} y={25.4} width={26} height={10.4} fill={WHITE} />
      <Rect x={56} y={25.4} width={7} height={10.4} fill={WHITE_SH} />
      {[43, 50, 57].map((c, i) => (
        <Path key={`so${i}`} d={`M${c - 2.2} 34.4 L${c - 2.2} 30.2 A2.2 2.2 0 0 1 ${c + 2.2} 30.2 L${c + 2.2} 34.4 Z`} fill={DARK} />
      ))}
      <Rect x={35.4} y={23.4} width={29.2} height={2.2} fill={WHITE} />
      <Rect x={35.4} y={25.4} width={29.2} height={0.7} fill={WHITE_SH} />
      {/* spire */}
      <Path d="M37.4 23.4 L50 6 L62.6 23.4 Z" fill={WHITE} />
      <Path d="M50 6 L62.6 23.4 L50 23.4 Z" fill={WHITE_SH} />
      <Line x1={45.7} y1={12} x2={54.3} y2={12} stroke={SIDING} strokeWidth={0.4} opacity={0.6} />
      <Line x1={42.4} y1={16.5} x2={57.6} y2={16.5} stroke={SIDING} strokeWidth={0.4} opacity={0.6} />
      <Line x1={39.5} y1={20.5} x2={60.5} y2={20.5} stroke={SIDING} strokeWidth={0.4} opacity={0.6} />
      {/* weathervane */}
      <Line x1={50} y1={6} x2={50} y2={2.2} stroke={IRON} strokeWidth={0.7} />
      <Circle cx={50} cy={5} r={0.85} fill={BRASS} />
      <Line x1={46.8} y1={3.1} x2={53} y2={3.1} stroke={IRON} strokeWidth={0.6} />
      <Path d="M53.4 3.1 L51.6 2.3 L51.6 3.9 Z" fill={IRON} />
      <Path d="M46.8 2.4 L48.6 3.1 L46.8 3.8 Z" fill={IRON} />
      {/* cool moon glints so the steeple silhouette reads in the dark */}
      <Line x1={49.6} y1={6.9} x2={38.6} y2={22.9} stroke={MOON} strokeWidth={0.55} opacity={0.5} strokeLinecap="round" />
      <Line x1={30.4} y1={39.5} x2={30.4} y2={81} stroke={MOON} strokeWidth={0.5} opacity={0.28} />

      {/* Kindled light: left leads on ignite, right leads on extinguish */}
      {glowing && <LanternLight cx={41} op={litL} />}
      {glowing && <LanternLight cx={59} op={litR} />}
    </Svg>
  );
}
