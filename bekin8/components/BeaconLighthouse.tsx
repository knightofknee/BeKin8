// components/BeaconLighthouse.tsx
// The "Lighthouse" beacon STRUCTURE: a tapered red-and-white coastal tower, domed lantern room with
// glazing bars, a railed gallery, candy-banded shaft on a rocky plinth. When LIT the lantern room
// glows warm and steady (the SWEEPING beam is a separate full-screen layer, BeaconLighthouseBeam,
// rendered by home in place of BeaconFire). Authored 0..100; 180×180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Path, Rect, Circle, Line, G, ClipPath } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);
const SIN = Easing.inOut(Easing.sin);

const WHITE = '#ECE7DA';
const WHITE_SH = '#C7C0AD';
const RED = '#C23A2B';
const RED_SH = '#9A2B20';
const DARK = '#221C18';
const METAL = '#2C2A30';
const GLASS_OFF = '#39414C';
const GOLD = '#D7B45A';

// Tapered shaft edges: top (y=34) half-width 11, bottom (y=92) half-width 20, centered at x=50.
const TOP_Y = 34, BOT_Y = 92;
const leftX = (y: number) => 50 - (11 + (20 - 11) * (y - TOP_Y) / (BOT_Y - TOP_Y));
const rightX = (y: number) => 50 + (11 + (20 - 11) * (y - TOP_Y) / (BOT_Y - TOP_Y));
const f = (n: number) => n.toFixed(1);
// A horizontal band trapezoid clipped to the shaft taper.
const band = (y0: number, y1: number) =>
  `M${f(leftX(y0))} ${f(y0)} L${f(rightX(y0))} ${f(y0)} L${f(rightX(y1))} ${f(y1)} L${f(leftX(y1))} ${f(y1)} Z`;

export default function BeaconLighthouse({ lit, size = 180, focused = true }: { lit: boolean; size?: number; focused?: boolean }) {
  const reduce = useReducedMotion();
  const glow = useSharedValue(lit ? 1 : 0);
  const [glowing, setGlowing] = useState(lit);

  useEffect(() => {
    if (lit) {
      setGlowing(true);
      return;
    }
    const t = setTimeout(() => setGlowing(false), 460);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: cancel the breathe loop and pin the lit glow while covered.
    const still = reduce || !focused;
    cancelAnimation(glow);
    if (lit) {
      if (still) {
        glow.value = 1;
        return;
      }
      // steady warm lantern with a slow breathe (the beam layer carries the flash drama).
      glow.value = withSequence(
        withTiming(1, { duration: 420 }),
        withRepeat(withSequence(withTiming(0.82, { duration: 1100, easing: SIN }), withTiming(1, { duration: 1100, easing: SIN })), -1, true)
      );
    } else {
      glow.value = withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => cancelAnimation(glow), []); // eslint-disable-line react-hooks/exhaustive-deps

  const glowProps = useAnimatedProps(() => ({ opacity: glow.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="lhLantern" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFF7DA" stopOpacity={1} />
          <Stop offset="55%" stopColor="#FFD98C" stopOpacity={0.5} />
          <Stop offset="100%" stopColor="#FFD98C" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="lhShaft" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor={WHITE} />
          <Stop offset="62%" stopColor={WHITE} />
          <Stop offset="100%" stopColor={WHITE_SH} />
        </LinearGradient>
        <ClipPath id="lhShaftClip">
          <Path d={`M${f(leftX(TOP_Y))} ${TOP_Y} L${f(rightX(TOP_Y))} ${TOP_Y} L${f(rightX(BOT_Y))} ${BOT_Y} L${f(leftX(BOT_Y))} ${BOT_Y} Z`} />
        </ClipPath>
      </Defs>

      {/* rocky plinth the tower stands on */}
      <Path d="M22 92 L30 84 L38 90 L50 82 L62 90 L70 84 L78 92 L82 99 L18 99 Z" fill="#1B1A20" />
      <Path d="M22 92 L30 84 L38 90 L50 82 L62 90 L70 84 L78 92 Z" fill="#272631" opacity={0.7} />

      {/* ===== SHAFT (tapered) with candy bands + cylindrical shading ===== */}
      <Path d={`M${f(leftX(TOP_Y))} ${TOP_Y} L${f(rightX(TOP_Y))} ${TOP_Y} L${f(rightX(BOT_Y))} ${BOT_Y} L${f(leftX(BOT_Y))} ${BOT_Y} Z`} fill="url(#lhShaft)" />
      <G clipPath="url(#lhShaftClip)">
        <Path d={band(38, 47)} fill={RED} />
        <Path d={band(58, 67)} fill={RED} />
        <Path d={band(79, 88)} fill={RED} />
        {/* right-side shading for cylindrical volume */}
        <Path d={`M50 ${TOP_Y} L${f(rightX(TOP_Y))} ${TOP_Y} L${f(rightX(BOT_Y))} ${BOT_Y} L50 ${BOT_Y} Z`} fill="#000000" opacity={0.14} />
        {/* a thin bright highlight down the left */}
        <Rect x={f(leftX(60))} y={TOP_Y} width={2} height={BOT_Y - TOP_Y} fill="#FFFFFF" opacity={0.18} />
      </G>
      {/* window + door */}
      <Rect x="47.5" y="52" width="5" height="6.5" rx="1.2" fill={DARK} />
      <Path d="M45.5 92 L45.5 84 Q45.5 80 50 80 Q54.5 80 54.5 84 L54.5 92 Z" fill={DARK} />

      {/* ===== GALLERY (platform + railing) ===== */}
      <Rect x="35" y="30.5" width="30" height="3.5" rx="1" fill={METAL} />
      <Rect x="35" y="30.5" width="30" height="1.2" fill="#3E3C44" />
      {[37.5, 42, 46.5, 50, 53.5, 58, 62.5].map((x, i) => (
        <Rect key={`rail${i}`} x={x} y="26.5" width="1.1" height="4" fill={METAL} />
      ))}
      <Rect x="36" y="26" width="28" height="1.2" fill={METAL} />

      {/* ===== LANTERN ROOM (glass) ===== */}
      <Rect x="40.5" y="17" width="19" height="10" fill={GLASS_OFF} />
      {/* warm lit glow (mounted only while glowing) */}
      {glowing && (
        <AnimatedG animatedProps={glowProps}>
          <Circle cx="50" cy="22" r="15" fill="url(#lhLantern)" />
          <Rect x="41.5" y="18" width="17" height="8" fill="#FFE9AE" opacity={0.9} />
          <Circle cx="50" cy="22" r="3.4" fill="#FFFDF0" />
        </AnimatedG>
      )}
      {/* glazing bars (astragals) over the glass */}
      {[43.5, 47, 50, 53, 56.5].map((x, i) => (
        <Rect key={`bar${i}`} x={x} y="17" width="1" height="10" fill={METAL} />
      ))}
      <Rect x="40.5" y="17" width="19" height="1.4" fill={METAL} />
      <Rect x="40.5" y="25.6" width="19" height="1.4" fill={METAL} />

      {/* ===== DOME + finial ===== */}
      <Path d="M40 17 Q50 4 60 17 Z" fill={RED_SH} />
      <Path d="M40 17 Q50 4 60 17 L50 17 Z" fill={RED} />
      <Line x1="50" y1="9" x2="50" y2="3" stroke={GOLD} strokeWidth="0.9" />
      <Circle cx="50" cy="3" r="1.4" fill={GOLD} />
    </Svg>
  );
}
