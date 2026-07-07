// components/scenes/BonfireScene.tsx
// Full-screen BACKDROP for the Bonfire skin: a DUSK FESTIVAL FIELD in bold poster gradients.
// Critically NOT dark while unlit: deep violet sky up top (calm, for tile legibility) melting
// through plum into a glowing amber-rose horizon band, with a low rolling field/treeline
// silhouette that meets the pyre structure. Lighting the bonfire deepens the sky a touch
// (translucent dim over 600ms), cools the horizon band, and releases three slow warm ember
// motes near the pyre (loopNoise wander, only while lit + focused). Extinguishing returns to
// the bright dusk over 700ms. The pyre stands on a NEAR foreground land plane (a full-width
// dark band cresting under the structure base, rim-lit by the dusk); the rolling hills and
// their tiny trees sit clearly behind and above it, so nothing distant ever cuts through the
// pyre. A soft contact shadow pins the base. Pure procedural SVG, no photos.
import React, { useEffect } from 'react';
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
import { loopNoiseSigned, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Early evening stars, high in the violet (all above the 12% tile line, under the top scrim).
const STARS = [
  { x: 0.16, y: 0.05, r: 1.3, o: 0.75 },
  { x: 0.38, y: 0.09, r: 1.0, o: 0.55 },
  { x: 0.63, y: 0.04, r: 1.4, o: 0.8 },
  { x: 0.85, y: 0.08, r: 1.1, o: 0.6 },
];

// Distant birds heading home: tiny dark silhouettes, dim enough to sit inside the tile band.
const BIRDS = [
  { x: 0.2, y: 0.3, s: 1.0 },
  { x: 0.27, y: 0.27, s: 0.75 },
  { x: 0.74, y: 0.34, s: 0.85 },
];
const birdPath = (x: number, y: number, s: number) =>
  `M${x - 7 * s} ${y} Q${x - 3.5 * s} ${y - 5 * s} ${x} ${y} Q${x + 3.5 * s} ${y - 5 * s} ${x + 7 * s} ${y}`;

// Ember motes released while the bonfire burns: each loops its own rise cycle (offset phases,
// incommensurate periods) with a gentle loopNoise side-to-side wander. Fixed count: fixed hooks.
type EmberCfg = { dx: number; ph: number; period: number; rise: number; r: number; sx: NoiseSeed };
const EMBERS: EmberCfg[] = [
  { dx: -26, ph: 0.0, period: 6.4, rise: 132, r: 2.5, sx: makeSeed(4.2, 8.8, 1.3, 9.7) },
  { dx: 16, ph: 0.37, period: 7.9, rise: 150, r: 2.1, sx: makeSeed(9.1, 3.4, 1.4, 11.3) },
  { dx: 34, ph: 0.71, period: 5.7, rise: 108, r: 1.7, sx: makeSeed(2.7, 12.6, 1.3, 8.9) },
];

function EmberMote({
  clock, lit, x0, y0, cfg, still,
}: { clock: SharedValue<number>; lit: SharedValue<number>; x0: number; y0: number; cfg: EmberCfg; still: boolean }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const c = (t / cfg.period + cfg.ph) % 1; // 0 at the seat, 1 fully risen
    // Quick fade-in leaving the fire, slow fade-out near the top of the rise.
    let fade = Math.min(c * 5, (1 - c) * 2.2);
    fade = fade < 0 ? 0 : fade > 1 ? 1 : fade;
    return {
      opacity: still ? 0 : fade * 0.9 * lit.value, // reduced motion: no frozen dots, hide entirely
      transform: [
        { translateX: x0 + loopNoiseSigned(t, cfg.sx, 18) },
        { translateY: y0 - c * cfg.rise },
      ],
    };
  }, [x0, y0, still]);
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={cfg.r * 2.4} fill="url(#bfsEmber)" />
      <Circle cx={0} cy={0} r={cfg.r * 0.9} fill="#FFD9A0" />
    </AnimatedG>
  );
}

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

  // Anchor the ground to the structure: the pyre stands ON a near foreground plane whose crest
  // sits just under the structure base. Everything else (hills, trees, glow) is distant.
  const hasAnchor = measured && typeof anchorY === 'number';
  const seatY = hasAnchor ? (anchorY as number) : H * 0.7;
  const ax = measured && typeof anchorX === 'number' ? anchorX : W * 0.5;
  const structureBottom = seatY - skin.origin * 180 + 180;

  // Foreground land band: full width, cresting at (ax, structureBottom - 10) and easing down
  // ~26px toward both screen edges, filled to the bottom of the screen. Unmeasured fallback
  // composition puts the crest at ~0.78H so the default stack still reads correctly.
  const foreCrest = clamp(hasAnchor ? structureBottom - 10 : H * 0.78, H * 0.64, H * 0.88);
  const foreEdge = foreCrest + 26;
  const foreTopEdge =
    `M0 ${foreEdge}` +
    ` C${ax * 0.42} ${foreEdge} ${ax * 0.62} ${foreCrest} ${ax} ${foreCrest}` +
    ` C${ax + (W - ax) * 0.38} ${foreCrest} ${ax + (W - ax) * 0.58} ${foreEdge} ${W} ${foreEdge}`;

  // Distant rolling hills reference line: the hills' lowest silhouette point is fieldTop + 12,
  // held at least 25px ABOVE the foreground crest so the hills read far away and never cut
  // through the pyre standing on the near plane.
  const fieldTop = foreCrest - 37;

  // The amber-rose horizon band hugs the hill line; everything above stays plum-dark for tiles.
  const bandBot = clamp(fieldTop / H, 0.66, 0.86);
  const bandTop = bandBot - 0.08;

  // Lit progress: 0 bright dusk, 1 flame owns the scene. Mounting already-active jumps straight
  // to the lit state (no ignition replay); edges tween 600ms in, 700ms out.
  const litP = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) { litP.value = active ? 1 : 0; return; }
    litP.value = withTiming(active ? 1 : 0, { duration: active ? 600 : 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  // Ember clock (shared gated clock: registered + paused while gated off). The motes only exist
  // while lit, so `active` gates motion too (same pattern as BeaconScene's firefly clock).
  const { clock } = useGatedClock(active && focused && !reduce);
  useEffect(() => () => { cancelAnimation(litP); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dimProps = useAnimatedProps(() => ({ opacity: litP.value * 0.22 }));
  const coolProps = useAnimatedProps(() => ({ opacity: litP.value * 0.5 }));

  const emberY = seatY - 10;
  const coolY = bandTop * H - 12;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          {/* Poster dusk: violet holds through the tile band, warmth only below ~62%. */}
          <LinearGradient id="bfsSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#2E2350" />
            <Stop offset={clamp(bandTop - 0.3, 0.2, 1)} stopColor="#43285A" />
            <Stop offset={bandTop - 0.12} stopColor="#5A2E63" />
            <Stop offset={bandTop - 0.035} stopColor="#9C4756" />
            <Stop offset={bandTop} stopColor="#E86A4A" />
            <Stop offset={bandBot} stopColor="#FFB067" />
            <Stop offset={clamp(bandBot + 0.06, 0, 1)} stopColor="#F09A5C" />
          </LinearGradient>
          {/* Lit-state overlay that cools the horizon glow toward rose. */}
          <LinearGradient id="bfsCool" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#5A2E63" stopOpacity={0} />
            <Stop offset={0.5} stopColor="#A85568" stopOpacity={0.7} />
            <Stop offset={1} stopColor="#C77E62" stopOpacity={0.85} />
          </LinearGradient>
          <RadialGradient id="bfsAfter" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC98A" stopOpacity={0.5} />
            <Stop offset="60%" stopColor="#FFB067" stopOpacity={0.18} />
            <Stop offset="100%" stopColor="#FFB067" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bfsEmber" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFC97A" stopOpacity={0.9} />
            <Stop offset="60%" stopColor="#FF8A3C" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#FF8A3C" stopOpacity={0} />
          </RadialGradient>
          {/* contact shadow under the pyre base: black fading to nothing, a shadow, not a glow */}
          <RadialGradient id="bfsShadow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.35} />
            <Stop offset="55%" stopColor="#000" stopOpacity={0.16} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: darken the status area and the button row, leave the dusk between. */}
          <LinearGradient id="bfsScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill="url(#bfsSky)" />

        {/* soft sun afterglow pooled on the horizon behind the pyre */}
        <Ellipse cx={ax} cy={fieldTop} rx={W * 0.55} ry={H * 0.1} fill="url(#bfsAfter)" />

        {/* horizon band cooling overlay (fades in while lit) */}
        <AnimatedRect animatedProps={coolProps} x={0} y={coolY} width={W} height={fieldTop - coolY + 4} fill="url(#bfsCool)" />

        {STARS.map((st, i) => (
          <Circle key={`bfs${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#FFF3DE" opacity={st.o} />
        ))}
        {BIRDS.map((b, i) => (
          <Path key={`bfb${i}`} d={birdPath(W * b.x, H * b.y, b.s)} stroke="#1A1335" strokeWidth={1.6} fill="none" opacity={0.7} />
        ))}

        {/* far treeline ridge, slightly lifted so the glow rims it */}
        <Path
          d={`M0 ${fieldTop - 6} Q${W * 0.14} ${fieldTop - 22} ${W * 0.3} ${fieldTop - 10} T${W * 0.56} ${fieldTop - 16} T${W * 0.82} ${fieldTop - 6} T${W * 1.02} ${fieldTop - 14} L${W} ${H} L0 ${H} Z`}
          fill="#1D1533"
        />
        {/* little tree clusters on the far ridge, kept clear of the pyre at center */}
        {[
          { cx: W * 0.1, s: 7 }, { cx: W * 0.17, s: 9 }, { cx: W * 0.8, s: 8 }, { cx: W * 0.88, s: 6 },
        ].map((tr, i) => (
          <Path
            key={`bft${i}`}
            d={`M${tr.cx - tr.s} ${fieldTop - 8} L${tr.cx} ${fieldTop - 8 - tr.s * 2.2} L${tr.cx + tr.s} ${fieldTop - 8} Z`}
            fill="#1D1533"
          />
        ))}
        {/* distant rolling hills: their lowest dip (fieldTop + 12) stays 25px above the
            foreground crest, so they read as far scenery behind the pyre, never through it */}
        <Path
          d={`M0 ${fieldTop + 12} Q${W * 0.22} ${fieldTop - 8} ${W * 0.46} ${fieldTop + 6} T${W * 0.8} ${fieldTop + 2} T${W * 1.04} ${fieldTop + 10} L${W} ${H} L0 ${H} Z`}
          fill="#140F22"
        />

        {/* FOREGROUND land plane the pyre stands on: full-width band, near-black warm earth,
            cresting under the structure base and easing down toward both edges (static) */}
        <Path d={`${foreTopEdge} L${W} ${H} L0 ${H} Z`} fill="#100B1E" />
        {/* dusk rim light along the ground edge: backlit land tying the plane to the sky */}
        <Path d={foreTopEdge} stroke="#D99055" strokeWidth={1.5} fill="none" opacity={0.25} />
        {/* soft elliptical contact shadow pinning the pyre base to the foreground plane */}
        <Ellipse cx={ax} cy={structureBottom - 6} rx={72} ry={11} fill="url(#bfsShadow)" />

        {/* lit: the sky steps back so the flame owns the scene */}
        <AnimatedRect animatedProps={dimProps} x={0} y={0} width={W} height={H} fill="#0F0A1E" />

        {/* warm ember motes drifting up off the blaze (above the dim, under the scrim) */}
        {EMBERS.map((cfg, i) => (
          <EmberMote key={`bfe${i}`} clock={clock} lit={litP} x0={ax + cfg.dx} y0={emberY} cfg={cfg} still={reduce} />
        ))}

        <Rect x={0} y={0} width={W} height={H} fill="url(#bfsScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
