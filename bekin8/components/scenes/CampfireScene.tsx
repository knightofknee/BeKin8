// components/scenes/CampfireScene.tsx
// The CAMPFIRE backdrop (behind all tiles): a STORYBOOK moonlit forest clearing, fully procedural
// (no photos). Night-sky gradient with static star specks and a small soft moon high left; three
// receding pine-silhouette treelines (darkest nearest); a dark clearing mound that meets the log
// teepee structure at its anchor. Calm fireflies drift over the clearing on loopNoise whenever the
// tab is focused, lit or not. Lighting the beacon blooms a warm anchor-aligned glow low over the
// clearing (450ms in, 600ms out) and warms the nearest treeline + ground very slightly. Friend
// tiles sit over the 12..62% band, so that band stays dark and quiet; a top + bottom scrim keeps
// white text legible.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, G } from 'react-native-svg';
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

// Static star specks (fractions of W/H), varied size/opacity, kept clear of the moon (high left).
// Lower ones fade dimmer so the tile band stays quiet.
const STARS = [
  { x: 0.38, y: 0.05, r: 1.2, o: 0.7 }, { x: 0.52, y: 0.09, r: 0.9, o: 0.45 }, { x: 0.66, y: 0.04, r: 1.4, o: 0.8 },
  { x: 0.8, y: 0.08, r: 1.0, o: 0.55 }, { x: 0.92, y: 0.05, r: 1.2, o: 0.7 }, { x: 0.46, y: 0.16, r: 1.0, o: 0.5 },
  { x: 0.6, y: 0.2, r: 0.8, o: 0.35 }, { x: 0.74, y: 0.15, r: 1.1, o: 0.6 }, { x: 0.88, y: 0.19, r: 0.9, o: 0.4 },
  { x: 0.08, y: 0.24, r: 0.9, o: 0.45 }, { x: 0.3, y: 0.27, r: 0.8, o: 0.35 }, { x: 0.55, y: 0.31, r: 0.9, o: 0.3 },
  { x: 0.82, y: 0.33, r: 0.8, o: 0.3 }, { x: 0.17, y: 0.38, r: 0.8, o: 0.25 }, { x: 0.68, y: 0.4, r: 0.8, o: 0.25 },
];

// Fireflies: the same calm approach as BeaconScene's FireflyDot. Each drifts slowly on its own
// long-period loopNoise and is UNLIT far more than lit; with incommensurate periods the number
// glowing at once is mostly 0, sometimes 1. Positions hug the clearing, below the tile band.
const FLIES = [
  { x: 0.24, y: 0.57, sx: makeSeed(4.2, 10.3, 1.3, 15.1), sy: makeSeed(8.1, 6.6, 1.4, 11.3), bl: makeSeed(14.9, 3.3, 1.5, 10.2) },
  { x: 0.7, y: 0.53, sx: makeSeed(10.5, 2.8, 1.4, 12.9), sy: makeSeed(3.7, 12.2, 1.3, 16.1), bl: makeSeed(18.1, 7.5, 1.5, 12.4) },
  { x: 0.48, y: 0.63, sx: makeSeed(6.9, 8.4, 1.3, 14.7), sy: makeSeed(12.8, 5.1, 1.4, 13.6), bl: makeSeed(22.4, 2.6, 1.5, 9.1) },
  { x: 0.84, y: 0.66, sx: makeSeed(9.2, 6.3, 1.4, 13.1), sy: makeSeed(5.4, 11.7, 1.3, 14.4), bl: makeSeed(16.6, 9.8, 1.5, 11.9) },
  { x: 0.13, y: 0.68, sx: makeSeed(11.8, 3.4, 1.3, 17.2), sy: makeSeed(7.3, 13.5, 1.4, 12.2), bl: makeSeed(20.2, 5.7, 1.5, 8.9) },
];

function FireflyDot({ clock, x, y, sx, sy, bl }: { clock: SharedValue<number>; x: number; y: number; sx: NoiseSeed; sy: NoiseSeed; bl: NoiseSeed }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    // Lit only in the TOP slice of the noise (~top 20%), ramped + squared: dark most of the time,
    // glowing up gently now and then.
    let g = (loopNoise(t, bl) - 0.8) / 0.16;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    g = g * g;
    return {
      opacity: g,
      transform: [
        { translateX: x + loopNoiseSigned(t, sx, 48) }, // gentle slow wander
        { translateY: y + loopNoiseSigned(t, sy, 60) },
      ],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={4.5} fill="url(#cfFly)" />
      <Circle cx={0} cy={0} r={1.5} fill="#FFF6B0" />
    </AnimatedG>
  );
}

// Deterministic jagged pine treeline: per tree a shoulder, peak, shoulder with valleys at the base,
// closed down to the bottom of the screen so nearer layers stack over farther ones.
function treelinePath(W: number, H: number, base: number, rise: number, trees: number, seed: number): string {
  const rand = (i: number) => {
    const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const seg = W / trees;
  let d = `M0 ${H.toFixed(1)} L0 ${base.toFixed(1)}`;
  for (let i = 0; i < trees; i++) {
    const x0 = i * seg;
    const peakX = x0 + seg * (0.35 + rand(i * 3) * 0.3);
    const peakY = base - rise * (0.55 + rand(i * 3 + 1) * 0.45);
    const midY = base - rise * (0.16 + rand(i * 3 + 2) * 0.22);
    d += ` L${(x0 + seg * 0.16).toFixed(1)} ${midY.toFixed(1)} L${peakX.toFixed(1)} ${peakY.toFixed(1)} L${(x0 + seg * 0.84).toFixed(1)} ${midY.toFixed(1)} L${(x0 + seg).toFixed(1)} ${base.toFixed(1)}`;
  }
  d += ` L${W.toFixed(1)} ${H.toFixed(1)} Z`;
  return d;
}

export type CampfireSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function CampfireScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: CampfireSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Flame seat: anchor-aligned when measured (clamped so odd layouts can't push the clearing off
  // screen), else a sensible fraction of the window.
  const seatY = measured && anchorY != null ? Math.min(Math.max(anchorY, H * 0.55), H * 0.9) : H * 0.72;
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = seatY + (1 - skin.origin) * 180;

  const geo = useMemo(() => {
    // Treelines recede lighter with distance; the band lands roughly at 55..78% of height when unmeasured.
    const far = treelinePath(W, H, seatY - H * 0.1, H * 0.085, 18, 5.1);
    const mid = treelinePath(W, H, seatY - H * 0.04, H * 0.095, 12, 11.7);
    const near = treelinePath(W, H, seatY + H * 0.02, H * 0.11, 8, 23.3);
    // Clearing ground: a gentle mound cresting under the structure so the logs sit on it.
    const crestY = Math.min(structureBottom - 24, H * 0.92);
    const edgeY = Math.min(crestY + H * 0.035, H);
    const mound = `M0 ${H.toFixed(1)} L0 ${edgeY.toFixed(1)} Q ${seatX.toFixed(1)} ${(2 * crestY - edgeY).toFixed(1)} ${W.toFixed(1)} ${edgeY.toFixed(1)} L${W.toFixed(1)} ${H.toFixed(1)} Z`;
    return { far, mid, near, mound };
  }, [W, H, seatX, seatY, structureBottom]);

  // Scene clock for the fireflies (shared gated clock: registered + paused while gated off), and
  // fireflies drift whether the beacon is lit or not (gated on focus so the clock pauses off-tab).
  const { clock } = useGatedClock(!reduce && focused);

  // Firelight: blooms low over the clearing when lit, fades when doused. Starts at the lit state so
  // mounting with active=true renders lit without replaying the ignition.
  const glowOp = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) { glowOp.value = active ? 1 : 0; return; }
    glowOp.value = withTiming(active ? 1 : 0, { duration: active ? 450 : 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  const glowProps = useAnimatedProps(() => ({ opacity: glowOp.value }));
  const warmProps = useAnimatedProps(() => ({ opacity: glowOp.value * 0.5 }));
  useEffect(() => () => { cancelAnimation(glowOp); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="cfSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0A1730" /><Stop offset="100%" stopColor="#12264A" />
          </LinearGradient>
          <RadialGradient id="cfMoon" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF6DC" stopOpacity={0.55} /><Stop offset="45%" stopColor="#E9E6C9" stopOpacity={0.18} /><Stop offset="100%" stopColor="#E9E6C9" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cfFly" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cfGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.5} /><Stop offset="55%" stopColor={skin.glow.edge} stopOpacity={0.2} /><Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          {/* warm wash localized around the fire seat, painted into the near treeline + ground */}
          <RadialGradient id="cfWarm" gradientUnits="userSpaceOnUse" cx={seatX} cy={seatY} r={W * 0.55}>
            <Stop offset="0%" stopColor="#FF9E4A" stopOpacity={0.5} /><Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.14} /><Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: darken top (status/tiles) and bottom (buttons), middle clearest. */}
          <LinearGradient id="cfScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} /><Stop offset="22%" stopColor="#000" stopOpacity={0} /><Stop offset="78%" stopColor="#000" stopOpacity={0} /><Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* night sky + static stars */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#cfSky)" />
        {STARS.map((st, i) => (
          <Circle key={`cfs${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#EAF0FF" opacity={st.o} />
        ))}
        {/* small soft full moon, high left, with a gentle halo; three barely-there maria blotches
            (0.08 opacity) so it reads as a moon rather than a plain disc, storybook-soft */}
        <Circle cx={W * 0.18} cy={H * 0.09} r={58} fill="url(#cfMoon)" />
        <Circle cx={W * 0.18} cy={H * 0.09} r={15} fill="#F4EFDC" opacity={0.95} />
        <Circle cx={W * 0.18 - 4.5} cy={H * 0.09 - 3.5} r={4.8} fill="#6B7488" opacity={0.08} />
        <Circle cx={W * 0.18 + 4} cy={H * 0.09 + 1.5} r={3.6} fill="#6B7488" opacity={0.08} />
        <Circle cx={W * 0.18 - 1.5} cy={H * 0.09 + 6.5} r={2.4} fill="#6B7488" opacity={0.08} />

        {/* pine treelines, receding lighter with distance, then the clearing ground */}
        <Path d={geo.far} fill="#123052" />
        <Path d={geo.mid} fill="#0D1B30" />
        <Path d={geo.near} fill="#0A1526" />
        <Path d={geo.mound} fill="#0B1D22" />

        {/* lit: very slight warm on the nearest silhouettes, then the firelight bloom itself */}
        <AnimatedG animatedProps={warmProps}>
          <Path d={geo.near} fill="url(#cfWarm)" />
          <Path d={geo.mound} fill="url(#cfWarm)" />
        </AnimatedG>
        <AnimatedG animatedProps={glowProps}>
          <Ellipse cx={seatX} cy={seatY + 34} rx={W * 0.44} ry={110} fill="url(#cfGlow)" />
        </AnimatedG>

        {/* calm fireflies drifting over the clearing (lit or not) */}
        {FLIES.map((f, i) => (
          <FireflyDot key={`cff${i}`} clock={clock} x={W * f.x} y={H * f.y} sx={f.sx} sy={f.sy} bl={f.bl} />
        ))}

        {/* scrim over everything so tiles/text stay legible */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#cfScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
