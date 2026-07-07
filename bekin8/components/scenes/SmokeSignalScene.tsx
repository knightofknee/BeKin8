// components/scenes/SmokeSignalScene.tsx
// The SMOKE SIGNAL backdrop (behind all tiles): golden-hour high desert in a clean southwest graphic
// style. Flat-shape composition: a warm dusk sky (dusty violet down through rose and salmon to a
// golden band where the sun just set), three stepped mesa silhouette layers, and a dark rocky ledge
// rising to meet the signal fire structure (anchor-aligned). A STATIC TEEPEE stands on the ledge to
// the LEFT of the fire: the dwelling whose keepers send the signals; it stays fully clear of the
// puff column above the anchor and below the 62% tile band. A few static birds ride high in the sky.
// The only motion is a slow breathe on the golden band; when the beacon is lit the band brightens
// ~10% and dusk advances a touch. The white smoke puffs are the hero and live in a separate layer.
// Because this scene is BRIGHT, legibility gets extra care: a flat 0.18 black dim over everything
// plus the standard top/bottom scrims, and the golden band's bright core sits below the 62% tile line.
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Line, Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { loopNoiseSigned, makeSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Slow ambient breathe for the golden band (long period so it reads as air, not a blink).
const BAND_BREATHE = makeSeed(4.2, 8.7, 1.2, 17.0);

// Mesa silhouettes as [xFrac, yFrac] vertex runs (flat tops, stepped sides). Each closes down to the
// bottom of the screen so nearer layers fully cover the base of farther ones.
const FAR_MESA: number[][] = [
  [0, 0.575], [0.04, 0.575], [0.04, 0.556], [0.07, 0.556], [0.07, 0.538], [0.2, 0.538], [0.2, 0.556],
  [0.23, 0.556], [0.23, 0.575], [0.3, 0.575], [0.36, 0.592], [0.52, 0.592], [0.55, 0.575], [0.58, 0.575],
  [0.58, 0.558], [0.62, 0.558], [0.62, 0.542], [0.78, 0.542], [0.78, 0.558], [0.82, 0.558], [0.82, 0.575],
  [0.88, 0.575], [0.92, 0.59], [1, 0.59],
];
const MID_MESA: number[][] = [
  [0, 0.66], [0.08, 0.66], [0.1, 0.645], [0.13, 0.645], [0.13, 0.625], [0.16, 0.625], [0.16, 0.607],
  [0.3, 0.607], [0.3, 0.625], [0.33, 0.625], [0.33, 0.645], [0.36, 0.645], [0.38, 0.66], [0.62, 0.66],
  [0.64, 0.645], [0.67, 0.645], [0.67, 0.63], [0.7, 0.63], [0.7, 0.613], [0.84, 0.613], [0.84, 0.63],
  [0.87, 0.63], [0.87, 0.648], [0.9, 0.648], [0.92, 0.663], [1, 0.663],
];
const NEAR_MESA: number[][] = [
  [0, 0.705], [0.05, 0.705], [0.05, 0.688], [0.09, 0.688], [0.09, 0.672], [0.22, 0.672], [0.22, 0.69],
  [0.26, 0.69], [0.26, 0.706], [0.4, 0.706], [0.42, 0.718], [0.6, 0.718], [0.62, 0.705], [0.66, 0.705],
  [0.66, 0.69], [0.7, 0.69], [0.7, 0.676], [0.82, 0.676], [0.82, 0.692], [0.86, 0.692], [0.86, 0.708],
  [1, 0.708],
];

function mesaPath(pts: number[][], W: number, H: number): string {
  let d = `M${pts[0][0] * W} ${pts[0][1] * H}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0] * W} ${pts[i][1] * H}`;
  return `${d} L${W} ${H} L0 ${H} Z`;
}

// Static birds: tiny gull chevrons, high in the (scrimmed) violet sky. Small and dim on purpose.
const BIRDS = [
  { x: 0.22, y: 0.075, s: 6 },
  { x: 0.3, y: 0.1, s: 4.5 },
  { x: 0.68, y: 0.06, s: 5.5 },
];
const birdPath = (x: number, y: number, s: number) =>
  `M${x - s} ${y + s * 0.55} Q${x - s * 0.45} ${y - s * 0.3} ${x} ${y + s * 0.12} Q${x + s * 0.45} ${y - s * 0.3} ${x + s} ${y + s * 0.55}`;

// Teepee palette, harmonized with the dusk scene: mesa umbers for the canvas, warmed on the side
// that faces the horizon glow (and the fire), plus muted cream/teal for the decorative band.
const TP_SUN = '#7E4B3A'; // canvas toward the glow
const TP_SHADE = '#4A2830'; // canvas away from the glow
const TP_FLAP_SUN = '#5C3630'; // sun-side smoke flap, a shade warmer than the shade canvas
const TP_POLE = '#2E1A16';
const TP_DOOR = '#241016';
const TP_CREAM = '#D9C598'; // dusty cousin of the golden band
const TP_TEAL = '#4A6B64';

export type SmokeSignalSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function SmokeSignalScene({
  skin,
  active,
  focused = true,
  anchorX,
  anchorY,
  measured = false,
}: SmokeSignalSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Ambient clock (band breathe), the shared gated clock: registered + paused unless motion is
  // allowed, exactly the BeaconScene gate so it costs nothing off-tab or under reduced motion.
  const { clock } = useGatedClock(focused && !reduce);

  // Lit state: initialized so mounting with active=true jumps straight to the lit look (no replay).
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      lit.value = active ? 1 : 0;
      return;
    }
    lit.value = withTiming(active ? 1 : 0, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Golden band: base glow, +10% while lit, slow breathe while motion runs.
  const bandProps = useAnimatedProps(() => ({
    opacity: 0.6 + lit.value * 0.06 + loopNoiseSigned(clock.value, BAND_BREATHE, 0.04),
  }));
  // Flat legibility dim over the whole bright scene; lighting the fire advances dusk a touch.
  const duskProps = useAnimatedProps(() => ({
    opacity: 0.18 + lit.value * 0.05,
  }));

  // Anchor-aligned foreground: the fire seat inside the 180px structure box. The stone ring's BACK
  // stones touch ground around seatY - 5 (ring spans viewBox y 60..82 with the seat at y 63), so the
  // plateau line must sit ABOVE them or the back of the ring floats against the glowing mesas;
  // shoulders fall away toward the bottom of the structure box and lower at the screen edges.
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const seatY = measured && anchorY != null ? anchorY : H * 0.72;
  const structureBottom = seatY + (1 - skin.origin) * 180;
  const plateauY = seatY - 10;
  const ledgePath =
    `M0 ${seatY + H * 0.08} L${W * 0.09} ${seatY + H * 0.06} L${W * 0.17} ${structureBottom + 8}` +
    ` L${seatX - 150} ${seatY + 30} L${seatX - 108} ${plateauY} L${seatX + 112} ${plateauY}` +
    ` L${seatX + 154} ${seatY + 34} L${W * 0.84} ${structureBottom + 14} L${W} ${seatY + H * 0.07}` +
    ` L${W} ${H} L0 ${H} Z`;

  // TEEPEE: the dwelling that explains who tends the signal fire. Fully static (no hooks, no
  // animation), standing ON the ledge plateau to the LEFT of the fire and drawn in front of the
  // mesas but behind the structure/tiles. Constraints carried by the math: centered near
  // seatX - 118 but at least 24px off the left screen edge, the whole cone kept left of
  // seatX - 55 so it never crosses the smoke puff column, and the apex plus pole tips kept below
  // the 62% tile band (the cone shrinks proportionally on layouts where 150px would poke into it).
  const tpBaseY = seatY + 26; // base sits on the ledge plateau line
  const tpH = Math.max(60, Math.min(150, tpBaseY - H * 0.62 - 22)); // ~150px tall when the band allows
  const tpS = tpH / 150; // detail scale so a clamped cone keeps its proportions
  const tpHalfW = 55 * tpS; // ~110px wide at the base at full size: a dwelling, bigger than the ring
  const tpX = Math.min(Math.max(seatX - 118, 24 + tpHalfW), seatX - 55 - tpHalfW);
  const tpApexY = tpBaseY - tpH;
  // Cone silhouette: slightly concave sides (taut canvas), base bowed down to sit on the rock.
  const tpCone =
    `M${tpX} ${tpApexY} Q${tpX - tpHalfW * 0.42} ${tpApexY + tpH * 0.55} ${tpX - tpHalfW} ${tpBaseY}` +
    ` Q${tpX} ${tpBaseY + 7 * tpS} ${tpX + tpHalfW} ${tpBaseY}` +
    ` Q${tpX + tpHalfW * 0.42} ${tpApexY + tpH * 0.55} ${tpX} ${tpApexY} Z`;
  // Sun-side wedge: the half of the canvas facing the horizon glow (and the fire) catches the light.
  const tpSunSide =
    `M${tpX} ${tpApexY} Q${tpX + tpHalfW * 0.42} ${tpApexY + tpH * 0.55} ${tpX + tpHalfW} ${tpBaseY}` +
    ` Q${tpX + tpHalfW * 0.5} ${tpBaseY + 5 * tpS} ${tpX + tpHalfW * 0.08} ${tpBaseY + 3 * tpS}` +
    ` Q${tpX - tpHalfW * 0.04} ${tpApexY + tpH * 0.5} ${tpX} ${tpApexY} Z`;
  // Decorative band stripe between height fractions f1..f2 (measured from the apex): the stripe
  // follows the cone's slanted edges and bows down slightly so it reads as wrapped canvas.
  const tpBand = (f1: number, f2: number) => {
    const y1 = tpApexY + tpH * f1;
    const w1 = tpHalfW * f1;
    const y2 = tpApexY + tpH * f2;
    const w2 = tpHalfW * f2;
    const bow = tpH * 0.035;
    return (
      `M${tpX - w1} ${y1} Q${tpX} ${y1 + bow} ${tpX + w1} ${y1}` +
      ` L${tpX + w2} ${y2} Q${tpX} ${y2 + bow} ${tpX - w2} ${y2} Z`
    );
  };
  // Five lodge pole tips crossing at the apex and poking ~18px above it (at full size).
  const tpPoles = [-1, -0.55, -0.1, 0.4, 0.9].map((k) => ({
    x1: tpX + k * 11 * tpS,
    y1: tpApexY - (18 - Math.abs(k) * 4) * tpS,
    x2: tpX - k * 6 * tpS,
    y2: tpApexY + 16 * tpS,
  }));
  // Smoke-flap V at the apex: two small canvas ears, the sun-side one a shade warmer.
  const tpFlapL = `M${tpX - tpS} ${tpApexY + 3 * tpS} L${tpX - 15 * tpS} ${tpApexY - 7 * tpS} L${tpX - 9 * tpS} ${tpApexY + 14 * tpS} Z`;
  const tpFlapR = `M${tpX + tpS} ${tpApexY + 3 * tpS} L${tpX + 15 * tpS} ${tpApexY - 7 * tpS} L${tpX + 9 * tpS} ${tpApexY + 14 * tpS} Z`;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          {/* dusk sky: dusty violet down through rose and salmon into the golden band */}
          <LinearGradient id="ssSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#5C3A5E" />
            <Stop offset="32%" stopColor="#A65C6E" />
            <Stop offset="50%" stopColor="#F2955F" />
            <Stop offset="64%" stopColor="#FFD98C" />
          </LinearGradient>
          {/* the golden band itself: bright core kept below the 62% tile line */}
          <LinearGradient id="ssBand" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFD98C" stopOpacity={0} />
            <Stop offset="48%" stopColor="#FFE9A6" stopOpacity={0.9} />
            <Stop offset="72%" stopColor="#FFC46B" stopOpacity={0.4} />
            <Stop offset="100%" stopColor="#FFC46B" stopOpacity={0} />
          </LinearGradient>
          {/* residual sun glow behind the mesas (the sun itself is already down) */}
          <RadialGradient id="ssSun" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFE9A6" stopOpacity={0.5} />
            <Stop offset="55%" stopColor="#FFD98C" stopOpacity={0.18} />
            <Stop offset="100%" stopColor="#FFD98C" stopOpacity={0} />
          </RadialGradient>
          {/* legibility scrim: darken top (status/tiles) and bottom (buttons) */}
          <LinearGradient id="ssScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill="url(#ssSky)" />
        <Circle cx={W * 0.62} cy={H * 0.65} r={W * 0.55} fill="url(#ssSun)" />
        <AnimatedRect animatedProps={bandProps} x={0} y={H * 0.52} width={W} height={H * 0.24} fill="url(#ssBand)" />

        {/* birds, static, small and dim so they never fight the tiles */}
        {BIRDS.map((b, i) => (
          <Path key={`ssb${i}`} d={birdPath(W * b.x, H * b.y, b.s)} stroke="#38203A" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.55} />
        ))}

        {/* mesa layers: far is lightest, each nearer layer darker */}
        <Path d={mesaPath(FAR_MESA, W, H)} fill="#8A4A44" />
        <Path d={mesaPath(MID_MESA, W, H)} fill="#63302F" />
        <Path d={mesaPath(NEAR_MESA, W, H)} fill="#47222A" />

        {/* foreground ledge the signal fire sits on, plus a few boulders at the crest */}
        <Path d={ledgePath} fill="#2E151C" />
        <Path d={`M${seatX - 150} ${plateauY + 2} L${seatX - 138} ${plateauY - 14} L${seatX - 118} ${plateauY - 18} L${seatX - 102} ${plateauY - 6} L${seatX - 98} ${plateauY + 4} Z`} fill="#241016" />
        <Path d={`M${seatX + 96} ${plateauY + 4} L${seatX + 104} ${plateauY - 12} L${seatX + 124} ${plateauY - 16} L${seatX + 140} ${plateauY - 2} L${seatX + 142} ${plateauY + 6} Z`} fill="#3A1D24" />

        {/* the teepee, standing on the ledge next to the fire (static; the dusk dim + scrims below
            still wash over it so it stays legible under the tiles) */}
        <Ellipse cx={tpX} cy={tpBaseY + 3 * tpS} rx={tpHalfW * 1.18} ry={6.5 * tpS} fill="#1F0D13" opacity={0.6} />
        <Path d={tpCone} fill={TP_SHADE} />
        <Path d={tpSunSide} fill={TP_SUN} />
        <Path d={tpBand(0.55, 0.6)} fill={TP_CREAM} opacity={0.85} />
        <Path d={tpBand(0.62, 0.66)} fill={TP_TEAL} opacity={0.9} />
        <Ellipse cx={tpX + tpHalfW * 0.34} cy={tpBaseY - tpH * 0.13} rx={tpHalfW * 0.16} ry={tpH * 0.1} fill={TP_DOOR} />
        {tpPoles.map((p, i) => (
          <Line key={`sstp${i}`} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={TP_POLE} strokeWidth={2.2 * tpS} strokeLinecap="round" />
        ))}
        <Path d={tpFlapL} fill={TP_SHADE} />
        <Path d={tpFlapR} fill={TP_FLAP_SUN} />

        <Path d={`M${seatX - 70} ${plateauY + 36} L${seatX - 58} ${plateauY + 22} L${seatX - 36} ${plateauY + 20} L${seatX - 24} ${plateauY + 34} L${seatX - 28} ${plateauY + 42} L${seatX - 66} ${plateauY + 42} Z`} fill="#1F0D13" />

        {/* flat dim (bright scene) + dusk advance while lit, then the standard scrim */}
        <AnimatedRect animatedProps={duskProps} x={0} y={0} width={W} height={H} fill="#000" />
        <Rect x={0} y={0} width={W} height={H} fill="url(#ssScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
