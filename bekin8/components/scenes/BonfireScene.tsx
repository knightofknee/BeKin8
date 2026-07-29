// components/scenes/BonfireScene.tsx
// Full-screen BACKDROP for the Bonfire skin, round 4: OPEN FARMLAND UNDER A SETTING SUN. The one
// warm-daylight scene besides the mesa, and deliberately nothing like the app's night scenes: a
// big low sun half-set on the horizon, hazy hills, banded fields with hedgerows, a distant
// farmhouse, fence posts along the near ground. The pyre sits FLUSH on the land: the foreground
// ground plane is anchored to the structure's base (anchor-aware), so the woodpile stands ON the
// dirt, never floating in front of scenery. Lighting the fire deepens the sky toward dusk and
// pools warm light on the ground around the pyre (flat shapes, no glow balls). Pure procedural
// SVG; static apart from the lit ramp.
//
// TIMING CONTRACT (t=0 = lit edge): the torch flies 0-0.9s, so the dusk deepen + ground light
// wait for the impact; extinguish fades back to full sunset with no delay.
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Ellipse, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Homeward birds, high in the evening blue.
const BIRDS = [
  { x: 0.22, y: 0.07, s: 1.0 },
  { x: 0.3, y: 0.055, s: 0.75 },
  { x: 0.72, y: 0.08, s: 0.9 },
];
const birdPath = (x: number, y: number, s: number) =>
  `M${x - 7 * s} ${y} Q${x - 3.5 * s} ${y - 5 * s} ${x} ${y} Q${x + 3.5 * s} ${y - 5 * s} ${x + 7 * s} ${y}`;

export type BonfireSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function BonfireScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: BonfireSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  void focused; // static scene apart from the lit ramp

  const hasAnchor = measured && typeof anchorY === 'number';
  const seatY = hasAnchor ? (anchorY as number) : H * 0.62;
  const ax = measured && typeof anchorX === 'number' ? anchorX : W * 0.5;
  const structureBottom = seatY - skin.origin * 180 + 180;

  // The land the pyre stands ON: foreground ground plane cresting flush at the structure's base.
  const groundTop = clamp(hasAnchor ? structureBottom - 6 : H * 0.76, H * 0.55, H * 0.9);
  const groundPath =
    `M0 ${groundTop + 16}` +
    ` C${ax * 0.45} ${groundTop + 16} ${ax * 0.65} ${groundTop} ${ax} ${groundTop}` +
    ` C${ax + (W - ax) * 0.35} ${groundTop} ${ax + (W - ax) * 0.55} ${groundTop + 16} ${W} ${groundTop + 16}`;

  // Field bands stack up from the ground to the horizon; the sun sets right on the horizon line.
  const horizonY = groundTop - clamp(H * 0.17, 96, 160);
  const hFrac = clamp(horizonY / H, 0.25, 0.85);
  const band1 = horizonY + (groundTop - horizonY) * 0.32; // far wheat
  const band2 = horizonY + (groundTop - horizonY) * 0.66; // near field

  // Lit ramp: dusk deepen + ground light, waiting for the torch impact.
  const ramp = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    cancelAnimation(ramp);
    if (reduce) {
      ramp.value = active ? 1 : 0;
      return;
    }
    if (active) ramp.value = withDelay(900, withTiming(1, { duration: 550 }));
    else ramp.value = withTiming(0, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => cancelAnimation(ramp), []); // eslint-disable-line react-hooks/exhaustive-deps

  const duskProps = useAnimatedProps(() => ({ opacity: ramp.value * 0.22 }));
  const poolProps = useAnimatedProps(() => ({ opacity: ramp.value }));

  // The sun SETS with the fire: once lit it sinks slowly (~7s) from ~45% showing to ~25% above
  // the hills, and climbs back when the beacon goes out. Its own ramp so the slow sink doesn't
  // drag the dusk/pool timing.
  const sunP = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    cancelAnimation(sunP);
    if (reduce) {
      sunP.value = active ? 1 : 0;
      return;
    }
    if (active) sunP.value = withDelay(900, withTiming(1, { duration: 7000 }));
    else sunP.value = withTiming(0, { duration: 2600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => cancelAnimation(sunP), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sunProps = useAnimatedProps(() => ({ transform: [{ translateY: sunP.value * 16 }] }));

  // Fence posts along the near ground curve (skip the middle where the pyre stands).
  const groundAt = (x: number) => {
    // sample the two-segment ground curve loosely: crest at ax, edges 16px lower
    const d = Math.abs(x - ax) / Math.max(ax, W - ax);
    return groundTop + 16 * Math.min(1, d * 1.4);
  };
  const FENCE_X = [0.06, 0.16, 0.26, 0.74, 0.84, 0.94];

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          {/* evening sky: pale blue high up melting to gold and ember at the horizon */}
          <LinearGradient id="bfsSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#8FB0D8" />
            <Stop offset={clamp(hFrac - 0.28, 0.1, 1)} stopColor="#C9C08E" />
            <Stop offset={clamp(hFrac - 0.1, 0.15, 1)} stopColor="#EFC077" />
            <Stop offset={hFrac} stopColor="#EA8A50" />
          </LinearGradient>
          {/* dusk overlay while lit: the evening leans toward night as the fire takes over */}
          <LinearGradient id="bfsDusk" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#2A1E3E" />
            <Stop offset={1} stopColor="#3A2210" />
          </LinearGradient>
          <LinearGradient id="bfsScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.42} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.42} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill="url(#bfsSky)" />

        {/* the setting sun; it sinks lower while the beacon burns */}
        <AnimatedG animatedProps={sunProps}>
          <Circle cx={W * 0.5} cy={horizonY + 6} r={58} fill="#FFE9B8" opacity={0.32} />
          <Circle cx={W * 0.5} cy={horizonY + 6} r={42} fill="#FFEDBC" opacity={0.95} />
        </AnimatedG>

        {BIRDS.map((b, i) => (
          <Path key={`bfb${i}`} d={birdPath(W * b.x, H * b.y, b.s)} stroke="#5A4634" strokeWidth={1.5} fill="none" opacity={0.65} />
        ))}

        {/* hazy far hills cut across the sun */}
        <Path
          d={`M0 ${horizonY + 2} Q${W * 0.2} ${horizonY - 14} ${W * 0.42} ${horizonY - 2} T${W * 0.78} ${horizonY - 8} T${W * 1.05} ${horizonY} L${W} ${groundTop + 20} L0 ${groundTop + 20} Z`}
          fill="#B08468"
        />

        {/* far wheat band with a hedgerow on its edge */}
        <Rect x={0} y={band1} width={W} height={groundTop + 20 - band1} fill="#D8AE66" />
        {[0.1, 0.2, 0.55, 0.86].map((fx, i) => (
          <Ellipse key={`hg${i}`} cx={W * fx} cy={band1 + 2} rx={22 + (i % 2) * 10} ry={9} fill="#4E5A34" />
        ))}
        {/* distant farmhouse on the wheat band, one warm window */}
        <G>
          <Rect x={W * 0.72} y={band1 - 15} width={26} height={15} fill="#5C4534" />
          <Path d={`M${W * 0.72 - 3} ${band1 - 15} L${W * 0.72 + 13} ${band1 - 26} L${W * 0.72 + 29} ${band1 - 15} Z`} fill="#4A3628" />
          <Rect x={W * 0.72 + 9} y={band1 - 10} width={5} height={6} rx={1} fill="#FFD98C" opacity={0.9} />
        </G>

        {/* near field band */}
        <Rect x={0} y={band2} width={W} height={groundTop + 20 - band2} fill="#B99450" />
        {[0.32, 0.68].map((fx, i) => (
          <Ellipse key={`hg2${i}`} cx={W * fx} cy={band2 + 1} rx={30} ry={11} fill="#55603A" />
        ))}

        {/* THE GROUND the pyre stands on, flush at its base, filled to the screen bottom */}
        <Path d={`${groundPath} L${W} ${H} L0 ${H} Z`} fill="#7C6B42" />
        {/* dirt patch + warm contact shadow right under the woodpile */}
        <Ellipse cx={ax} cy={structureBottom - 2} rx={86} ry={12} fill="#6B5433" />
        <Ellipse cx={ax} cy={structureBottom - 3} rx={64} ry={8} fill="#4A3A22" opacity={0.5} />

        {/* lit: warm firelight pooling on the dirt (flat shapes, under the structure layer) */}
        <AnimatedG animatedProps={poolProps}>
          <Ellipse cx={ax} cy={structureBottom + 2} rx={120} ry={16} fill="#FFB35C" opacity={0.16} />
          <Ellipse cx={ax} cy={structureBottom + 1} rx={78} ry={10} fill="#FFD98C" opacity={0.14} />
        </AnimatedG>

        {/* fence posts + rail along the near ground, framing the site */}
        {FENCE_X.map((fx, i) => {
          const x = W * fx;
          const y = groundAt(x) + 10;
          return (
            <G key={`fp${i}`}>
              <Rect x={x - 1.6} y={y - 14} width={3.2} height={16} rx={1.4} fill="#5A4634" />
              {i % 3 !== 2 && (
                <Rect x={x} y={y - 10} width={W * 0.1} height={2.2} rx={1.1} fill="#5A4634" opacity={0.85} />
              )}
            </G>
          );
        })}
        {/* grass tufts on the ground line */}
        {[0.1, 0.3, 0.7, 0.9].map((fx, i) => {
          const gx = W * fx;
          const gy = groundAt(gx) + 4;
          const lean = fx < 0.5 ? -3 : 3;
          return (
            <Path
              key={`gt${i}`}
              d={`M${gx} ${gy} L${gx + lean} ${gy - 8} M${gx + 5} ${gy + 1} L${gx + 5 + lean * 0.6} ${gy - 5}`}
              stroke="#55603A"
              strokeWidth={1.8}
              strokeLinecap="round"
              fill="none"
              opacity={0.8}
            />
          );
        })}

        {/* lit: the sky steps toward dusk so the blaze owns the scene */}
        <AnimatedRect animatedProps={duskProps} x={0} y={0} width={W} height={H} fill="url(#bfsDusk)" />

        <Rect x={0} y={0} width={W} height={H} fill="url(#bfsScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#3A2210' },
});
