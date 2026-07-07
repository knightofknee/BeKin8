// components/scenes/FireworksScene.tsx
// Full-screen BACKDROP for the Fireworks skin: a suburban BACKYARD on a summer night (the harbor
// festival got cut: "the background sucks so lets replace it with the grass of someones yard").
// Bottom ~third: a LAWN of layered grass bands darkening toward the viewer, sparse grass-blade
// tufts on the band edges and a faint mowed-stripe hint. Across the lawn's far edge a wooden FENCE
// silhouette (board rhythm + two post caps), a big TREE breaking the fence line camera-left, and
// the dark corner of the HOUSE camera-right with a warm PORCH LIGHT casting a static light pool on
// the grass. Above the fence: clean deep blue-black summer sky with a few faint high stars, left
// open as the burst shader's canvas. A few tiny fireflies sit low over the lawn (static positions,
// only a rare gentle blink on the gated clock).
// ANCHOR CONTRACT (registry origin 0.78 = the GROUND at the rack's base, the burning-grass patch):
// the mortar rack's feet sit at structureTop + 0.86 * 180, i.e. (0.86 - origin) * 180 = 14.4px
// below the anchor; the nearest lawn band's ground line passes right under them, bounded by
// structureBottom = anchorY + (1 - origin) * 180. The shader's muzzle is 86px ABOVE the anchor;
// this scene draws nothing there (sky stays clean). Lit: the sky dims slightly (+0.1, 500ms) and
// the lawn around the rack picks up a faint warm flicker-free tint (the patch fire's light). The
// 12-62% friend-tile band stays calm and dark; standard top/bottom scrims.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Lawn bands, lightest far to darkest near (the mow-stripe hint sits between them in value).
const GRASS_FAR = '#14301A';
const GRASS_MID = '#102818';
const GRASS_NEAR = '#0C1F10';
const STRIPE = '#2F5D38';
// Silhouettes against the sky: fence slightly darker than the horizon, tree/house darker still.
const FENCE = '#0A1122';
const TREE = '#070D19';
const HOUSE = '#080E1D';
const EAVE = '#1B2542';

// Faint stars, kept HIGH (at or above the 12% tile line) and dim: the sky is the bursts' canvas.
const STARS = [
  { x: 0.1, y: 0.05, r: 1.1, o: 0.5 },
  { x: 0.27, y: 0.09, r: 1.0, o: 0.35 },
  { x: 0.44, y: 0.04, r: 1.2, o: 0.55 },
  { x: 0.58, y: 0.08, r: 0.9, o: 0.3 },
  { x: 0.73, y: 0.05, r: 1.1, o: 0.45 },
  { x: 0.89, y: 0.08, r: 1.0, o: 0.4 },
  { x: 0.18, y: 0.15, r: 0.9, o: 0.25 },
  { x: 0.66, y: 0.17, r: 0.9, o: 0.22 },
];

// Grass-blade tufts along the band edges: fx fraction of W, dy jitter off the edge, s scale,
// lean +-1. Near row keeps clear of the rack (no tufts through the structure's feet).
type Tuft = { fx: number; dy: number; s: number; lean: number };
const TUFTS_FAR: Tuft[] = [
  { fx: 0.07, dy: 1, s: 2.0, lean: 1 }, { fx: 0.23, dy: 0, s: 2.4, lean: -1 },
  { fx: 0.4, dy: 1.5, s: 2.0, lean: 1 }, { fx: 0.57, dy: 0.5, s: 2.5, lean: -1 },
  { fx: 0.72, dy: 1, s: 2.1, lean: 1 }, { fx: 0.9, dy: 0, s: 2.3, lean: -1 },
];
const TUFTS_MID: Tuft[] = [
  { fx: 0.13, dy: 1, s: 2.3, lean: -1 }, { fx: 0.31, dy: 0, s: 2.7, lean: 1 },
  { fx: 0.52, dy: 1.5, s: 2.2, lean: -1 }, { fx: 0.7, dy: 0.5, s: 2.8, lean: 1 },
  { fx: 0.86, dy: 1, s: 2.4, lean: -1 },
];
const TUFTS_NEAR: Tuft[] = [
  { fx: 0.05, dy: 1, s: 2.8, lean: 1 }, { fx: 0.19, dy: 2, s: 3.2, lean: -1 },
  { fx: 0.34, dy: 0.5, s: 2.7, lean: 1 }, { fx: 0.66, dy: 1, s: 3.0, lean: -1 },
  { fx: 0.81, dy: 2, s: 2.8, lean: 1 }, { fx: 0.95, dy: 0.5, s: 3.1, lean: -1 },
];

// One tuft: three little blades fanned around x with a shared lean.
function tuft(x: number, y: number, s: number, lean: number): string {
  const l = lean * 1.6 * s;
  return (
    `M${(x - 2.6 * s).toFixed(1)} ${y.toFixed(1)} L${(x - 3.4 * s + l * 0.5).toFixed(1)} ${(y - 4.4 * s).toFixed(1)} L${(x - 1.5 * s).toFixed(1)} ${y.toFixed(1)} Z ` +
    `M${(x - 0.7 * s).toFixed(1)} ${y.toFixed(1)} L${(x + l).toFixed(1)} ${(y - 6.4 * s).toFixed(1)} L${(x + 0.8 * s).toFixed(1)} ${y.toFixed(1)} Z ` +
    `M${(x + 1.7 * s).toFixed(1)} ${y.toFixed(1)} L${(x + 2.8 * s + l * 0.7).toFixed(1)} ${(y - 3.8 * s).toFixed(1)} L${(x + 3.4 * s).toFixed(1)} ${y.toFixed(1)} Z `
  );
}

function tuftRow(tufts: Tuft[], W: number, yBase: number): string {
  return tufts.map((t) => tuft(t.fx * W, yBase + t.dy, t.s, t.lean)).join('');
}

// Fireflies: 2-3 tiny dim dots very low over the lawn. Positions are STATIC (no wander); each only
// blinks up rarely and gently on the shared gated clock (the top ~20% slice of its loopNoise,
// squared, so it is dark most of the time). x is a fraction of W, dy px below the ground line.
const FLIES: { x: number; dy: number; bl: NoiseSeed }[] = [
  { x: 0.16, dy: 18, bl: makeSeed(5.3, 9.1, 1.5, 11.7) },
  { x: 0.68, dy: 32, bl: makeSeed(12.2, 4.6, 1.5, 14.3) },
  { x: 0.88, dy: 10, bl: makeSeed(8.7, 13.4, 1.5, 9.6) },
];

function Firefly({ clock, x, y, bl }: { clock: SharedValue<number>; x: number; y: number; bl: NoiseSeed }) {
  const props = useAnimatedProps(() => {
    let g = (loopNoise(clock.value, bl) - 0.8) / 0.16;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    return { opacity: g * g * 0.65 };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={x} cy={y} r={3.4} fill="url(#fwsFly)" />
      <Circle cx={x} cy={y} r={1.1} fill="#FFF4AC" />
    </AnimatedG>
  );
}

export type FireworksSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function FireworksScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: FireworksSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Scene clock for the firefly blinks (shared gated clock: registered + paused while gated). The
  // flies blink lit or unlit, so it gates on focused + reduced-motion only.
  const { clock } = useGatedClock(focused && !reduce);

  // Lit progress: 500ms in (the sky steps back for the bursts), 600ms out. Initialized to the
  // current state so mounting already-lit shows the yard mid-show (no replayed ignition).
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) { lit.value = active ? 1 : 0; return; }
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 500 : 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry, anchored to the structure box when measured. The anchor (origin 0.78) is the GROUND
  // at the rack's base; the rack's feet sit (0.86 - origin) * 180 = 14.4px below it, and the box
  // bottom (structureBottom) bounds the nearest band. Unmeasured falls back to the anchor at 0.74H.
  const aX = measured && anchorX != null ? anchorX : W * 0.5;
  const aY = measured && anchorY != null ? clamp(anchorY, H * 0.5, H * 0.88) : H * 0.74;
  const feetY = aY + (0.86 - skin.origin) * 180;
  const structureBottom = aY + (1 - skin.origin) * 180;
  // The lawn: far edge (fence line) up around 0.65H, ground line right under the rack's feet.
  const lawnTop = clamp(aY - H * 0.09, H * 0.52, H * 0.72);
  const groundY = clamp(feetY + 3, lawnTop + 26, Math.min(structureBottom, H * 0.93));
  const midTop = lawnTop + (groundY - lawnTop) * 0.52;
  // Fence along the far edge; dark house corner camera-RIGHT, tree camera-left.
  const fenceH = clamp(H * 0.07, 44, 64);
  const fenceTop = lawnTop - fenceH;
  const houseX = W * 0.79;
  const wallTop = fenceTop - clamp(H * 0.07, 46, 70);

  const geo = useMemo(() => {
    // Fence boards: even rhythm, deterministic little top wobble, run tucked behind the house.
    const frand = (i: number) => {
      const s = Math.sin(i * 127.1 + 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    let boards = '';
    for (let x = 1.5, i = 0; x < houseX + 8; x += 13, i++) {
      const bt = fenceTop + frand(i) * 3.2;
      boards += `M${x.toFixed(1)} ${(lawnTop + 6).toFixed(1)} L${x.toFixed(1)} ${bt.toFixed(1)} L${(x + 10.6).toFixed(1)} ${bt.toFixed(1)} L${(x + 10.6).toFixed(1)} ${(lawnTop + 6).toFixed(1)} Z `;
    }
    // Two posts with caps proud of the board line.
    let posts = '';
    for (const px of [W * 0.18, W * 0.6]) {
      posts +=
        `M${(px - 3.4).toFixed(1)} ${(lawnTop + 6).toFixed(1)} L${(px - 3.4).toFixed(1)} ${(fenceTop - 4.5).toFixed(1)} L${(px + 3.4).toFixed(1)} ${(fenceTop - 4.5).toFixed(1)} L${(px + 3.4).toFixed(1)} ${(lawnTop + 6).toFixed(1)} Z ` +
        `M${(px - 5.4).toFixed(1)} ${(fenceTop - 4.5).toFixed(1)} L${(px - 5.4).toFixed(1)} ${(fenceTop - 7.5).toFixed(1)} L${(px + 5.4).toFixed(1)} ${(fenceTop - 7.5).toFixed(1)} L${(px + 5.4).toFixed(1)} ${(fenceTop - 4.5).toFixed(1)} Z `;
    }
    // Lawn bands: gentle near-flat curves; the near band crests under the rack so the ground line
    // passes right beneath its feet.
    const farBand = `M0 ${(lawnTop + 2).toFixed(1)} Q ${(W * 0.5).toFixed(1)} ${(lawnTop - 4).toFixed(1)} ${W.toFixed(1)} ${(lawnTop + 2).toFixed(1)} L${W.toFixed(1)} ${H.toFixed(1)} L0 ${H.toFixed(1)} Z`;
    const midBand = `M0 ${(midTop + 3).toFixed(1)} Q ${(W * 0.42).toFixed(1)} ${(midTop - 5).toFixed(1)} ${W.toFixed(1)} ${(midTop + 1).toFixed(1)} L${W.toFixed(1)} ${H.toFixed(1)} L0 ${H.toFixed(1)} Z`;
    const nearBand = `M0 ${(groundY + 5).toFixed(1)} Q ${aX.toFixed(1)} ${(groundY - 4).toFixed(1)} ${W.toFixed(1)} ${(groundY + 4).toFixed(1)} L${W.toFixed(1)} ${H.toFixed(1)} L0 ${H.toFixed(1)} Z`;
    // Mowed-stripe hint: two barely-lighter passes widening toward the viewer.
    const stripe = (fx: number, halfTop: number) => {
      const xt = W * fx;
      const xb = xt + (xt - W * 0.5) * 0.4;
      const hb = halfTop * 2.6;
      return `M${(xt - halfTop).toFixed(1)} ${(lawnTop + 2).toFixed(1)} L${(xt + halfTop).toFixed(1)} ${(lawnTop + 2).toFixed(1)} L${(xb + hb).toFixed(1)} ${H.toFixed(1)} L${(xb - hb).toFixed(1)} ${H.toFixed(1)} Z`;
    };
    return {
      boards,
      posts,
      farBand: farBand + ' ' + tuftRow(TUFTS_FAR, W, lawnTop + 2),
      midBand: midBand + ' ' + tuftRow(TUFTS_MID, W, midTop + 3),
      nearBand: nearBand + ' ' + tuftRow(TUFTS_NEAR, W, groundY + 4),
      stripeA: stripe(0.3, W * 0.045),
      stripeB: stripe(0.63, W * 0.04),
    };
  }, [W, H, aX, lawnTop, midTop, groundY, fenceTop, houseX]);

  // Lit-state overlays: slight full-screen dim for burst contrast, and the patch fire's faint warm
  // flicker-free tint on the lawn around the rack.
  const dimProps = useAnimatedProps(() => ({ opacity: lit.value * 0.1 }));
  const warmProps = useAnimatedProps(() => ({ opacity: lit.value * 0.85 }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="fwsSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#04060F" />
            <Stop offset="55%" stopColor="#0A1122" />
            <Stop offset="100%" stopColor="#121B33" />
          </LinearGradient>
          {/* the patch fire's warm tint on the lawn while lit (static, flicker-free) */}
          <RadialGradient id="fwsWarm" gradientUnits="userSpaceOnUse" cx={aX} cy={feetY} r={W * 0.42}>
            <Stop offset="0%" stopColor="#FFB25E" stopOpacity={0.32} />
            <Stop offset="55%" stopColor="#FF8A2A" stopOpacity={0.1} />
            <Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="fwsFly" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} />
            <Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} />
            <Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} />
          </RadialGradient>
          {/* contact shadow pinning the rack to the grass: a shadow, not a glow */}
          <RadialGradient id="fwsShadow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.35} />
            <Stop offset="55%" stopColor="#000" stopOpacity={0.16} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: status area above, button row below */}
          <LinearGradient id="fwsScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* ===== NIGHT SKY: deep blue-black, a few dim high stars, nothing else ===== */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#fwsSky)" />
        {STARS.map((st, i) => (
          <Circle key={`fws${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#DCE4FF" opacity={st.o} />
        ))}

        {/* ===== THE FENCE across the lawn's far edge: board rhythm + two post caps ===== */}
        <Path d={geo.boards} fill={FENCE} />
        <Path d={geo.posts} fill={FENCE} />

        {/* ===== THE TREE breaking the fence line, camera-left ===== */}
        <Rect x={W * 0.105 - 2.6} y={fenceTop - 16} width={5.2} height={lawnTop + 22 - fenceTop} fill={TREE} />
        <Circle cx={W * 0.05} cy={fenceTop - 16} r={30} fill={TREE} />
        <Circle cx={W * 0.115} cy={fenceTop - 40} r={38} fill={TREE} />
        <Circle cx={W * 0.19} cy={fenceTop - 12} r={27} fill={TREE} />
        <Circle cx={W * 0.135} cy={fenceTop - 2} r={26} fill={TREE} />

        {/* ===== THE HOUSE corner, camera-right (dark: the porch light read as a random yellow
            blob floating on the fence line, so the family turned it off) ===== */}
        <Path d={`M${houseX - 10} ${wallTop} L${W} ${wallTop - 26} L${W} ${wallTop} Z`} fill={HOUSE} />
        <Rect x={houseX} y={wallTop} width={W - houseX} height={lawnTop + 8 - wallTop} fill={HOUSE} />
        <Line x1={houseX - 10} y1={wallTop} x2={W} y2={wallTop - 26} stroke={EAVE} strokeWidth={1} opacity={0.35} />
        <Line x1={houseX} y1={wallTop} x2={houseX} y2={lawnTop + 6} stroke={EAVE} strokeWidth={0.8} opacity={0.25} />

        {/* ===== THE LAWN: three grass bands darkening toward the viewer, tufts on their edges ===== */}
        <Path d={geo.farBand} fill={GRASS_FAR} />
        <Path d={geo.midBand} fill={GRASS_MID} />
        <Path d={geo.nearBand} fill={GRASS_NEAR} />
        <Path d={geo.stripeA} fill={STRIPE} opacity={0.06} />
        <Path d={geo.stripeB} fill={STRIPE} opacity={0.05} />

        {/* contact shadow under the mortar rack's feet */}
        <Ellipse cx={aX} cy={feetY + 2} rx={55} ry={8} fill="url(#fwsShadow)" />

        {/* lit: the patch fire's warm light finds the grass around the rack (no flicker) */}
        <AnimatedG animatedProps={warmProps}>
          <Ellipse cx={aX} cy={feetY + 4} rx={W * 0.34} ry={58} fill="url(#fwsWarm)" />
        </AnimatedG>

        {/* fireflies low over the lawn: static dots, rare gentle blinks */}
        {FLIES.map((f, i) => (
          <Firefly key={`fwf${i}`} clock={clock} x={W * f.x} y={groundY + f.dy} bl={f.bl} />
        ))}

        {/* lit: the sky steps back very slightly so the bursts own the night */}
        <AnimatedRect animatedProps={dimProps} x={0} y={0} width={W} height={H} fill="#04060F" />

        <Rect x={0} y={0} width={W} height={H} fill="url(#fwsScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  // Opaque dark base so a not-yet-painted frame never flashes the page background through.
  base: { backgroundColor: '#05070C' },
});
