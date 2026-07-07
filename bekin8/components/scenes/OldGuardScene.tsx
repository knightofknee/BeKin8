// components/scenes/OldGuardScene.tsx
// Old Guard BACKDROP (behind all tiles): NIGHT WATCH ON A CASTLE WALL. Cold indigo sky with sparse
// stars, a low waning moon, two slow drifting cloud bands (loopNoise), and very dark mountain
// silhouettes on the horizon. The hero is a crenellated battlement parapet spanning the bottom
// third: the walkway top edge is derived from the structure anchor (anchorY) so the fire basket
// visually stands ON the wall, merlons rise at the sides with a clear gap center. Far right a tiny
// distant watchtower rises behind the parapet. When the beacon is lit, a warm wash creeps over the
// nearby stonework and the merlon inner edges catch orange rim light; ~1.8s later the distant tower
// kindles a tiny answering fire (the signal chain), fading when you extinguish. Pure procedural SVG,
// no photos. Friend tiles render over ~12%..62% of the screen, so that band stays calm and dark.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import { crescentMoonPath } from './moonPath';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// Sparse static stars, mostly high (the top scrim dims the very top; the tile band gets only the
// dimmest few so white tile text never fights them).
const STARS = [
  { x: 0.08, y: 0.06, r: 1.2, o: 0.7 }, { x: 0.22, y: 0.11, r: 0.9, o: 0.45 }, { x: 0.35, y: 0.05, r: 1.3, o: 0.75 },
  { x: 0.52, y: 0.09, r: 1.0, o: 0.5 }, { x: 0.66, y: 0.04, r: 1.2, o: 0.65 }, { x: 0.82, y: 0.08, r: 1.0, o: 0.55 },
  { x: 0.93, y: 0.14, r: 1.3, o: 0.7 }, { x: 0.14, y: 0.2, r: 0.9, o: 0.4 }, { x: 0.44, y: 0.17, r: 1.0, o: 0.45 },
  { x: 0.73, y: 0.19, r: 0.9, o: 0.4 }, { x: 0.88, y: 0.27, r: 0.9, o: 0.35 }, { x: 0.3, y: 0.27, r: 0.8, o: 0.3 },
  { x: 0.6, y: 0.31, r: 0.8, o: 0.3 }, { x: 0.05, y: 0.34, r: 0.8, o: 0.3 },
];

// Two thin cloud bands. Long incommensurate loopNoise periods: the drift never visibly repeats.
const CLOUDS = [
  { cx: 0.38, cy: 0.2, rxW: 0.5, ry: 16, sx: makeSeed(4.2, 8.7, 1.3, 47), sy: makeSeed(9.1, 3.4, 1.2, 61), so: makeSeed(14.3, 6.2, 1.4, 53) },
  { cx: 0.66, cy: 0.315, rxW: 0.42, ry: 13, sx: makeSeed(7.6, 12.2, 1.3, 59), sy: makeSeed(2.9, 10.5, 1.2, 71), so: makeSeed(18.8, 4.7, 1.4, 43) },
];

function CloudBand({ clock, W, H, cx, cy, rxW, ry, sx, sy, so }: {
  clock: SharedValue<number>; W: number; H: number;
  cx: number; cy: number; rxW: number; ry: number; sx: NoiseSeed; sy: NoiseSeed; so: NoiseSeed;
}) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    return {
      // stays faint (0.05..0.14): a presence in the sky, never a bright shape under the tiles
      opacity: 0.05 + loopNoise(t, so) * 0.09,
      transform: [
        { translateX: loopNoiseSigned(t, sx, W * 0.16) },
        { translateY: loopNoiseSigned(t, sy, 9) },
      ],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Ellipse cx={W * cx} cy={H * cy} rx={W * rxW} ry={ry} fill="url(#ogCloud)" />
    </AnimatedG>
  );
}

// Mountain silhouettes (x, y as screen fractions). Peaks kept inside ~48..59% height, very dark.
const FAR_RANGE = [
  [0, 0.56], [0.09, 0.515], [0.2, 0.545], [0.31, 0.495], [0.44, 0.54],
  [0.57, 0.485], [0.7, 0.535], [0.82, 0.505], [0.93, 0.55], [1, 0.525],
];
const NEAR_RANGE = [
  [0, 0.59], [0.12, 0.565], [0.26, 0.588], [0.4, 0.552], [0.55, 0.585], [0.68, 0.558], [0.83, 0.588], [1, 0.568],
];
const rangePath = (pts: number[][], W: number, H: number) =>
  `M0 ${H} ` + pts.map(([x, y]) => `L${x * W} ${y * H}`).join(' ') + ` L${W} ${H} Z`;

// Parapet geometry. Merlons march outward from the central gap edges so the innermost teeth sit
// flush against the clear span where the fire basket stands.
const MERLON_W = 34;
const CRENEL_W = 30;
const MERLON_H = 44;
const STEP = MERLON_W + CRENEL_W;
const GAP_HALF = 92; // clear span half-width: matches the 180px structure box

// Tiny flame glyph for the distant answering fire (same teardrop as BeaconScene's RidgeFlame).
const flamePath = (x: number, y: number, s: number) =>
  `M${x} ${y} C${x - s} ${y - s * 1.2} ${x - s * 0.5} ${y - s * 2.2} ${x} ${y - s * 2.7} C${x + s * 0.5} ${y - s * 2.2} ${x + s} ${y - s * 1.2} ${x} ${y} Z`;

export type OldGuardSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function OldGuardScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: OldGuardSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Wall geometry from the structure anchor: the walkway top edge sits just below the 180px
  // structure box bottom so the brazier stands on the wall. Sensible fractions when unmeasured.
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = measured && anchorY != null ? anchorY - skin.origin * 180 + 180 : H * 0.7;
  const wallTop = Math.min(Math.max(structureBottom + 4, H * 0.6), H * 0.88);
  const merlonTop = wallTop - MERLON_H;

  const wall = useMemo(() => {
    const gapL = seatX - GAP_HALF;
    const gapR = seatX + GAP_HALF;
    let merlons = '';
    let edges = '';
    for (let x = gapR; x < W + STEP; x += STEP) {
      merlons += `M${x} ${wallTop} L${x} ${merlonTop} L${x + MERLON_W} ${merlonTop} L${x + MERLON_W} ${wallTop} Z `;
      edges += `M${x} ${merlonTop} h${MERLON_W} v3 h${-MERLON_W} Z M${x} ${merlonTop} h2.5 v${MERLON_H} h-2.5 Z `;
    }
    for (let x = gapL - MERLON_W; x > -STEP - MERLON_W; x -= STEP) {
      merlons += `M${x} ${wallTop} L${x} ${merlonTop} L${x + MERLON_W} ${merlonTop} L${x + MERLON_W} ${wallTop} Z `;
      edges += `M${x} ${merlonTop} h${MERLON_W} v3 h${-MERLON_W} Z M${x} ${merlonTop} h2.5 v${MERLON_H} h-2.5 Z `;
    }
    // Mortar: 3 stone courses plus staggered vertical joints (all one static path).
    let mortar = '';
    const courses = [26, 52, 78];
    courses.forEach((dy) => { mortar += `M0 ${wallTop + dy} h${W} v1.5 h${-W} Z `; });
    const rows = [{ top: 9, h: 17 }, { top: 27.5, h: 24.5 }, { top: 53.5, h: 24.5 }];
    rows.forEach((row, i) => {
      for (let x = (i % 2) * 32 + 8; x < W; x += 64) {
        mortar += `M${x} ${wallTop + row.top} h1.5 v${row.h} h-1.5 Z `;
      }
    });
    return { gapL, gapR, merlons, edges, mortar };
  }, [W, seatX, wallTop, merlonTop]);

  // Distant second watchtower, far right, rising behind the parapet (further down the wall).
  const tx = W - 40;
  const towerTop = wallTop - 52;
  const towerPath =
    `M${tx - 16} ${towerTop + 9} h32 V${wallTop + 20} h-32 Z ` +
    `M${tx - 16} ${towerTop} h7 v9 h-7 Z M${tx - 4} ${towerTop} h8 v9 h-8 Z M${tx + 9} ${towerTop} h7 v9 h-7 Z`;

  // Scene clock for the cloud drift (shared gated clock: registered + paused unless focused and
  // motion allowed), so it costs nothing off-tab or under reduced motion.
  const { clock } = useGatedClock(!reduce && focused);

  // Lit state. Initialized from `active` so a first mount while lit JUMPS to the washed state
  // (the withTiming below is then a visual no-op, no ignition replay).
  const warm = useSharedValue(active ? 1 : 0); // warm wash + merlon rim light
  const towerFire = useSharedValue(active ? 1 : 0); // distant answering fire
  useEffect(() => {
    if (reduce) {
      cancelAnimation(warm);
      cancelAnimation(towerFire);
      warm.value = active ? 1 : 0;
      towerFire.value = active ? 1 : 0;
      return;
    }
    if (active) {
      warm.value = withTiming(1, { duration: 500 });
      if (!focused) {
        // Off-tab: hold the answering fire steady-on so its infinite breathe never repaints unfocused.
        cancelAnimation(towerFire);
        towerFire.value = 1;
      } else if (towerFire.value === 1) {
        // Refocus while already lit: resume the breathe directly, no replayed 1.8s answer.
        towerFire.value = withRepeat(withSequence(withTiming(0.72, { duration: 1100 }), withTiming(1, { duration: 1100 })), -1, true);
      } else {
        // The watch answers ~1.8s after yours, then breathes gently.
        towerFire.value = withDelay(
          1800,
          withSequence(
            withTiming(1, { duration: 600 }),
            withRepeat(withSequence(withTiming(0.72, { duration: 1100 }), withTiming(1, { duration: 1100 })), -1, true)
          )
        );
      }
    } else {
      cancelAnimation(towerFire);
      warm.value = withTiming(0, { duration: 700 });
      towerFire.value = withTiming(0, { duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, focused]);
  useEffect(() => () => { cancelAnimation(warm); cancelAnimation(towerFire); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const warmProps = useAnimatedProps(() => ({ opacity: warm.value }));
  const towerProps = useAnimatedProps(() => ({ opacity: towerFire.value }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="ogSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#070C18" /><Stop offset="62%" stopColor="#101A2E" /><Stop offset="100%" stopColor="#0C1425" />
          </LinearGradient>
          <RadialGradient id="ogMoonHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#F6EFD8" stopOpacity={0.3} /><Stop offset="60%" stopColor="#D8D4B8" stopOpacity={0.1} /><Stop offset="100%" stopColor="#D8D4B8" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ogCloud" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#40527C" stopOpacity={0.55} /><Stop offset="60%" stopColor="#2C3A5E" stopOpacity={0.28} /><Stop offset="100%" stopColor="#2C3A5E" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="ogWallV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#1A2334" /><Stop offset="100%" stopColor="#10182A" />
          </LinearGradient>
          <RadialGradient id="ogWarm" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFB86B" stopOpacity={0.55} /><Stop offset="55%" stopColor="#FF8A2A" stopOpacity={0.22} /><Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ogTFire" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC56B" stopOpacity={0.9} /><Stop offset="60%" stopColor="#FF9A3C" stopOpacity={0.25} /><Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="ogTFlame" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor="#FFE9A6" /><Stop offset="100%" stopColor="#FF7A1A" />
          </LinearGradient>
          <LinearGradient id="ogScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* sky, stars, low waning moon */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#ogSky)" />
        {STARS.map((st, i) => (
          <Circle key={`og${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#DCE6FA" opacity={st.o} />
        ))}
        <Circle cx={W * 0.2} cy={H * 0.455} r={40} fill="url(#ogMoonHalo)" />
        {/* single-path waning crescent, lit limb toward the left horizon it is sinking into; the
            unlit part of the disc is simply not drawn, so nothing reads as an eclipse */}
        <Path d={crescentMoonPath(W * 0.2, H * 0.455, 15, 162)} fill="#EFE8D0" />

        {/* thin drifting cloud bands (faint, tile band stays calm) */}
        {CLOUDS.map((c, i) => (
          <CloudBand key={`ogc${i}`} clock={clock} W={W} H={H} cx={c.cx} cy={c.cy} rxW={c.rxW} ry={c.ry} sx={c.sx} sy={c.sy} so={c.so} />
        ))}

        {/* distant mountain silhouettes on the horizon */}
        <Path d={rangePath(FAR_RANGE, W, H)} fill="#0C1526" />
        <Path d={rangePath(NEAR_RANGE, W, H)} fill="#0A111F" />

        {/* the distant second watchtower, behind the parapet, with its answering fire */}
        <Path d={towerPath} fill="#101A2C" />
        <AnimatedG animatedProps={towerProps}>
          <Circle cx={tx} cy={towerTop - 5} r={9} fill="url(#ogTFire)" />
          <Path d={flamePath(tx, towerTop + 1, 4)} fill="url(#ogTFlame)" />
        </AnimatedG>

        {/* battlement parapet: wall body, edge-lit walkway lip, merlons, mortar */}
        <Rect x={0} y={wallTop} width={W} height={H - wallTop} fill="url(#ogWallV)" />
        <Rect x={0} y={wallTop} width={W} height={9} fill="#232F45" />
        <Rect x={0} y={wallTop} width={W} height={2} fill="#31415F" opacity={0.9} />
        <Path d={wall.merlons} fill="#1E293C" />
        <Path d={wall.edges} fill="#2C3A56" opacity={0.85} />
        <Path d={wall.mortar} fill="#141C2E" opacity={0.7} />

        {/* lit wash: warm light on the nearby stonework + orange rim light on the inner merlon
            edges facing the fire (500ms in, 700ms out via `warm`) */}
        <AnimatedG animatedProps={warmProps}>
          <Ellipse cx={seatX} cy={wallTop + 6} rx={170} ry={62} fill="url(#ogWarm)" opacity={0.6} />
          <Rect x={wall.gapL} y={wallTop - 1} width={GAP_HALF * 2} height={2.5} fill="#FFB86B" opacity={0.65} />
          <Rect x={wall.gapL - 3} y={merlonTop + 3} width={3} height={MERLON_H - 3} fill="#FFA24E" opacity={0.9} />
          <Rect x={wall.gapR} y={merlonTop + 3} width={3} height={MERLON_H - 3} fill="#FFA24E" opacity={0.9} />
          <Rect x={wall.gapL - STEP - 3} y={merlonTop + 3} width={3} height={MERLON_H - 3} fill="#FFA24E" opacity={0.35} />
          <Rect x={wall.gapR + STEP} y={merlonTop + 3} width={3} height={MERLON_H - 3} fill="#FFA24E" opacity={0.35} />
        </AnimatedG>

        {/* legibility scrim: darken top (status/tiles) and bottom (buttons) */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#ogScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
