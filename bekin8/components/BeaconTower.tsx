// components/BeaconTower.tsx
// The "Two Lanterns" beacon, Old North Church (Boston), modeled on the real building: a tall WHITE
// tiered steeple (spire + finial → upper tier → open belfry with arched louvered openings) on top of
// a RED-BRICK square tower (tall arched window, the Paul Revere plaque, an arched door). The TWO
// signal lanterns glow in the belfry openings on lit, staggered (one catches, then the other).
// "One if by land, two if by sea." Animated (reanimated); home drives the ignite sound + haptic.
// No clock (the real steeple in the iconic view doesn't show one). Authored 0..100; 180×180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, RadialGradient, Stop, Path, Rect, Circle, Line, G } from 'react-native-svg';
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

const WHITE = '#ECE8DC';
const WHITE_SH = '#CFC9B6';
const TRIM = '#F4F1E8';
const BRICK = '#8C3B2C';
const BRICK_SH = '#6F2E22';
const MORTAR = '#5C2620';
const DARK = '#241E18';
const PLAQUE = '#CBB68A';
const GOLD = '#D7B45A';

// A lit signal lantern (warm body + flame + halo) shown in a belfry opening. cy ≈ belfry middle.
function Lantern({ op, cx }: { op: SharedValue<number>; cx: number }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={cx} cy={37} r={9} fill="url(#twGlow)" />
      <Rect x={cx - 1.8} y={33.5} width={3.6} height={7.5} rx={1.2} fill="#FFE9B0" />
      <Path d={`M${cx} 35 C${cx - 1.8} 36.6 ${cx - 1.4} 39 ${cx} 40.2 C${cx + 1.4} 39 ${cx + 1.8} 36.6 ${cx} 35 Z`} fill="#FFF6D8" />
    </AnimatedG>
  );
}

export default function BeaconTower({ lit, size = 180 }: { lit: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const glowL = useSharedValue(0);
  const glowR = useSharedValue(0);
  // Mount the glowing lanterns ONLY while lit (+ a fade tail) so unlit is unambiguously dark glass.
  const [glowing, setGlowing] = useState(lit);
  useEffect(() => {
    if (lit) {
      setGlowing(true);
      return;
    }
    const t = setTimeout(() => setGlowing(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    if (lit) {
      if (reduce) {
        glowL.value = 1;
        glowR.value = 1;
        return;
      }
      const flick = (lo: number, dur: number) =>
        withRepeat(withSequence(withTiming(lo, { duration: dur, easing: SIN }), withTiming(1, { duration: dur, easing: SIN })), -1, true);
      glowL.value = withSequence(withTiming(1, { duration: 360 }), flick(0.72, 720));
      glowR.value = withDelay(220, withSequence(withTiming(1, { duration: 360 }), flick(0.7, 780)));
    } else {
      cancelAnimation(glowL);
      cancelAnimation(glowR);
      glowL.value = withTiming(0, { duration: 420 });
      glowR.value = withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce]);

  useEffect(() => () => { cancelAnimation(glowL); cancelAnimation(glowR); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="twGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFD89A" stopOpacity={0.95} />
          <Stop offset="55%" stopColor="#FF9A3C" stopOpacity={0.3} />
          <Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* ===== WHITE STEEPLE (top) ===== */}
      {/* Weathervane + finial */}
      <Line x1="50" y1="6" x2="50" y2="0.5" stroke={GOLD} strokeWidth="0.9" />
      <Path d="M50 1 l4 1.4 l-4 1.4 z" fill={GOLD} />
      <Circle cx="50" cy="6.2" r="1.2" fill={GOLD} />

      {/* Spire */}
      <Path d="M50 6 L56.5 25 L43.5 25 Z" fill={WHITE} />
      <Path d="M50 6 L56.5 25 L50 25 Z" fill={WHITE_SH} />

      {/* Upper tier under the spire */}
      <Rect x="44.5" y="24" width="11" height="4.5" fill={WHITE} />
      <Rect x="50" y="24" width="5.5" height="4.5" fill={WHITE_SH} />

      {/* Belfry: open white stage with two tall arched louvered openings (the lanterns sit here) */}
      <Rect x="39.5" y="29" width="21" height="2.6" fill={WHITE} />
      <Rect x="39.5" y="42.5" width="21" height="2.8" rx="0.5" fill={WHITE} />
      <Rect x="39.5" y="31" width="2.6" height="11.5" fill={WHITE} />
      <Rect x="57.9" y="31" width="2.6" height="11.5" fill={WHITE_SH} />
      <Rect x="49" y="31" width="2" height="11.5" fill={WHITE_SH} />
      {/* arched openings (dark, louvered) */}
      <Path d="M43 42.5 L43 35 Q43 32 45.6 32 Q48.2 32 48.2 35 L48.2 42.5 Z" fill={DARK} />
      <Path d="M51.8 42.5 L51.8 35 Q51.8 32 54.4 32 Q57 32 57 35 L57 42.5 Z" fill={DARK} />
      <Line x1="43" y1="37" x2="48.2" y2="37" stroke="#3A332A" strokeWidth="0.5" />
      <Line x1="43" y1="39.5" x2="48.2" y2="39.5" stroke="#3A332A" strokeWidth="0.5" />
      <Line x1="51.8" y1="37" x2="57" y2="37" stroke="#3A332A" strokeWidth="0.5" />
      <Line x1="51.8" y1="39.5" x2="57" y2="39.5" stroke="#3A332A" strokeWidth="0.5" />

      {/* White cornice the brick tower carries */}
      <Rect x="37.5" y="45.5" width="25" height="4.2" fill={WHITE} />
      <Rect x="55.5" y="45.5" width="7" height="4.2" fill={WHITE_SH} />

      {/* ===== RED BRICK TOWER (bottom) ===== */}
      <Rect x="37.5" y="49.5" width="25" height="44.5" fill={BRICK} />
      <Rect x="56" y="49.5" width="6.5" height="44.5" fill={BRICK_SH} />
      {/* mortar courses */}
      {[54, 58.5, 63, 67.5, 72, 76.5, 81, 85.5, 90].map((y) => (
        <Line key={`m${y}`} x1="37.5" y1={y} x2="62.5" y2={y} stroke={MORTAR} strokeWidth="0.4" opacity={0.7} />
      ))}
      {/* tall arched window (white trim + dark glass + muntins) */}
      <Path d="M44 70 L44 61 Q44 55.5 50 55.5 Q56 55.5 56 61 L56 70 Z" fill={TRIM} />
      <Path d="M45.2 68.8 L45.2 61.4 Q45.2 56.7 50 56.7 Q54.8 56.7 54.8 61.4 L54.8 68.8 Z" fill={DARK} />
      <Line x1="50" y1="57" x2="50" y2="68.8" stroke={TRIM} strokeWidth="0.5" opacity={0.8} />
      <Line x1="45.2" y1="63" x2="54.8" y2="63" stroke={TRIM} strokeWidth="0.5" opacity={0.7} />
      {/* Paul Revere plaque */}
      <Rect x="44" y="73.5" width="12" height="6" rx="0.6" fill={PLAQUE} stroke={MORTAR} strokeWidth="0.4" />
      <Line x1="45.5" y1="75.5" x2="54.5" y2="75.5" stroke="#9A8866" strokeWidth="0.4" />
      <Line x1="45.5" y1="77.2" x2="54.5" y2="77.2" stroke="#9A8866" strokeWidth="0.4" />
      {/* arched door */}
      <Path d="M45.5 94 L45.5 87 Q45.5 83 50 83 Q54.5 83 54.5 87 L54.5 94 Z" fill={DARK} />

      {/* The two signal lanterns, lit (only while glowing; dark openings show otherwise) */}
      {glowing && <Lantern op={glowL} cx={45.6} />}
      {glowing && <Lantern op={glowR} cx={54.4} />}
    </Svg>
  );
}
