// components/scenes/SkyLanternScene.tsx
// Full-screen BACKDROP for the Sky Lanterns skin: the PING RIVER at night during Yi Peng, viewed
// from a wooden dock on the Chiang Mai bank. Sky: deep indigo-black with a few faint high stars,
// kept clean because the lantern FIELD (BeaconSkyLanterns, the behind-tiles Skia layer) is the
// sky's whole show. HORIZON CONTRACT: the water line sits at exactly SKY_LANTERN_HORIZON_FRAC of
// the screen height; the Skia layer imports the same constant for its u_horizon uniform so the
// drifting field fades out precisely where this scene's far bank begins. Along the horizon: the
// far bank's treeline silhouette, a scatter of tiny warm festival lights (riverbanks lined with
// crowds and vendors), and one small temple roofline camera RIGHT with a faint gold ridge (the
// wat across the river; the structure's warm rim side agrees). River from the horizon to the dock:
// near-black water with warm loopNoise GLINTS (the FireworksScene harbor pattern) that run dim
// while unlit and brighten + warm while lit (the water reflecting a sky full of lanterns), plus
// KRATHONG: palm-sized banana-leaf floats, each a candle dot on a leaf-green sliver, drifting
// slowly on loopNoise wander at different speeds. One lonely krathong floats while unlit; two more
// fade in while lit. Foreground bottom: the DOCK, plank deck with board seams, two mooring post
// silhouettes kept clear of the structure, and a coiled rope detail; the deck line passes under
// the stand's feet (anchor + (0.88 - origin) * 180). Lit adds a faint flat warm wash on the planks
// around the stand (linear, no radial glow) and a whisper of warmth over the water. The 12-62%
// friend-tile band stays calm and dark; standard top/bottom scrims.
// Fixed hook count; all loopNoise accents ride the shared gated clock (focused && !reduce) and may
// run unlit (dim), the FireworksScene firefly convention.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Ellipse, Path, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// THE HORIZON CONTRACT: the water line's screen-height fraction. BeaconSkyLanterns imports this
// for its u_horizon uniform; change it in one place only.
export const SKY_LANTERN_HORIZON_FRAC = 0.55;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Sky: deep indigo-black, no moon disc (the field owns the sky; the moon lights rims off-frame).
const SKY_TOP = '#04040E';
const SKY_HOR = '#141631';
// Far bank + water darks
const TREES = '#070B16';
const BANK = '#0A0E1C';
const WATER_TOP = '#0A101E';
const WATER_BOT = '#050810';
// Dock wood: dark oiled teak planks
const DOCK = '#241A10';
const DOCK_DK = '#150E07';
const DOCK_SEAM = '#0B0704';
const DOCK_HI = '#3E2E1A';
const POST = '#110B05';
const ROPE = '#4A3A22';
// Warm rim on the right post from the far bank's festival side (named so it cannot flip).
const RIM_POST_WARM = '#8A6A3C';
// Warm festival accents
const GLINT_WARM = '#FFC46A';
const GLINT_COOL = '#9FB2D4';
const GOLD = '#D8A83C';

// Faint high stars, dim and few: the lantern field is the sky's show.
const STARS = [
  { x: 0.08, y: 0.05, r: 1.0, o: 0.4 },
  { x: 0.24, y: 0.09, r: 0.9, o: 0.3 },
  { x: 0.41, y: 0.04, r: 1.1, o: 0.45 },
  { x: 0.57, y: 0.07, r: 0.8, o: 0.26 },
  { x: 0.72, y: 0.05, r: 1.0, o: 0.38 },
  { x: 0.9, y: 0.09, r: 0.9, o: 0.3 },
  { x: 0.16, y: 0.15, r: 0.8, o: 0.2 },
];

// Festival lights strung along the far bank: tiny warm dots hugging the horizon.
const BANK_LIGHTS = [
  { fx: 0.06, dy: -3, r: 0.9, o: 0.4 },
  { fx: 0.13, dy: -2, r: 0.8, o: 0.3 },
  { fx: 0.22, dy: -4, r: 1.0, o: 0.45 },
  { fx: 0.31, dy: -2.5, r: 0.8, o: 0.32 },
  { fx: 0.45, dy: -3, r: 0.9, o: 0.4 },
  { fx: 0.53, dy: -2, r: 0.8, o: 0.28 },
  { fx: 0.62, dy: -3.5, r: 1.0, o: 0.42 },
  { fx: 0.7, dy: -2.5, r: 0.8, o: 0.3 },
  { fx: 0.84, dy: -3, r: 0.9, o: 0.38 },
  { fx: 0.93, dy: -2, r: 0.8, o: 0.3 },
];

// Water glints: short warm dashes scattered down the river band. fy is the fraction of the river's
// height; each has its own incommensurate loopNoise seed so the shimmer never beats.
const GLINTS: { fx: number; fy: number; len: number; s: NoiseSeed }[] = [
  { fx: 0.1, fy: 0.12, len: 9, s: makeSeed(3.1, 7.7, 1.4, 9.3) },
  { fx: 0.33, fy: 0.08, len: 7, s: makeSeed(8.2, 2.4, 1.4, 12.1) },
  { fx: 0.55, fy: 0.14, len: 10, s: makeSeed(1.7, 11.3, 1.4, 7.9) },
  { fx: 0.74, fy: 0.1, len: 8, s: makeSeed(12.4, 5.6, 1.4, 10.7) },
  { fx: 0.9, fy: 0.16, len: 7, s: makeSeed(6.8, 9.2, 1.4, 8.7) },
  { fx: 0.2, fy: 0.3, len: 11, s: makeSeed(9.9, 3.8, 1.4, 11.3) },
  { fx: 0.47, fy: 0.34, len: 9, s: makeSeed(4.4, 12.6, 1.4, 9.9) },
  { fx: 0.68, fy: 0.28, len: 12, s: makeSeed(11.1, 7.1, 1.4, 13.7) },
  { fx: 0.86, fy: 0.36, len: 8, s: makeSeed(2.6, 4.9, 1.4, 8.3) },
  { fx: 0.08, fy: 0.5, len: 10, s: makeSeed(7.3, 10.4, 1.4, 12.9) },
  { fx: 0.3, fy: 0.56, len: 13, s: makeSeed(10.6, 1.9, 1.4, 10.1) },
  { fx: 0.56, fy: 0.62, len: 11, s: makeSeed(5.7, 8.8, 1.4, 14.3) },
  { fx: 0.78, fy: 0.55, len: 14, s: makeSeed(13.2, 6.3, 1.4, 9.1) },
  { fx: 0.94, fy: 0.68, len: 9, s: makeSeed(1.2, 13.1, 1.4, 11.9) },
];

// One water glint: a cool base shimmer always on (dim), plus a warm layer that scales with lit
// (the river reflecting the lantern field). Both ride the same loopNoise gate.
function Glint({
  clock,
  lit,
  x,
  y,
  len,
  s,
}: {
  clock: SharedValue<number>;
  lit: SharedValue<number>;
  x: number;
  y: number;
  len: number;
  s: NoiseSeed;
}) {
  const cool = useAnimatedProps(() => {
    let g = (loopNoise(clock.value, s) - 0.4) / 0.6;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    return { opacity: g * g * (0.1 + 0.1 * (1 - lit.value)) };
  });
  const warm = useAnimatedProps(() => {
    let g = (loopNoise(clock.value, s) - 0.4) / 0.6;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    return { opacity: g * g * (0.07 + 0.4 * lit.value) };
  });
  return (
    <G>
      <AnimatedG animatedProps={cool}>
        <Line x1={x - len / 2} y1={y} x2={x + len / 2} y2={y} stroke={GLINT_COOL} strokeWidth={1.1} strokeLinecap="round" />
      </AnimatedG>
      <AnimatedG animatedProps={warm}>
        <Line x1={x - len / 2} y1={y} x2={x + len / 2} y2={y} stroke={GLINT_WARM} strokeWidth={1.2} strokeLinecap="round" />
      </AnimatedG>
    </G>
  );
}

// Krathong: a banana-leaf float with folded leaf tips, marigold flecks and one candle, wandering
// slowly downstream on loopNoise (different amp + period per float = different speeds). alwaysOn
// floats run unlit too (the lonely one); the others fade with lit.
const KRATHONGS: {
  fx: number;
  fy: number;
  amp: number;
  alwaysOn: boolean;
  sx: NoiseSeed;
  sb: NoiseSeed;
  sf: NoiseSeed;
  scale: number;
}[] = [
  { fx: 0.58, fy: 0.42, amp: 46, alwaysOn: true, sx: makeSeed(4.1, 6.6, 1.2, 67), sb: makeSeed(9.4, 2.2, 1.0, 8.3), sf: makeSeed(2.8, 11.6, 1.4, 5.1), scale: 1 },
  { fx: 0.26, fy: 0.62, amp: 58, alwaysOn: false, sx: makeSeed(11.7, 3.4, 1.2, 83), sb: makeSeed(6.1, 8.9, 1.0, 9.7), sf: makeSeed(13.3, 5.2, 1.4, 6.7), scale: 1.25 },
  { fx: 0.82, fy: 0.24, amp: 30, alwaysOn: false, sx: makeSeed(7.9, 12.1, 1.2, 47), sb: makeSeed(3.6, 10.7, 1.0, 7.1), sf: makeSeed(10.2, 1.6, 1.4, 4.3), scale: 0.75 },
];

function Krathong({
  clock,
  lit,
  x,
  y,
  amp,
  alwaysOn,
  sx,
  sb,
  sf,
  scale,
}: {
  clock: SharedValue<number>;
  lit: SharedValue<number>;
  x: number;
  y: number;
  amp: number;
  alwaysOn: boolean;
  sx: NoiseSeed;
  sb: NoiseSeed;
  sf: NoiseSeed;
  scale: number;
}) {
  const props = useAnimatedProps(() => {
    const flick = 0.6 + 0.4 * loopNoise(clock.value, sf);
    return {
      opacity: (alwaysOn ? 1 : lit.value) * flick * 0.9,
      transform: [
        { translateX: x + loopNoiseSigned(clock.value, sx, amp) },
        { translateY: y + loopNoiseSigned(clock.value, sb, 1.4) },
        { scale },
      ],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      {/* candle reflection in the water beneath */}
      <Line x1={-2.2} y1={3.4} x2={2.2} y2={3.4} stroke={GLINT_WARM} strokeWidth={1} strokeLinecap="round" opacity={0.3} />
      {/* the banana-trunk slice with folded leaf edging */}
      <Path d="M-3.8 0.4 C-2 -0.9 2 -0.9 3.8 0.4 C2 1.5 -2 1.5 -3.8 0.4 Z" fill="#0F2416" />
      <Path d="M-2 -0.3 L-1.4 -1.8 L-0.7 -0.4 Z" fill="#143020" />
      <Path d="M0.9 -0.4 L1.6 -1.9 L2.2 -0.3 Z" fill="#143020" />
      {/* marigold flecks */}
      <Circle cx={-2.6} cy={0.2} r={0.5} fill="#E8933A" />
      <Circle cx={2.7} cy={0.3} r={0.45} fill="#D87F2E" />
      {/* the candle */}
      <Circle cx={0} cy={-0.9} r={1.1} fill="#FFDFA0" />
      <Circle cx={0} cy={-1} r={0.45} fill="#FFF6DC" />
    </AnimatedG>
  );
}

export type SkyLanternSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function SkyLanternScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: SkyLanternSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Scene clock for the glints and krathong wander (shared gated clock: registered + paused while
  // gated). They run lit or unlit (dim), so it gates on focused + reduced motion only.
  const { clock } = useGatedClock(focused && !reduce);

  // Lit progress: the water warms over 700ms, drains over 600ms. Initialized to the current state
  // so mounting already-lit shows the festival mid-swing (no replayed ignition).
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      lit.value = active ? 1 : 0;
      return;
    }
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 700 : 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry. The horizon is a fixed screen fraction (the Skia field imports the same constant).
  // The dock is anchored to the measured structure box: the stand's feet sit at y 88 in the 0..100
  // viewBox, i.e. anchorY + (0.88 - origin) * 180 in page px, and the deck line passes just under
  // them, bounded by structureBottom. Unmeasured falls back to the feet at 0.8H.
  const horizonY = H * SKY_LANTERN_HORIZON_FRAC;
  const aX = measured && anchorX != null ? anchorX : W * 0.5;
  const aY = measured && anchorY != null ? clamp(anchorY, H * 0.3, H * 0.8) : H * 0.8 - (0.88 - skin.origin) * 180;
  const feetY = aY + (0.88 - skin.origin) * 180;
  const structureBottom = aY + (1 - skin.origin) * 180;
  // The deck line must pass UNDER the stand's feet on every screen: the horizon+60 river floor
  // only applies when the feet allow it (on shorter screens the measured feet land higher than
  // horizon+66, so the floor yields to feetY - 6 and the river band simply gets shorter; a small
  // horizon+8 guard keeps the dock from ever crossing above the water line).
  const dockFloor = clamp(feetY - 6, horizonY + 8, horizonY + 60);
  const dockTop = clamp(feetY - 6, dockFloor, Math.min(structureBottom, H * 0.9));
  const riverH = dockTop - horizonY;

  const geo = useMemo(() => {
    // Far bank treeline: deterministic soft bumps above the horizon.
    const frand = (i: number) => {
      const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    let trees = `M0 ${horizonY.toFixed(1)} `;
    const step = W / 12;
    for (let i = 0; i <= 12; i++) {
      const x = i * step;
      const h = 8 + frand(i) * 12;
      trees += `Q${(x + step * 0.5).toFixed(1)} ${(horizonY - h).toFixed(1)} ${(x + step).toFixed(1)} ${(horizonY - 3 - frand(i + 40) * 5).toFixed(1)} `;
    }
    trees += `L${W.toFixed(1)} ${(horizonY + 4).toFixed(1)} L0 ${(horizonY + 4).toFixed(1)} Z`;
    // Dock planks: horizontal seams from the fascia down, plus staggered butt joints.
    let seams = '';
    for (let y = dockTop + 18, i = 0; y < H + 14; y += 13 + frand(i) * 4, i++) {
      seams += `M0 ${y.toFixed(1)} L${W.toFixed(1)} ${(y + 1.2).toFixed(1)} `;
    }
    let joints = '';
    for (let i = 0; i < 7; i++) {
      const jx = W * (0.08 + frand(i + 9) * 0.84);
      const jy = dockTop + 20 + frand(i + 21) * (H - dockTop - 26);
      joints += `M${jx.toFixed(1)} ${jy.toFixed(1)} L${jx.toFixed(1)} ${(jy + 12).toFixed(1)} `;
    }
    return { trees, seams, joints };
  }, [W, H, horizonY, dockTop]);

  // Lit overlays: flat warm wash on the planks near the stand + a whisper of warmth on the water.
  const dockWarm = useAnimatedProps(() => ({ opacity: lit.value * 0.6 }));
  const waterWarm = useAnimatedProps(() => ({ opacity: lit.value * 0.06 }));

  // Temple placement (camera RIGHT on the far bank, the structure's warm rim side).
  const tx = W * 0.78;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="slsSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={SKY_TOP} />
            <Stop offset="70%" stopColor="#0A0C20" />
            <Stop offset="100%" stopColor={SKY_HOR} />
          </LinearGradient>
          <LinearGradient id="slsWater" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={WATER_TOP} />
            <Stop offset="100%" stopColor={WATER_BOT} />
          </LinearGradient>
          {/* the temple's gold smeared thin down the water (static, faint) */}
          <LinearGradient id="slsTempleRef" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={GOLD} stopOpacity={0.14} />
            <Stop offset="100%" stopColor={GOLD} stopOpacity={0} />
          </LinearGradient>
          {/* lit: flat warm wash on the planks around the stand (linear, no radial glow) */}
          <LinearGradient id="slsDockWarm" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FFB25E" stopOpacity={0.24} />
            <Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </LinearGradient>
          {/* legibility scrim: status area above, button row below */}
          <LinearGradient id="slsScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* ===== SKY: deep indigo night, a few dim high stars, left clean for the field ===== */}
        <Rect x={0} y={0} width={W} height={horizonY + 2} fill="url(#slsSky)" />
        {STARS.map((st, i) => (
          <Circle key={`sls${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#D8E0FA" opacity={st.o} />
        ))}

        {/* ===== THE FAR BANK: treeline, festival lights, the wat's roofline camera RIGHT ===== */}
        <Path d={geo.trees} fill={TREES} />
        {/* the temple: two stacked roof tiers + chofa spire, gold ridge edges */}
        <G>
          <Path d={`M${tx - 16} ${horizonY} L${tx - 11} ${horizonY - 9} L${tx + 11} ${horizonY - 9} L${tx + 16} ${horizonY} Z`} fill={BANK} />
          <Path d={`M${tx - 10} ${horizonY - 9} L${tx - 6} ${horizonY - 17} L${tx + 6} ${horizonY - 17} L${tx + 10} ${horizonY - 9} Z`} fill={BANK} />
          <Path d={`M${tx - 4} ${horizonY - 17} L${tx} ${horizonY - 26} L${tx + 4} ${horizonY - 17} Z`} fill={BANK} />
          <Line x1={tx} y1={horizonY - 26} x2={tx} y2={horizonY - 30} stroke={GOLD} strokeWidth={0.8} opacity={0.55} />
          <Path d={`M${tx - 11} ${horizonY - 9} L${tx - 6} ${horizonY - 17} L${tx} ${horizonY - 26}`} stroke={GOLD} strokeWidth={0.7} fill="none" opacity={0.4} />
          <Path d={`M${tx + 11} ${horizonY - 9} L${tx + 6} ${horizonY - 17} L${tx} ${horizonY - 26}`} stroke={GOLD} strokeWidth={0.7} fill="none" opacity={0.3} />
          <Circle cx={tx - 7} cy={horizonY - 4} r={0.9} fill={GLINT_WARM} opacity={0.5} />
          <Circle cx={tx + 6} cy={horizonY - 4} r={0.8} fill={GLINT_WARM} opacity={0.4} />
        </G>
        {BANK_LIGHTS.map((l, i) => (
          <Circle key={`slb${i}`} cx={W * l.fx} cy={horizonY + l.dy} r={l.r} fill={GLINT_WARM} opacity={l.o} />
        ))}

        {/* ===== THE RIVER: near-black water, temple gold smear, live glints, krathong ===== */}
        <Rect x={0} y={horizonY} width={W} height={riverH} fill="url(#slsWater)" />
        <Rect x={tx - 7} y={horizonY + 1} width={14} height={Math.min(44, riverH * 0.6)} fill="url(#slsTempleRef)" />
        {/* lit: the whole river picks up a whisper of lantern warmth */}
        <AnimatedG animatedProps={waterWarm}>
          <Rect x={0} y={horizonY} width={W} height={riverH} fill="#FF9A3C" />
        </AnimatedG>
        {GLINTS.map((g, i) => (
          <Glint key={`slg${i}`} clock={clock} lit={lit} x={W * g.fx} y={horizonY + 8 + g.fy * (riverH - 16)} len={g.len} s={g.s} />
        ))}
        {KRATHONGS.map((k, i) => (
          <Krathong
            key={`slk${i}`}
            clock={clock}
            lit={lit}
            x={W * k.fx}
            y={horizonY + 10 + k.fy * (riverH - 20)}
            amp={k.amp}
            alwaysOn={k.alwaysOn}
            sx={k.sx}
            sb={k.sb}
            sf={k.sf}
            scale={k.scale}
          />
        ))}

        {/* ===== THE DOCK: fascia edge beam, plank deck with seams, posts, coiled rope ===== */}
        <Rect x={0} y={dockTop} width={W} height={H - dockTop} fill={DOCK} />
        <Rect x={0} y={dockTop} width={W} height={7} fill={DOCK_DK} />
        <Line x1={0} y1={dockTop + 0.6} x2={W} y2={dockTop + 0.6} stroke={DOCK_HI} strokeWidth={1} opacity={0.45} />
        <Line x1={0} y1={dockTop + 7.4} x2={W} y2={dockTop + 7.4} stroke={DOCK_SEAM} strokeWidth={1.2} opacity={0.9} />
        <Path d={geo.seams} stroke={DOCK_SEAM} strokeWidth={1.1} opacity={0.75} fill="none" />
        <Path d={geo.joints} stroke={DOCK_SEAM} strokeWidth={1} opacity={0.5} fill="none" />
        {/* mooring posts flanking the view, clear of the structure at center */}
        <G>
          <Rect x={W * 0.09 - 5} y={dockTop - 32} width={10} height={40} rx={1.5} fill={POST} />
          <Ellipse cx={W * 0.09} cy={dockTop - 32} rx={5} ry={1.8} fill="#1E150B" />
          <Line x1={W * 0.09 - 4.6} y1={dockTop - 30} x2={W * 0.09 - 4.6} y2={dockTop + 4} stroke="#33405C" strokeWidth={0.8} opacity={0.35} />
          <Rect x={W * 0.9 - 5} y={dockTop - 26} width={10} height={34} rx={1.5} fill={POST} />
          <Ellipse cx={W * 0.9} cy={dockTop - 26} rx={5} ry={1.8} fill="#1E150B" />
          <Line x1={W * 0.9 + 4.6} y1={dockTop - 24} x2={W * 0.9 + 4.6} y2={dockTop + 4} stroke={RIM_POST_WARM} strokeWidth={0.8} opacity={0.3} />
        </G>
        {/* coiled mooring rope resting on the planks */}
        <G opacity={0.85}>
          <Ellipse cx={W * 0.2} cy={dockTop + 26} rx={13} ry={4.6} stroke={ROPE} strokeWidth={2.2} fill="none" />
          <Ellipse cx={W * 0.2} cy={dockTop + 25.4} rx={8.5} ry={3.1} stroke={ROPE} strokeWidth={2} fill="none" opacity={0.9} />
          <Ellipse cx={W * 0.2} cy={dockTop + 24.8} rx={4.6} ry={1.8} stroke={ROPE} strokeWidth={1.8} fill="none" opacity={0.8} />
        </G>

        {/* lit: flat warm wash on the planks around the stand (linear, tile band untouched) */}
        <AnimatedG animatedProps={dockWarm}>
          <Rect x={aX - 110} y={feetY - 4} width={220} height={Math.max(0, Math.min(90, H - (feetY - 4)))} fill="url(#slsDockWarm)" />
        </AnimatedG>

        <Rect x={0} y={0} width={W} height={H} fill="url(#slsScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  // Opaque dark base so a not-yet-painted frame never flashes the page background through.
  base: { backgroundColor: '#04060B' },
});
