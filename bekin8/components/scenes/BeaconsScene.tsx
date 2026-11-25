// components/scenes/BeaconsScene.tsx
// THE BEACONS backdrop (behind all tiles): the LOTR signal chain on a PAINTED alpine range.
// The mountains are a painting (art/in, processed by art/build_beacons.py into
// assets/images/skins/beacons + beaconsArt.ts); so are the huts and the stacked pyres. Everything
// that moves or changes is drawn here: the fires, their glow, the names, the relay. The painting is
// placed so the foreground rock it paints for your own pyre sits under the structure box
// (anchorX/anchorY).
// HERO: seven beacon piles zigzag up the range on successive ridges. Lighting YOUR beacon lights
// the whole chain (the relay, below), whether or not anyone has answered yet. The piles are then
// LABELED with real people: home passes `people` = the friends going to your lit beacon, in answer
// order, so person i takes pile i, nearest first (earliest answer nearest: history reads front to
// back). A friend who RALLIED burns at least twice as bright. On your lit edge the piles kindle
// IN ORDER, nearest first: the first 3 seconds in, each next one a random 3 to 6 seconds after;
// a new answer while lit FLARES its pile as the name lands. While your beacon is out every pile is
// dark (a static silhouette with a cool rim, no glow). First mount shows the current state steady.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, Ellipse, G, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import { Canvas, Rect as SkRect, Shader } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useDerivedValue,
  withDelay,
  withTiming,
  withSequence,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import { fireEffect, rgb } from '../BeaconFireSkia';
import type { BeaconSkin } from '../../lib/beaconSkins';
import {
  BEACONS_BG,
  BEACONS_BG_ASPECT,
  BEACONS_FLOOR,
  BEACONS_LEDGE,
  BEACONS_SITES,
  BEACONS_SKY,
  type BeaconSite,
} from './beaconsArt';

const AnimatedG = Animated.createAnimatedComponent(G);

const MAX_LABEL = 14;
// Pacing on your lit edge: the relay runs IN ORDER, nearest site first. The first catches
// RELAY_FIRST_MS after ignition; each one after it catches a random RELAY_MIN_MS..RELAY_MAX_MS after
// the one before (each watcher sees the last light, in their own time). A later arrival kindles
// after ARRIVE_MS. Exported so the style preview can time its staged late arrival.
export const RELAY_FIRST_MS = 2250;
export const RELAY_MIN_MS = 3000;
export const RELAY_MAX_MS = 6000;
export const ARRIVE_MS = 250; // first names longer than this get an ellipsis (the far piles are tiny)
const BLOOM = 1.35; // envelope overshoot on kindle; opacity clamps at 1 so it reads as a bright pop

// Flicker seeds, one per chain site (incommensurate periods keep the fires from locking step).
// Must be at least as long as BEACONS_SITES (extras are simply unused).
const SEEDS = [
  makeSeed(2.3, 7.1, 1.4, 5.3),
  makeSeed(5.7, 3.2, 1.3, 6.1),
  makeSeed(9.1, 11.4, 1.5, 6.9),
  makeSeed(4.4, 8.8, 1.4, 5.7),
  makeSeed(12.6, 2.7, 1.3, 7.7),
  makeSeed(7.9, 13.5, 1.5, 8.3),
  makeSeed(3.6, 10.2, 1.4, 8.9),
];
const CHAIN = BEACONS_SITES;
// The painting is drawn this many screen-widths wide (it is cropped at the sides).
const BG_ZOOM = 1.25;

/** A tall leaning flame: base hw wide at (cx, y), tip h above and `lean` to the side. One mass. */
const tallFlame = (cx: number, y: number, hw: number, h: number, lean: number) =>
  `M${cx - hw} ${y} C${cx - hw * 1.35} ${y - h * 0.32} ${cx - hw * 0.3 + lean * 0.4} ${y - h * 0.62} ${cx + lean} ${y - h}` +
  ` C${cx + hw * 0.25 + lean * 0.5} ${y - h * 0.68} ${cx + hw * 1.4} ${y - h * 0.36} ${cx + hw} ${y} Z`;

function shortName(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || '';
  return first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first;
}

/** Where a site's fire sits: s = scale unit (the stack is ~2.3s wide), (px, seat) = flame base. */
function fireSeat(site: BeaconSite, x: number, y: number, w: number, h: number) {
  const s = (site.pyreW * w) / 2.3;
  return { s, px: x + site.fireX * w, seat: y + site.fireY * h + 0.35 * s }; // starts INSIDE the stack
}

// The chain burns THE SAME FIRE as your own pyre (BeaconFireSkia's shader, same colours and
// shape), only smaller because it is farther away. Each fire is one small shader rect on a shared
// canvas; env drives its height, so the relay's kindle and the flare on a new answer still read.
const FLAME_WIDTH = 0.27; // same proportions as the main pyre (skin.flameShape.width)
type ChainFlameProps = {
  env: SharedValue<number>;
  clock: SharedValue<number>;
  skin: BeaconSkin;
  px: number;
  seat: number;
  /** flame height in px */
  fh: number;
  offset: number;
  rally: boolean;
};
function ChainFlame({ env, clock, skin, px, seat, fh, offset, rally }: ChainFlameProps) {
  const c0 = rgb(skin.core[0]);
  const c1 = rgb(skin.mid[0]);
  const c2 = rgb(skin.outer[1]);
  const gl = rgb(skin.glow.center);
  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value + offset,
      u_progress: env.value < 0 ? 0 : env.value,
      u_ignite: 0,
      u_shock: 0,
      u_intensity: rally ? 1.35 : 1.0,
      u_origin: [px, seat],
      u_scale: fh,
      u_width: FLAME_WIDTH,
      u_turb: skin.flameShape.turb,
      u_speed: skin.flameShape.speed,
      u_col0: [c0[0], c0[1], c0[2]],
      u_col1: [c1[0], c1[1], c1[2]],
      u_col2: [c2[0], c2[1], c2[2]],
      u_glow: [gl[0], gl[1], gl[2]],
    }),
    [px, seat, fh, offset, rally, skin.id]
  );
  if (!fireEffect) return null;
  // Bounds: glow reaches ~fh to the sides and below, embers ~2.3 fh up (with the kindle overshoot).
  return (
    <SkRect x={px - fh * 1.3} y={seat - fh * 2.6} width={fh * 2.6} height={fh * 3.6}>
      <Shader source={fireEffect} uniforms={uniforms} />
    </SkRect>
  );
}

type ChainFireProps = {
  env: SharedValue<number>;
  clock: SharedValue<number>;
  motion: SharedValue<number>;
  seed: NoiseSeed;
  site: BeaconSite;
  /** Painted sprite box on screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** This pile's person RALLIED (brought their own friends): it burns at least twice as bright. */
  rally: boolean;
};

// One chain SITE: the hut where that person lives and their signal pyre beside it, both painted
// (dark sprite always; the firelit sprite fades in over it as the pyre catches). The fire itself,
// its glow and the name are drawn here.
function ChainFire({ env, clock, motion, seed, site, x, y, w, h, rally }: ChainFireProps) {
  const props = useAnimatedProps(() => {
    // Organic flicker while motion runs (0.75..1, a hotter steadier 0.9..1 for a rally); the
    // flicker mean when frozen so end states hold perfectly still. env overshoots 1 on a flare;
    // opacity clamps.
    let n = loopNoise(clock.value, seed);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    const lo = rally ? 0.9 : 0.75;
    const flick = motion.value === 1 ? lo + (1 - lo) * n : (1 + lo) / 2;
    const o = env.value * flick;
    return { opacity: o > 1 ? 1 : o };
  });
  // The firelit painting and the name fade in with the fire (no flicker on either).
  const warmProps = useAnimatedProps(() => {
    const o = env.value;
    return { opacity: o > 1 ? 1 : o < 0 ? 0 : o };
  });
  // A second tongue on its own rhythm: the two trade places, so the fire changes SHAPE instead of
  // only dimming like a candle.
  const tongueProps = useAnimatedProps(() => {
    let n = loopNoise(clock.value * 1.37 + 11.3, seed);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    const flick = motion.value === 1 ? 0.35 + 0.65 * n : 0.7;
    const o = env.value * flick;
    return { opacity: o > 1 ? 1 : o };
  });
  const tongue2Props = useAnimatedProps(() => {
    let n = loopNoise(clock.value * 1.83 + 4.7, seed);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    const flick = motion.value === 1 ? 0.25 + 0.75 * n : 0.6;
    const o = env.value * flick;
    return { opacity: o > 1 ? 1 : o };
  });
  const { s, px, seat } = fireSeat(site, x, y, w, h);
  const fh = s * (rally ? 6.4 : 4.8); // a giant fire: it towers over the roof
  return (
    <G>
      <SvgImage x={x} y={y} width={w} height={h} href={site.dark} preserveAspectRatio="none" />
      <AnimatedG animatedProps={warmProps}>
        <SvgImage x={x} y={y} width={w} height={h} href={site.lit} preserveAspectRatio="none" />
      </AnimatedG>
      {fireEffect ? null : (
        <>
      <AnimatedG animatedProps={props}>
        {/* contained glow (a distant fire, never a blob over the tile band) */}
        <Circle cx={px} cy={seat - fh * 0.38} r={s * (rally ? 6 : 4.2)} fill="url(#bcnGlow)" />
        <Path d={tallFlame(px, seat, 1.05 * s, fh, 0.4 * s)} fill="url(#bcnFlame)" />
      </AnimatedG>
      <AnimatedG animatedProps={tongueProps}>
        <Path d={tallFlame(px - 0.3 * s, seat, 0.8 * s, fh * 0.84, -0.7 * s)} fill="url(#bcnFlame)" />
      </AnimatedG>
      <AnimatedG animatedProps={tongue2Props}>
        <Path d={tallFlame(px + 0.4 * s, seat, 0.6 * s, fh * 0.66, 0.75 * s)} fill="url(#bcnFlame)" />
      </AnimatedG>
      <AnimatedG animatedProps={props}>
        <Path d={tallFlame(px, seat, 0.55 * s, fh * 0.5, 0.1 * s)} fill="url(#bcnCore)" />
      </AnimatedG>
        </>
      )}
    </G>
  );
}

/** A person's name under their site; fades in with the fire (no flicker on text). */
function SiteLabel({ env, x, ground, w, label }: { env: SharedValue<number>; x: number; ground: number; w: number; label: string }) {
  const props = useAnimatedProps(() => {
    const o = env.value;
    return { opacity: o > 1 ? 1 : o < 0 ? 0 : o };
  });
  const fontSize = Math.max(8.5, Math.min(12, 6.5 + w * 0.055));
  const ly = ground + fontSize + 3;
  return (
    <AnimatedG animatedProps={props}>
      <SvgText x={x + 0.8} y={ly + 0.8} fontSize={fontSize} fontWeight="700" fill="#000" opacity={0.8} textAnchor="middle">
        {label}
      </SvgText>
      <SvgText x={x} y={ly} fontSize={fontSize} fontWeight="700" fill="#FFE2B8" textAnchor="middle">
        {label}
      </SvgText>
    </AnimatedG>
  );
}

/** A real person on the chain: someone going to your beacon (rally = they rallied their friends). */
export type ScenePerson = { id: string; name: string; rally?: boolean };

export type BeaconsSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  /** Page-relative px of the flame seat inside the 180px structure box. */
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
  /** Who is on the chain, nearest pile first (see the header). Beyond 7, the last pile says "+N". */
  people?: ScenePerson[];
};

export default function BeaconsScene({ skin, active, focused = true, anchorX, anchorY, measured = false, people = [] }: BeaconsSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Who sits on each pile. Past 7 people the last pile stands for everyone left ("+N").
  const n = Math.min(people.length, CHAIN.length);
  const labels = CHAIN.map((_, i) => {
    if (i >= n) return '';
    if (i === CHAIN.length - 1 && people.length > CHAIN.length) return `+${people.length - (CHAIN.length - 1)}`;
    return shortName(people[i].name);
  });

  // Envelope per pile: 1 = burning, 0 = dark pile. EVERY pile burns while your beacon is lit: your
  // signal lights the whole range. People only LABEL piles, nearest first in answer order, so the
  // history of who answered reads front to back. Explicit hooks (never map over hooks, Rules of
  // Hooks); this list must be at least CHAIN.length long (extras are unused).
  const env0 = useSharedValue(active ? 1 : 0);
  const env1 = useSharedValue(active ? 1 : 0);
  const env2 = useSharedValue(active ? 1 : 0);
  const env3 = useSharedValue(active ? 1 : 0);
  const env4 = useSharedValue(active ? 1 : 0);
  const env5 = useSharedValue(active ? 1 : 0);
  const env6 = useSharedValue(active ? 1 : 0);
  const envs = [env0, env1, env2, env3, env4, env5, env6];
  const slotIds = CHAIN.map((_, i) => (i < n ? people[i].id : ''));
  const slotKey = slotIds.join('|');
  const prevActive = useRef(active);
  const prevSlots = useRef(slotIds);
  useEffect(() => {
    const wasActive = prevActive.current;
    const before = prevSlots.current;
    prevActive.current = active;
    prevSlots.current = slotIds;
    if (!active) {
      envs.forEach((e) => { cancelAnimation(e); e.value = reduce ? 0 : withTiming(0, { duration: 600 }); });
      return;
    }
    if (!wasActive) {
      // Your lit edge: the relay, in order. Nothing replays on a first mount that's already lit (wasActive starts as active).
      let at = 0;
      envs.forEach((e, i) => {
        cancelAnimation(e);
        if (reduce) { e.value = 1; return; }
        // In order, nearest first: the first catches RELAY_FIRST_MS in, each one after it a random
        // RELAY_MIN_MS..RELAY_MAX_MS after the one before.
        at += i === 0 ? RELAY_FIRST_MS : RELAY_MIN_MS + Math.random() * (RELAY_MAX_MS - RELAY_MIN_MS);
        e.value = 0;
        e.value = withDelay(
          at,
          withSequence(withTiming(BLOOM, { duration: 220 }), withTiming(1, { duration: 480 }))
        );
      });
      return;
    }
    // Still lit and someone new answered: their (already burning) pile FLARES as their name lands.
    if (reduce) return;
    envs.forEach((e, i) => {
      if (!slotIds[i] || slotIds[i] === before[i]) return;
      cancelAnimation(e);
      e.value = withDelay(
        ARRIVE_MS,
        withSequence(withTiming(BLOOM, { duration: 220 }), withTiming(1, { duration: 600 }))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, slotKey]);

  // Scene clock for the chain flicker (shared gated clock: registered + paused while gated); the
  // chain only burns while your beacon is lit.
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
  // The painting: BG_ZOOM screen-widths wide, placed so the foreground rock it paints for your pyre
  // (BEACONS_LEDGE) lands under the structure. It always covers the full width; above it the sky
  // carries on as flat colour, below it the ground falls away to dark.
  const imgW = W * BG_ZOOM;
  const imgH = imgW / BEACONS_BG_ASPECT;
  const ix = Math.min(0, Math.max(W - imgW, ax - BEACONS_LEDGE.u * imgW));
  const iy = nearTop - BEACONS_LEDGE.v * imgH;

  // Every site's box on screen, far to near (nearer sites overlap farther ones).
  const sites = CHAIN.map((_, k) => {
    const i = CHAIN.length - 1 - k;
    const c = CHAIN[i];
    const w = c.w * imgW;
    const h = w / c.aspect;
    const cx = ix + c.u * imgW;
    const ground = iy + c.v * imgH;
    const x = cx - w / 2;
    const y = ground - h * c.ground;
    const rally = i < n && people[i].rally === true && !(i === CHAIN.length - 1 && people.length > CHAIN.length);
    return { i, c, w, h, cx, ground, x, y, rally, ...fireSeat(c, x, y, w, h) };
  });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <RadialGradient id="bcnGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.outer[0]} stopOpacity={0.9} />
            <Stop offset="60%" stopColor={skin.outer[1]} stopOpacity={0.25} />
            <Stop offset="100%" stopColor={skin.outer[1]} stopOpacity={0} />
          </RadialGradient>
          {/* fire: bright at the wood, deepening to red-orange and thinning out at the tips */}
          <LinearGradient id="bcnFlame" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor={skin.mid[0]} stopOpacity={0.95} />
            <Stop offset="35%" stopColor={skin.outer[1]} stopOpacity={0.92} />
            <Stop offset="78%" stopColor="#F2641E" stopOpacity={0.8} />
            <Stop offset="100%" stopColor="#D8401A" stopOpacity={0.15} />
          </LinearGradient>
          <LinearGradient id="bcnCore" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor="#FFF8DC" stopOpacity={1} />
            <Stop offset="60%" stopColor="#FFE9A8" stopOpacity={0.9} />
            <Stop offset="100%" stopColor="#FFD27A" stopOpacity={0} />
          </LinearGradient>
          <RadialGradient id="bcnLedge" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.38} />
            <Stop offset="55%" stopColor={skin.glow.edge} stopOpacity={0.12} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill={BEACONS_FLOOR} />
        {iy > 0 ? <Rect x={0} y={0} width={W} height={iy + 2} fill={BEACONS_SKY} /> : null}
        <SvgImage x={ix} y={iy} width={imgW} height={imgH} href={BEACONS_BG} preserveAspectRatio="none" />

        <AnimatedG animatedProps={ledgeProps}>
          <Ellipse cx={ax} cy={nearTop + 4} rx={112} ry={42} fill="url(#bcnLedge)" />
        </AnimatedG>

        {/* the chain, far to near so nearer sites overlap farther ones: one site per real person,
            nearest first (see the header) */}
        {sites.map((p) => (
          <ChainFire
            key={`bcnF${p.i}`}
            env={envs[p.i]}
            clock={clock}
            motion={motion}
            seed={SEEDS[p.i]}
            site={p.c}
            x={p.x}
            y={p.y}
            w={p.w}
            h={p.h}
            rally={p.rally}
          />
        ))}
      </Svg>

      {/* the fires: the same shader as your own pyre, one small rect per site */}
      {fireEffect ? (
        <Canvas style={StyleSheet.flatten([styles.fill, { width: W, height: H }])}>
          {sites.map((p) => (
            <ChainFlame
              key={`bcnS${p.i}`}
              env={envs[p.i]}
              clock={clock}
              skin={skin}
              px={p.px}
              seat={p.seat}
              fh={p.s * (p.rally ? 5.2 : 3.9)}
              offset={p.i * 7.3}
              rally={p.rally}
            />
          ))}
        </Canvas>
      ) : null}

      {/* names (over the fires), then the legibility scrim */}
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="bcnScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>
        {sites.map((p) =>
          labels[p.i] ? <SiteLabel key={`bcnL${p.i}`} env={envs[p.i]} x={p.cx} ground={p.ground} w={p.w} label={labels[p.i]} /> : null
        )}
        <Rect x={0} y={0} width={W} height={H} fill="url(#bcnScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
