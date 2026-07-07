// components/scenes/BeaconsScene.tsx
// THE BEACONS backdrop (behind all tiles): the LOTR signal chain, fully procedural, no photos.
// A cold pre-dawn sky (#0D1626 to #22334F) with faint stars thinning toward the horizon; six
// hand-crafted ridgeline silhouettes recede into blue haze (nearest darkest and lowest, each
// farther ridge lighter and higher, sparse snow ticks on the far peaks). The nearest ridge carries
// a flat ledge aligned to the structure box via anchorX/anchorY: your pyre stands on rock.
// HERO: seven distant beacon fires zigzag up the range on successive ridges. Lighting your pyre
// kindles them ONE BY ONE down the chain (2.2s after ignition, then ~1.75s per link: a watcher has
// to SEE the previous light and run out to light theirs, so the wave travels slowly, each a quick
// bloom that settles into a gentle 0.75..1 flicker); extinguishing dims them all to faint embers.
// First mount while already lit shows the whole chain steady-on, no cascade replay.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, Ellipse, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withTiming,
  withSequence,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

const DIM = 0.12; // barely-visible ember state of a distant beacon while yours is out
const BLOOM = 1.35; // envelope overshoot on kindle; opacity clamps at 1 so it reads as a bright pop

// Faint pre-dawn stars. Opacity is baked per star and thins with y so they fade into the horizon
// haze; they are static (zero animated nodes) to keep the tile band calm.
const STARS = [
  { x: 0.08, y: 0.05, r: 1.2, o: 0.7 }, { x: 0.22, y: 0.09, r: 0.9, o: 0.55 }, { x: 0.35, y: 0.04, r: 1.3, o: 0.75 },
  { x: 0.5, y: 0.11, r: 1.0, o: 0.5 }, { x: 0.63, y: 0.06, r: 1.2, o: 0.65 }, { x: 0.78, y: 0.03, r: 1.0, o: 0.7 },
  { x: 0.9, y: 0.08, r: 1.3, o: 0.6 }, { x: 0.15, y: 0.16, r: 0.9, o: 0.4 }, { x: 0.44, y: 0.19, r: 1.0, o: 0.35 },
  { x: 0.7, y: 0.15, r: 0.9, o: 0.4 }, { x: 0.86, y: 0.2, r: 1.0, o: 0.3 }, { x: 0.3, y: 0.24, r: 0.9, o: 0.22 },
  { x: 0.58, y: 0.26, r: 0.9, o: 0.18 }, { x: 0.06, y: 0.27, r: 1.0, o: 0.15 },
];

// Far ridges, drawn far-to-near (the nearest ridge is built in-render around the anchor ledge).
// lift = crest height above the near ledge line, pts are [xFraction, peakLift], both in units of
// the ridge band span; each ridge that seats a chain fire has a hand-placed peak under it.
type RidgeDef = { lift: number; color: string; pts: ReadonlyArray<readonly [number, number]> };
const RIDGES: RidgeDef[] = [
  { lift: 0.84, color: '#2B4270', pts: [[0, 0.02], [0.07, 0.06], [0.14, 0], [0.22, 0.05], [0.29, 0.01], [0.36, 0.06], [0.43, -0.01], [0.48, 0.04], [0.52, 0.14], [0.56, 0.03], [0.63, 0.07], [0.71, 0], [0.79, 0.05], [0.87, 0.01], [0.94, 0.06], [1, 0.02]] },
  { lift: 0.7, color: '#24395F', pts: [[0, 0.03], [0.08, 0.02], [0.16, 0.06], [0.24, 0], [0.33, 0.07], [0.41, 0.01], [0.5, 0.05], [0.58, -0.01], [0.64, 0.04], [0.7, 0.13], [0.76, 0.02], [0.84, 0.07], [0.92, 0.01], [1, 0.05]] },
  { lift: 0.56, color: '#1D3050', pts: [[0, 0.01], [0.09, 0.07], [0.18, 0], [0.28, 0.06], [0.37, -0.01], [0.46, 0.05], [0.55, 0.01], [0.62, 0.06], [0.7, -0.01], [0.79, 0.06], [0.88, 0], [1, 0.06]] },
  { lift: 0.42, color: '#16253E', pts: [[0, 0.05], [0.08, 0], [0.15, 0.06], [0.21, 0.02], [0.26, 0.06], [0.32, 0], [0.4, 0.07], [0.49, 0.01], [0.58, 0.08], [0.67, 0], [0.76, 0.05], [0.85, -0.01], [0.93, 0.04], [1, 0.01]] },
  { lift: 0.28, color: '#101B2F', pts: [[0, 0.02], [0.1, 0.08], [0.19, 0], [0.3, 0.06], [0.4, -0.01], [0.5, 0.05], [0.6, 0], [0.7, 0.03], [0.78, 0.08], [0.86, 0.01], [0.94, 0.06], [1, 0.02]] },
];

// Sparse snow ticks on far, fireless peaks (lift = ridge lift + that peak's dy).
const SNOW = [
  { x: 0.22, lift: 0.89 }, { x: 0.63, lift: 0.91 }, { x: 0.94, lift: 0.9 },
  { x: 0.33, lift: 0.77 }, { x: 0.84, lift: 0.77 },
];

// THE SIGNAL CHAIN: seven fires zigzagging up the range, each seated on a hand-placed ridge peak
// (lift = ridge lift + peak dy, so fire y and silhouette agree). Nearer = larger. Incommensurate
// noise periods keep the flickers from ever locking step.
const CHAIN = [
  { x: 0.78, lift: 0.36, s: 6.0, seed: makeSeed(2.3, 7.1, 1.4, 5.3) },
  { x: 0.26, lift: 0.48, s: 5.2, seed: makeSeed(5.7, 3.2, 1.3, 6.1) },
  { x: 0.62, lift: 0.62, s: 4.5, seed: makeSeed(9.1, 11.4, 1.5, 6.9) },
  { x: 0.16, lift: 0.76, s: 3.9, seed: makeSeed(4.4, 8.8, 1.4, 5.7) },
  { x: 0.7, lift: 0.83, s: 3.4, seed: makeSeed(12.6, 2.7, 1.3, 7.7) },
  { x: 0.36, lift: 0.9, s: 2.9, seed: makeSeed(7.9, 13.5, 1.5, 8.3) },
  { x: 0.52, lift: 0.98, s: 2.5, seed: makeSeed(3.6, 10.2, 1.4, 8.9) },
];

// Tiny flame glyph (same teardrop as BeaconScene's RidgeFlame): base at (x,y), tip at y - 2.7s.
const flamePath = (x: number, y: number, s: number) =>
  `M${x} ${y} C${x - s} ${y - s * 1.2} ${x - s * 0.5} ${y - s * 2.2} ${x} ${y - s * 2.7} C${x + s * 0.5} ${y - s * 2.2} ${x + s} ${y - s * 1.2} ${x} ${y} Z`;

function ridgePath(pts: ReadonlyArray<readonly [number, number]>, W: number, H: number, crestY: number, span: number): string {
  let d = `M-2 ${(crestY - pts[0][1] * span).toFixed(1)}`;
  for (const [xf, dy] of pts) d += ` L${(xf * W).toFixed(1)} ${(crestY - dy * span).toFixed(1)}`;
  const yEnd = (crestY - pts[pts.length - 1][1] * span).toFixed(1);
  return d + ` L${(W + 2).toFixed(1)} ${yEnd} L${(W + 2).toFixed(1)} ${(H + 2).toFixed(1)} L-2 ${(H + 2).toFixed(1)} Z`;
}

const snowPath = (x: number, y: number) =>
  `M${(x - 7).toFixed(1)} ${(y + 5).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(x + 6).toFixed(1)} ${(y + 4).toFixed(1)}`;

type ChainFireProps = {
  env: SharedValue<number>;
  clock: SharedValue<number>;
  motion: SharedValue<number>;
  seed: NoiseSeed;
  x: number;
  y: number;
  s: number;
};

function ChainFire({ env, clock, motion, seed, x, y, s }: ChainFireProps) {
  const props = useAnimatedProps(() => {
    // Organic 0.75..1 flicker while motion runs; the flicker mean when frozen (reduce, unfocused,
    // or unlit) so end states hold perfectly still. env overshoots 1 on kindle; opacity clamps.
    let n = loopNoise(clock.value, seed);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    const flick = motion.value === 1 ? 0.75 + 0.25 * n : 0.875;
    const o = env.value * flick;
    return { opacity: o > 1 ? 1 : o };
  });
  return (
    <AnimatedG animatedProps={props}>
      {/* small, contained glow (a dim distant point, never a blob over the tile band) */}
      <Circle cx={x} cy={y - s} r={s * 1.5} fill="url(#bcnGlow)" />
      <Path d={flamePath(x, y, s)} fill="url(#bcnFlame)" />
      <Path d={flamePath(x, y - s * 0.15, s * 0.55)} fill="#FFF7D6" />
    </AnimatedG>
  );
}

export type BeaconsSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  /** Page-relative px of the flame seat inside the 180px structure box. */
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function BeaconsScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: BeaconsSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Cascade envelope per chain fire. Explicit hooks (never map over hooks, Rules of Hooks); this
  // list MUST stay in sync with CHAIN.length (7).
  const env0 = useSharedValue(active ? 1 : DIM);
  const env1 = useSharedValue(active ? 1 : DIM);
  const env2 = useSharedValue(active ? 1 : DIM);
  const env3 = useSharedValue(active ? 1 : DIM);
  const env4 = useSharedValue(active ? 1 : DIM);
  const env5 = useSharedValue(active ? 1 : DIM);
  const env6 = useSharedValue(active ? 1 : DIM);
  const envs = [env0, env1, env2, env3, env4, env5, env6];
  const prevActive = useRef(active);
  useEffect(() => {
    const wasActive = prevActive.current;
    prevActive.current = active;
    if (active) {
      // Cascade only on a real unlit -> lit edge; first mount while already lit (or any re-run
      // like a reduce toggle) jumps straight to steady-on, never replaying the ignition.
      const cascade = !wasActive && !reduce;
      envs.forEach((e, i) => {
        cancelAnimation(e);
        if (!cascade) { e.value = 1; return; }
        e.value = withDelay(
          // Slow narrative pace: each watcher sees the previous beacon, then lights their own.
          2200 + i * 1750,
          withSequence(withTiming(BLOOM, { duration: 220 }), withTiming(1, { duration: 480 }))
        );
      });
    } else {
      envs.forEach((e) => { cancelAnimation(e); e.value = reduce ? DIM : withTiming(DIM, { duration: 600 }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  // Scene clock for the chain flicker (shared gated clock: registered + paused while gated); the
  // flicker only exists while lit, so `active` gates it too (BeaconScene clock pattern).
  const { clock, motion } = useGatedClock(focused && !reduce && active);

  // Warm ground light on the ledge under your own pyre while lit.
  const litOp = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    litOp.value = reduce ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: active ? 700 : 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  const ledgeProps = useAnimatedProps(() => ({ opacity: litOp.value }));

  useEffect(() => () => {
    envs.forEach((e) => cancelAnimation(e));
    cancelAnimation(litOp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geometry. The near-ridge ledge line tracks the bottom of the 180px structure box (anchorY is
  // the flame seat, at skin.origin inside the box). Clamped so a bad measurement can never push
  // the chain out of its ~30%..58% legibility band; fires span [0.3H .. nearTop] by construction.
  const ax = measured && anchorX != null ? anchorX : W * 0.5;
  const rawTop = measured && anchorY != null ? anchorY - skin.origin * 180 + 180 - 12 : H * 0.74;
  const nearTop = Math.min(Math.max(rawTop, H * 0.62), H * 0.85);
  const span = nearTop - H * 0.3;
  const py = (dy: number) => (nearTop - dy * span).toFixed(1);

  // Nearest ridge: jagged foothills either side of a flat, anchor-centered ledge for the pyre.
  const lEdge = ax - 72;
  const rEdge = ax + 72;
  const tail = W + 2 - rEdge;
  const nearPath =
    `M-2 ${py(0.05)} L${(lEdge * 0.25).toFixed(1)} ${py(0.1)} L${(lEdge * 0.55).toFixed(1)} ${py(0.03)}` +
    ` L${(lEdge * 0.82).toFixed(1)} ${py(0.08)} L${lEdge.toFixed(1)} ${py(0.02)}` +
    ` L${(lEdge + 24).toFixed(1)} ${py(0)} L${(rEdge - 24).toFixed(1)} ${py(0)} L${rEdge.toFixed(1)} ${py(0.02)}` +
    ` L${(rEdge + tail * 0.3).toFixed(1)} ${py(0.09)} L${(rEdge + tail * 0.6).toFixed(1)} ${py(0.02)}` +
    ` L${(rEdge + tail * 0.85).toFixed(1)} ${py(0.07)} L${(W + 2).toFixed(1)} ${py(0.03)}` +
    ` L${(W + 2).toFixed(1)} ${(H + 2).toFixed(1)} L-2 ${(H + 2).toFixed(1)} Z`;

  const hazeY = nearTop - span * 1.08;
  const hazeH = span * 0.75;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="bcnSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0D1626" />
            <Stop offset="36%" stopColor="#22334F" />
            <Stop offset="100%" stopColor="#22334F" />
          </LinearGradient>
          {/* atmospheric haze band over the far ridges, fading before the near ones */}
          <LinearGradient id="bcnHaze" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#9FB3D1" stopOpacity={0} />
            <Stop offset="40%" stopColor="#9FB3D1" stopOpacity={0.09} />
            <Stop offset="100%" stopColor="#9FB3D1" stopOpacity={0} />
          </LinearGradient>
          <RadialGradient id="bcnGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.outer[0]} stopOpacity={0.9} />
            <Stop offset="60%" stopColor={skin.outer[1]} stopOpacity={0.25} />
            <Stop offset="100%" stopColor={skin.outer[1]} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="bcnFlame" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor={skin.mid[0]} />
            <Stop offset="45%" stopColor={skin.mid[1]} />
            <Stop offset="100%" stopColor={skin.outer[1]} />
          </LinearGradient>
          <RadialGradient id="bcnLedge" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.38} />
            <Stop offset="55%" stopColor={skin.glow.edge} stopOpacity={0.12} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: darken top (status/tiles) and bottom (buttons), middle stays clear. */}
          <LinearGradient id="bcnScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill="url(#bcnSky)" />
        {STARS.map((st, i) => (
          <Circle key={`bcnSt${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#D8E4F6" opacity={st.o} />
        ))}

        {RIDGES.map((r, i) => (
          <Path key={`bcnR${i}`} d={ridgePath(r.pts, W, H, nearTop - r.lift * span, span)} fill={r.color} />
        ))}
        <Rect x={0} y={hazeY} width={W} height={hazeH} fill="url(#bcnHaze)" />
        {SNOW.map((sn, i) => (
          <Path
            key={`bcnSn${i}`}
            d={snowPath(W * sn.x, nearTop - sn.lift * span + 1)}
            stroke="#9FB3D1"
            strokeWidth={1.2}
            strokeLinecap="round"
            fill="none"
            opacity={0.45}
          />
        ))}
        <Path d={nearPath} fill="#0A1220" />

        <AnimatedG animatedProps={ledgeProps}>
          <Ellipse cx={ax} cy={nearTop + 4} rx={112} ry={42} fill="url(#bcnLedge)" />
        </AnimatedG>

        {/* the answering chain, kindling one by one up the range */}
        {CHAIN.map((c, i) => (
          <ChainFire
            key={`bcnF${i}`}
            env={envs[i]}
            clock={clock}
            motion={motion}
            seed={c.seed}
            x={W * c.x}
            y={nearTop - c.lift * span - 2}
            s={c.s}
          />
        ))}

        <Rect x={0} y={0} width={W} height={H} fill="url(#bcnScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
