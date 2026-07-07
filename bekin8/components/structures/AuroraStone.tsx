// components/structures/AuroraStone.tsx
// The Aurora skin's tap target: an ancient STANDING RUNE STONE on arctic snow, big and instantly
// readable against the polar night. A tall weathered monolith (y=26..88) with beveled facets, moss
// and lichen, fine cracks, its base buried in a snow drift. Carved into the face: a branching rune
// (x=50, y 38..72). NO FLAME SEAT: the skin's fire is 'none' (origin 0.5 is only a nominal anchor);
// THIS STRUCTURE OWNS ITS LIGHT. Unlit: a faint cyan glimmer breathes in the carving (the stone
// remembers). Lit: the rune IGNITES bottom-to-top over ~700ms (four staggered segment groups), a
// cyan halo blooms around the stone, the snow catches an under-glow, then the whole glyph settles
// into a gentle breathing pulse. Extinguish drains top-to-bottom over ~600ms back to the glimmer.
// Authored 0..100; 180x180 footprint. Animated (reanimated); reduced motion snaps between states.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, RadialGradient, Stop, Ellipse, Circle, Path, Line, G } from 'react-native-svg';
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

// Stone palette (cold slate, one plane brighter, one in shadow)
const BODY = '#232B36';
const FACET = '#2E3846';
const SHADOW = '#161C26';
const CRACK = '#10161F';
const CARVE = '#131A25'; // the incised rune when nothing glows in it
const RIM_WARM = '#CFC0A0'; // low-moon warm edge light so the silhouette pops
const RIM_COOL = '#5E708C';
// Ground
const SNOW = '#2A3644';
const SNOW_HI = '#48586E';
// Growth
const MOSS = '#3A4A34';
const MOSS_2 = '#465A3C';
const LICHEN = '#6E7A5E';
// Rune light (skin mid/core family)
const HINT = '#7FDCD0';
const GLOW = '#9FF0E0';
const CORE = '#EAFFFB';

// The branching glyph, split into four segment groups BOTTOM to TOP so ignition can climb the stone
// and extinguish can drain back down. Stem runs x=50, y 72..38; each group owns its stem slice plus
// its pair of branches (roots, low arms, high arms, crown fork).
const G1_ROOTS = ['M50 72 L50 60', 'M50 66.5 L45 71.5', 'M50 66.5 L55 71.5'];
const G2_LOW = ['M50 60 L50 52', 'M50 58.5 L45.4 54', 'M50 58.5 L54.6 54'];
const G3_HIGH = ['M50 52 L50 44', 'M50 50.5 L44.6 44.8', 'M50 50.5 L55.4 44.8'];
const G4_CROWN = ['M50 44 L50 38.2', 'M50 42.8 L46.6 38.6', 'M50 42.8 L53.4 38.6'];
const GLYPH_ALL = [...G1_ROOTS, ...G2_LOW, ...G3_HIGH, ...G4_CROWN];

// Stroke-draws one set of glyph paths in a single color/weight.
function GlyphStrokes({ d, color, width, opacity }: { d: string[]; color: string; width: number; opacity?: number }) {
  return (
    <>
      {d.map((p, i) => (
        <Path key={i} d={p} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" opacity={opacity} />
      ))}
    </>
  );
}

// One ignited segment group: soft wide bloom, bright stroke, white-cyan core. Opacity-driven so the
// four groups can stagger (same stable-subcomponent hook pattern as the tower's lanterns).
function RuneSegment({ op, d }: { op: SharedValue<number>; d: string[] }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <GlyphStrokes d={d} color={GLOW} width={3.8} opacity={0.32} />
      <GlyphStrokes d={d} color={GLOW} width={1.8} />
      <GlyphStrokes d={d} color={CORE} width={0.8} />
    </AnimatedG>
  );
}

// Opacity-animated group (mounted only while relevant, with a fade tail, matching CampfireLogs).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function AuroraStone({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const hintOp = useSharedValue(lit ? 0 : 0.25); // breathing glimmer in the carving (unlit only)
  const haloOp = useSharedValue(lit ? 1 : 0); // stone halo + snow under-glow (lit only)
  const seg1 = useSharedValue(lit ? 1 : 0); // roots
  const seg2 = useSharedValue(lit ? 1 : 0); // low arms
  const seg3 = useSharedValue(lit ? 1 : 0); // high arms
  const seg4 = useSharedValue(lit ? 1 : 0); // crown fork
  const pulseOp = useSharedValue(1); // gentle breath over the whole ignited glyph

  // Mount the glimmer only while unlit and the ignited layers only while lit, each with a fade tail
  // long enough to cover the climb/drain.
  const [hinting, setHinting] = useState(!lit);
  const [litOn, setLitOn] = useState(lit);
  useEffect(() => {
    if (lit) {
      setLitOn(true);
      const t = setTimeout(() => setHinting(false), 360);
      return () => clearTimeout(t);
    }
    setHinting(true);
    const t = setTimeout(() => setLitOn(false), 720);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: cancel the loops and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(hintOp);
    cancelAnimation(haloOp);
    cancelAnimation(seg1);
    cancelAnimation(seg2);
    cancelAnimation(seg3);
    cancelAnimation(seg4);
    cancelAnimation(pulseOp);
    if (lit) {
      if (still) {
        // Snap straight to the ignited state.
        hintOp.value = 0;
        haloOp.value = 1;
        seg1.value = 1;
        seg2.value = 1;
        seg3.value = 1;
        seg4.value = 1;
        pulseOp.value = 1;
        return;
      }
      if (seg4.value > 0.99) {
        // Already fully caught (refocus while lit, or a cold mount into a lit beacon):
        // skip the ignition climb and go straight to the breath.
        hintOp.value = 0;
        haloOp.value = 1;
        seg1.value = 1;
        seg2.value = 1;
        seg3.value = 1;
        seg4.value = 1;
        pulseOp.value = withRepeat(
          withSequence(withTiming(0.85, { duration: 1300, easing: SIN }), withTiming(1, { duration: 1300, easing: SIN })),
          -1,
          false,
        );
        return;
      }
      hintOp.value = withTiming(0, { duration: 260 });
      // Ignition climbs the glyph bottom-to-top over ~700ms.
      const catchOn = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
      seg1.value = catchOn;
      seg2.value = withDelay(150, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
      seg3.value = withDelay(300, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
      seg4.value = withDelay(450, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
      haloOp.value = withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }));
      // Once fully caught: a slow breath, never dropping enough to read as flicker.
      pulseOp.value = 1;
      pulseOp.value = withDelay(
        750,
        withRepeat(withSequence(withTiming(0.85, { duration: 1300, easing: SIN }), withTiming(1, { duration: 1300, easing: SIN })), -1, false),
      );
    } else {
      if (still) {
        // Static faint glimmer instead of the breathing loop.
        hintOp.value = 0.4;
        haloOp.value = 0;
        seg1.value = 0;
        seg2.value = 0;
        seg3.value = 0;
        seg4.value = 0;
        pulseOp.value = 1;
        return;
      }
      if (seg1.value < 0.01) {
        // Already drained (refocus while unlit): skip replaying the drain, resume the glimmer.
        haloOp.value = 0;
        seg1.value = 0;
        seg2.value = 0;
        seg3.value = 0;
        seg4.value = 0;
        pulseOp.value = 1;
        hintOp.value = withRepeat(
          withSequence(withTiming(0.55, { duration: 1200, easing: SIN }), withTiming(0.25, { duration: 1200, easing: SIN })),
          -1,
          false,
        );
        return;
      }
      // Extinguish drains top-to-bottom over ~600ms.
      pulseOp.value = withTiming(1, { duration: 180 });
      seg4.value = withTiming(0, { duration: 200 });
      seg3.value = withDelay(130, withTiming(0, { duration: 200 }));
      seg2.value = withDelay(260, withTiming(0, { duration: 200 }));
      seg1.value = withDelay(390, withTiming(0, { duration: 220 }));
      haloOp.value = withTiming(0, { duration: 480 });
      hintOp.value = withSequence(
        withTiming(0.25, { duration: 420, easing: SIN }),
        withRepeat(withSequence(withTiming(0.55, { duration: 1200, easing: SIN }), withTiming(0.25, { duration: 1200, easing: SIN })), -1, false),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(
    () => () => {
      cancelAnimation(hintOp);
      cancelAnimation(haloOp);
      cancelAnimation(seg1);
      cancelAnimation(seg2);
      cancelAnimation(seg3);
      cancelAnimation(seg4);
      cancelAnimation(pulseOp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="arsHalo" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={GLOW} stopOpacity={0.55} />
          <Stop offset="55%" stopColor="#5FC8EE" stopOpacity={0.22} />
          <Stop offset="100%" stopColor="#5FC8EE" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="arsSnowGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={GLOW} stopOpacity={0.5} />
          <Stop offset="60%" stopColor="#5FC8EE" stopOpacity={0.2} />
          <Stop offset="100%" stopColor="#5FC8EE" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="arsGlim" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={HINT} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={HINT} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* Ground shadow seats the monolith in the snowfield */}
      <Ellipse cx="50" cy="91" rx="42" ry="7" fill="#0A0F18" opacity={0.5} />

      {/* Lit: cyan halo blooming out from behind the stone */}
      {litOn && (
        <Fade op={haloOp}>
          <Ellipse cx="50" cy="55" rx="36" ry="44" fill="url(#arsHalo)" />
        </Fade>
      )}

      {/* ===== THE MONOLITH (y 26..88, slightly asymmetric) ===== */}
      <Path d="M46.5 26 L57 28.5 L61.5 45 L62.5 66 L60.5 88 L39.5 88 L37.6 62 L40 40 Z" fill={BODY} />
      {/* beveled crown facet catching the sky */}
      <Path d="M46.5 26 L57 28.5 L53.6 33.6 L43.2 32.6 Z" fill={FACET} />
      {/* long left bevel, the brighter plane */}
      <Path d="M43.2 32.6 L40 40 L37.9 62 L39.6 88 L43.6 88 L42.4 62 L44.2 40.5 Z" fill={FACET} opacity={0.75} />
      {/* shadow side */}
      <Path d="M57 28.5 L61.5 45 L62.5 66 L60.5 88 L56.8 88 L57.9 66 L57 45.5 Z" fill={SHADOW} />

      {/* warm rim light along the moonward edge, cool counter-rim on the dark side */}
      <Path d="M39.6 86 L37.7 62 L40 40 L46.5 26.4 L56.6 28.7" stroke={RIM_WARM} strokeWidth={0.9} strokeLinecap="round" fill="none" opacity={0.5} />
      <Path d="M61.4 45.5 L62.4 66" stroke={RIM_COOL} strokeWidth={0.6} strokeLinecap="round" fill="none" opacity={0.5} />

      {/* weathering: cracks, moss, lichen */}
      <Path d="M45 33.5 Q43.5 40 44.6 46" stroke={CRACK} strokeWidth={0.5} fill="none" opacity={0.8} />
      <Path d="M44.6 46 L46.2 49" stroke={CRACK} strokeWidth={0.4} fill="none" opacity={0.6} />
      <Path d="M59.5 50 Q58.6 55 59.8 60" stroke={CRACK} strokeWidth={0.45} fill="none" opacity={0.7} />
      <Path d="M41.5 70 Q43.5 74 42.8 79" stroke={CRACK} strokeWidth={0.5} fill="none" opacity={0.7} />
      <Ellipse cx="43.5" cy="78" rx="3.4" ry="2" fill={MOSS} opacity={0.85} />
      <Path d="M58 60 Q60.5 59 61.2 61.5 Q60.8 63.5 58.6 63 Q57.2 61.8 58 60 Z" fill={MOSS_2} opacity={0.8} />
      <Ellipse cx="55.5" cy="80" rx="2.6" ry="1.6" fill={MOSS} opacity={0.7} />
      <Circle cx="44.5" cy="36.5" r={1.1} fill={LICHEN} opacity={0.5} />
      <Circle cx="56.5" cy="72.5" r={0.9} fill={LICHEN} opacity={0.45} />
      <Circle cx="42" cy="60" r={0.8} fill={LICHEN} opacity={0.4} />

      {/* ===== THE RUNE (carved, x=50, y 38..72) ===== */}
      <GlyphStrokes d={GLYPH_ALL} color={CARVE} width={2.1} />

      {/* Unlit: faint cyan glimmer breathing in the carving */}
      {hinting && (
        <Fade op={hintOp}>
          <Ellipse cx="50" cy="55" rx="13" ry="21" fill="url(#arsGlim)" />
          <GlyphStrokes d={GLYPH_ALL} color={HINT} width={1.3} />
        </Fade>
      )}

      {/* Lit: the ignited glyph, four groups climbing bottom-to-top, all breathing together */}
      {litOn && (
        <Fade op={pulseOp}>
          <RuneSegment op={seg1} d={G1_ROOTS} />
          <RuneSegment op={seg2} d={G2_LOW} />
          <RuneSegment op={seg3} d={G3_HIGH} />
          <RuneSegment op={seg4} d={G4_CROWN} />
        </Fade>
      )}

      {/* ===== SNOW DRIFT (y 84..96, buries the base) ===== */}
      <Path d="M4 97 Q12 88 26 88.5 Q36 83.5 50 84.5 Q64 83.5 75 88.5 Q88 88 96 97 Z" fill={SNOW} />
      <Ellipse cx="38" cy="86.6" rx="12" ry="2.6" fill={SNOW_HI} opacity={0.75} />
      <Ellipse cx="58" cy="86.2" rx="11" ry="2.4" fill={SNOW_HI} opacity={0.7} />
      <Ellipse cx="20" cy="90" rx="9" ry="2.2" fill={SNOW_HI} opacity={0.5} />
      <Ellipse cx="79" cy="90" rx="8" ry="2" fill={SNOW_HI} opacity={0.5} />
      <Line x1="44" y1="85.2" x2="49" y2="84.9" stroke="#5D6E86" strokeWidth={0.6} strokeLinecap="round" opacity={0.8} />
      <Line x1="53" y1="84.9" x2="57" y2="85.3" stroke="#5D6E86" strokeWidth={0.6} strokeLinecap="round" opacity={0.7} />

      {/* Lit: the drift catches the rune's cyan under-glow */}
      {litOn && (
        <Fade op={haloOp}>
          <Ellipse cx="50" cy="87" rx="26" ry="7.5" fill="url(#arsSnowGlow)" />
        </Fade>
      )}
    </Svg>
  );
}
