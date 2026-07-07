// components/scenes/TowerScene.tsx
// The TWO LANTERNS backdrop: Boston, night of April 18, 1775, seen from across the rooftops. The
// structure layer in front is the top of the Old North Church steeple (belfry + spire); this scene
// grounds it. The brick tower body continues down from the bottom of the structure box, dark brick
// against the dark sky with a moonlit edge on one side, mortar courses, and a tall arched window
// with white trim about halfway down. Around its base sits a low colonial town: a rooftop
// silhouette row (gables, chimneys, a few faint candlelit windows), and below that a thin dark
// harbor band with a slow moon-glint shimmer. Night sky, crescent moon and stars above. The whole
// midband stays calm and dark so the friend tiles stay legible. When lit, a warm wash wakes around
// the belfry and a second, warm glint appears in the harbor water.
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { loopNoise, makeSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import { crescentMoonPath } from './moonPath';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Tower masonry: mortar lines over the brick gradient, cool moonlit edge, white window trim.
const MORTAR = '#6E2E23';
const MOON_EDGE = '#C7D2E0';
const TRIM = '#C9C4B4';
const ROOF = '#0A0F22';
const HARBOR = '#0B1226';
const WINDOW_WARM = '#FFC97E';

// Stars (fractions of W/H). Small and dim on purpose: the friend tiles sit over this band, so
// nothing here may compete with white text.
const STARS = [
  { x: 0.16, y: 0.13, r: 1.2, o: 0.7 }, { x: 0.24, y: 0.2, r: 1.0, o: 0.5 }, { x: 0.33, y: 0.1, r: 1.3, o: 0.8 },
  { x: 0.42, y: 0.24, r: 1.0, o: 0.45 }, { x: 0.5, y: 0.14, r: 1.1, o: 0.6 }, { x: 0.58, y: 0.28, r: 1.0, o: 0.5 },
  { x: 0.63, y: 0.09, r: 1.2, o: 0.65 }, { x: 0.55, y: 0.36, r: 1.0, o: 0.4 }, { x: 0.85, y: 0.3, r: 1.1, o: 0.55 },
];

// Colonial roofline points: x is a fraction of screen width, y a fraction of the roof band
// (0 = band top, 1 = band base). Gables plus two chimneys.
const ROOF_PTS: [number, number][] = [
  [0, 0.78], [0.055, 0.78], [0.12, 0.3], [0.185, 0.74], [0.21, 0.74],
  [0.21, 0.42], [0.235, 0.42], [0.235, 0.7], // chimney
  [0.31, 0.7], [0.4, 0.22], [0.49, 0.72], [0.545, 0.72],
  [0.545, 0.38], [0.572, 0.38], [0.572, 0.68], // chimney
  [0.64, 0.68], [0.71, 0.3], [0.78, 0.72], [0.86, 0.72], [0.93, 0.5], [1, 0.56],
];

function roofPath(w: number, yTop: number, yBase: number): string {
  const pts = ROOF_PTS.map(([fx, fy]) => `${(fx * w).toFixed(1)} ${(yTop + fy * (yBase - yTop)).toFixed(1)}`);
  return `M0 ${yBase + 2} L${pts.join(' L')} L${w} ${yBase + 2} Z`;
}

// A few faint candlelit windows in the town: [x fraction of W, y fraction of the roof band, opacity].
const TOWN_WINDOWS: [number, number, number][] = [
  [0.115, 0.55, 0.32],
  [0.705, 0.55, 0.3],
  [0.885, 0.78, 0.24],
];

// One slow shimmer per glint column; incommensurate periods so they never sync.
const MOON_GLINT_SEED = makeSeed(4.2, 8.7, 1.3, 11.0);
const WARM_GLINT_SEED = makeSeed(9.6, 3.1, 1.2, 8.5);

export type TowerSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function TowerScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: TowerSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Scene clock for the harbor shimmer (shared gated clock: registered + paused while gated; the
  // shimmer runs lit or unlit, so it gates on focused + reduced-motion only).
  const { clock } = useGatedClock(focused && !reduce);

  // Lantern spill: 400ms in, 550ms out. Initialized to the current state so mounting already-lit
  // shows the lit belfry immediately (no replayed ignition).
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) { lit.value = active ? 1 : 0; return; }
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 400 : 550 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry, anchored to the structure box when measured. The structure's brick hint spans
  // x 27..73 of its 0..100 box, so the scene tower is 0.46 * 180 wide, centered on anchorX, and
  // picks up 8px before the structure box ends so the seam never shows. Clamps keep a visible
  // roof band and harbor on any screen; unmeasured falls back to W/2 with the box bottom ~0.72H.
  const aX = measured && anchorX != null ? anchorX : W * 0.5;
  const structBottom = measured && anchorY != null ? anchorY + (1 - skin.origin) * 180 : H * 0.72;
  const towerTop = structBottom - 8;
  const towerW = 0.46 * 180;
  const towerL = aX - towerW / 2;
  const roofTop = Math.min(Math.max(H * 0.72, towerTop + 24), H * 0.84);
  const roofBase = Math.min(roofTop + H * 0.07, H * 0.9);
  const harborTop = roofBase;
  const towerH = Math.max(0, roofBase + 4 - towerTop);
  const belfryCy = structBottom - 72; // belfry center in the structure box (y ~0.6 of 0..100)
  const glintH = Math.max(0, H - harborTop - 24);
  const mx = W * 0.72;
  const my = H * 0.12;

  // Mortar coursing on the tower body: horizontal courses plus staggered vertical joints.
  const courses: number[] = [];
  for (let y = towerTop + 12; y < roofBase - 6; y += 9) courses.push(y);
  const joints: [number, number][] = [];
  courses.forEach((y, i) => {
    const xs = i % 2 === 0 ? [towerL + 16, aX + 4, towerL + towerW - 20] : [towerL + 30, aX + 20];
    xs.forEach((x) => joints.push([x, y]));
  });

  // The tall arched window, only when enough tower body is visible between steeple and rooftops.
  const towerBand = roofTop - towerTop;
  const showWindow = towerBand > 70;
  const wy = towerTop + towerBand / 2;
  const winD = `M${aX - 9} ${wy + 16} L${aX - 9} ${wy - 7} A9 9 0 0 1 ${aX + 9} ${wy - 7} L${aX + 9} ${wy + 16} Z`;

  const glintProps = useAnimatedProps(() => ({
    opacity: (0.3 + 0.7 * loopNoise(clock.value, MOON_GLINT_SEED)) * 0.12 * (1 + lit.value),
  }));
  // The warm glint only exists while lit: lantern light finding the water.
  const warmGlintProps = useAnimatedProps(() => ({
    opacity: lit.value * (0.4 + 0.6 * loopNoise(clock.value, WARM_GLINT_SEED)) * 0.1,
  }));
  const spillProps = useAnimatedProps(() => ({ opacity: lit.value }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="tsSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#070B1A" />
            <Stop offset="100%" stopColor="#171D3A" />
          </LinearGradient>
          {/* Brick body: matches the structure's #8C3B2C where they meet, then falls into shadow */}
          <LinearGradient id="tsBrick" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#8C3B2C" />
            <Stop offset="45%" stopColor="#5E271D" />
            <Stop offset="100%" stopColor="#371711" />
          </LinearGradient>
          <RadialGradient id="tsMoonHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF6D8" stopOpacity={0.55} />
            <Stop offset="55%" stopColor="#E8E4C8" stopOpacity={0.18} />
            <Stop offset="100%" stopColor="#E8E4C8" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tsGlint" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#D9E6FF" stopOpacity={0.9} />
            <Stop offset="60%" stopColor="#D9E6FF" stopOpacity={0.35} />
            <Stop offset="100%" stopColor="#D9E6FF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tsGlintWarm" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC98A" stopOpacity={0.9} />
            <Stop offset="60%" stopColor="#FFC98A" stopOpacity={0.3} />
            <Stop offset="100%" stopColor="#FFC98A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tsWash" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFB05A" stopOpacity={0.26} />
            <Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.09} />
            <Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="tsScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* ===== NIGHT SKY: gradient, crescent moon with halo, dim stars ===== */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#tsSky)" />
        <Circle cx={mx} cy={my} r={56} fill="url(#tsMoonHalo)" />
        {/* single-path waxing crescent (lit limb low right, toward the harbor glint below); the
            unlit part of the disc is simply not drawn, so nothing reads as an eclipse */}
        <Path d={crescentMoonPath(mx, my, 19, 18)} fill="#FBF6E2" />
        {STARS.map((st, i) => (
          <Circle key={`ts${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#FFFFFF" opacity={st.o} />
        ))}

        {/* ===== THE TOWER BODY: dark brick continuing down from the steeple structure ===== */}
        <Rect x={towerL} y={towerTop} width={towerW} height={towerH} fill="url(#tsBrick)" />
        {courses.map((y, i) => (
          <Line key={`tc${i}`} x1={towerL + 2} y1={y} x2={towerL + towerW - 2} y2={y} stroke={MORTAR} strokeWidth={1} opacity={0.4} />
        ))}
        {joints.map(([x, y], i) => (
          <Line key={`tj${i}`} x1={x} y1={y + 0.5} x2={x} y2={Math.min(y + 8.5, roofBase)} stroke={MORTAR} strokeWidth={1} opacity={0.28} />
        ))}
        {/* moonlit edge on the moon side, deep shadow on the other */}
        <Rect x={towerL + towerW - 1.8} y={towerTop + 2} width={1.8} height={Math.max(0, towerH - 6)} fill={MOON_EDGE} opacity={0.2} />
        <Rect x={towerL} y={towerTop + 2} width={2.2} height={Math.max(0, towerH - 6)} fill="#000000" opacity={0.28} />
        {showWindow && (
          <G>
            <Path d={winD} fill="#10131E" />
            <Path d={winD} fill="none" stroke={TRIM} strokeWidth={1.2} opacity={0.5} />
          </G>
        )}

        {/* ===== THE TOWN + HARBOR: rooftop silhouettes, candlelit windows, dark water ===== */}
        <Path d={roofPath(W, roofTop, roofBase)} fill={ROOF} />
        {TOWN_WINDOWS.map(([fx, fy, o], i) => (
          <Rect key={`tw${i}`} x={W * fx - 2.5} y={roofTop + fy * (roofBase - roofTop)} width={5} height={6} fill={WINDOW_WARM} opacity={o} />
        ))}
        <Rect x={0} y={harborTop} width={W} height={Math.max(0, H - harborTop)} fill={HARBOR} />
        {/* moon glint on the water: one slow loopNoise shimmer; doubles while the lanterns burn */}
        <AnimatedRect animatedProps={glintProps} x={mx - 13} y={harborTop + 4} width={26} height={glintH} fill="url(#tsGlint)" />
        <AnimatedRect animatedProps={warmGlintProps} x={aX - 10} y={harborTop + 4} width={20} height={glintH} fill="url(#tsGlintWarm)" />

        {/* ===== LANTERN SPILL: warm wash around the belfry while lit (opacity = lit) ===== */}
        <AnimatedG animatedProps={spillProps}>
          <Circle cx={aX} cy={belfryCy} r={170} fill="url(#tsWash)" />
          <Rect x={towerL} y={towerTop} width={towerW} height={Math.min(40, towerH)} fill="#FF9A3C" opacity={0.1} />
        </AnimatedG>

        {/* Legibility scrim: tiles above, buttons below */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#tsScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  // Opaque dark base so a not-yet-painted frame never flashes the page background through.
  base: { backgroundColor: '#05070C' },
});
