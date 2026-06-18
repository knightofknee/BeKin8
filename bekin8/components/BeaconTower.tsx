// components/BeaconTower.tsx
// The "Two Lanterns" beacon — Paul Revere's signal ("one if by land, two if by sea"). A colonial
// church steeple (Old North Church: square tower → belfry w/ clock → open lantern stage → tall white
// spire + weathervane) with TWO lanterns at the lantern stage. On lit, both lanterns glow and flicker
// — staggered so one catches, then the other. Animated (reanimated); home drives the ignite sound +
// haptic, so this only handles the visual. Authored 0..100; shares the 180×180 footprint.
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

const WHITE = '#E8E4D6';
const SHADE = '#C6C0AE';
const TRIM = '#AFA995';
const DARK = '#2A2620';
const GLASS_OFF = '#3C362B';

function Lantern({ op, cx }: { op: SharedValue<number>; cx: number }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={cx} cy={33} r={10} fill="url(#twGlow)" />
      <Rect x={cx - 2} y={28.5} width={4} height={8.5} rx={1.4} fill="#FFE9B0" />
      <Path d={`M${cx} 30 C${cx - 2} 32 ${cx - 1.6} 35 ${cx} 36.5 C${cx + 1.6} 35 ${cx + 2} 32 ${cx} 30 Z`} fill="#FFF6D8" />
    </AnimatedG>
  );
}

export default function BeaconTower({ lit, size = 180 }: { lit: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const glowL = useSharedValue(0);
  const glowR = useSharedValue(0);
  // Only MOUNT the glowing lantern overlays while lit (+ a short fade tail). When unlit they don't
  // render at all, so the lanterns are unambiguously dark — no "lit-but-static" at mount/skin-select
  // (the animated opacity on an <AnimatedG> isn't reliably applied until a tween runs).
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

      {/* Spire + weathervane */}
      <Line x1="50" y1="6" x2="50" y2="1" stroke={TRIM} strokeWidth="1" />
      <Line x1="47" y1="2.5" x2="53" y2="2.5" stroke={TRIM} strokeWidth="1" />
      <Path d="M50 6 L57 28 L43 28 Z" fill={WHITE} />
      <Path d="M50 6 L57 28 L50 28 Z" fill={SHADE} />

      {/* Open lantern stage (the two lanterns sit between the columns) */}
      <Rect x="41" y="28" width="18" height="2.6" fill={WHITE} />
      <Rect x="41" y="38" width="18" height="2.6" rx="0.6" fill={WHITE} />
      <Rect x="41.5" y="29" width="2.2" height="9.6" fill={WHITE} />
      <Rect x="56.3" y="29" width="2.2" height="9.6" fill={WHITE} />
      <Rect x="49" y="29" width="2" height="9.6" fill={SHADE} />
      <Rect x="44" y="29" width="4.6" height="9.4" fill={DARK} />
      <Rect x="51.6" y="29" width="4.6" height="9.4" fill={DARK} />
      {/* unlit lantern bodies (warm overlay fades in on top when lit) */}
      <Rect x="44.3" y="29.4" width="4" height="8.6" rx="1.4" fill={GLASS_OFF} />
      <Rect x="51.9" y="29.4" width="4" height="8.6" rx="1.4" fill={GLASS_OFF} />

      {/* Belfry with a clock face */}
      <Rect x="39.5" y="41" width="21" height="11" fill={WHITE} />
      <Rect x="55" y="41" width="5.5" height="11" fill={SHADE} />
      <Circle cx="49" cy="46.5" r="3.4" fill="#F2EEE2" stroke={TRIM} strokeWidth="0.7" />
      <Line x1="49" y1="46.5" x2="49" y2="44.4" stroke={DARK} strokeWidth="0.6" />
      <Line x1="49" y1="46.5" x2="50.6" y2="46.5" stroke={DARK} strokeWidth="0.6" />

      {/* Square tower base */}
      <Rect x="37" y="52" width="26" height="42" fill={WHITE} />
      <Rect x="55.5" y="52" width="7.5" height="42" fill={SHADE} />
      <Rect x="37" y="52" width="26" height="42" fill="none" stroke={TRIM} strokeWidth="0.6" />
      {/* tall arched windows */}
      <Rect x="41" y="58" width="5" height="10" rx="2.5" fill={DARK} />
      <Rect x="54" y="58" width="5" height="10" rx="2.5" fill={DARK} />
      {/* door */}
      <Rect x="45.5" y="82" width="9" height="12" rx="3.5" fill={DARK} />

      {/* The two signal lanterns, lit (only rendered while glowing; dark glass shows otherwise) */}
      {glowing && <Lantern op={glowL} cx={46.3} />}
      {glowing && <Lantern op={glowR} cx={53.9} />}
    </Svg>
  );
}
