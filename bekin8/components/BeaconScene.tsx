// components/BeaconScene.tsx
// Full-screen BACKDROP behind all tiles (first child of the home page, pointerEvents View wrapper).
// Each skin gets a REAL photographic backdrop (assets/images/skins/<skin>.jpg) under a dark scrim for
// legibility, with the skin's animated accents drawn on top in SVG: fireflies (Campfire), the kindling
// beacon chain (The Beacons), or drifting will-o'-wisps (Will-o'-Wisp). The Lighthouse keeps its
// bespoke animated Skia sea; the "still" skins (Old Guard / Bonfire / Two Lanterns) show photo + scrim
// only. Distant accent lights (GlowDot) reuse the 5 shared cascade `ops`, which kindle one-by-one when
// you light your beacon and dim when you put it out.
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useFrameCallback,
  withDelay,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../lib/beaconNoise';
import BeaconSeaScene from './BeaconSeaScene';
import type { BeaconSkin, BeaconStructureKind } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// Photographic backdrop per skin (the Lighthouse uses the animated Skia sea instead → no image here).
const SKIN_IMAGE: Partial<Record<BeaconStructureKind, number>> = {
  // logs (Campfire) draws a pixel night-forest scene, and tower a drawn night sky, see those branches.
  brazier: require('../assets/images/skins/oldguard.jpg'),
  mountains: require('../assets/images/skins/beacons.jpg'),
  wisp: require('../assets/images/skins/wisp.jpg'),
  // Smoke Signal: a golden-hour ridge/saddle (rocks to sit the fire, open sky for the column).
  smokesignal: require('../assets/images/skins/smokesignal.jpg'),
};

// Bonfire: a real pyre you LIGHT, the unlit (dark, charred) pyre crossfades into the SAME pyre blazing.
const BONFIRE_UNLIT = require('../assets/images/skins/bonfire-unlit.jpg');
const BONFIRE_LIT = require('../assets/images/skins/bonfire-lit.jpg');

// Campfire (default): a real pixel-art moonlit forest CLEARING. Base art is the CC0 parallax forest by
// Luis Zuno (@ansimuz, ansimuz.com), night-tinted via gradient-map and composed into a portrait scene
// (moon, stars, treeline, dark clearing). The pixel campfire (BeaconCampfirePit) sits in front; fireflies
// drift on top. Replaces the old procedural triangle-pine scene.
const CAMPFIRE_BG = require('../assets/images/skins/campfire-bg.png');

// Two Lanterns night sky (no photo): scattered stars over a dark gradient; the crescent moon is drawn
// in the branch. The steeple + its two lanterns are the BeaconTower structure rendered in front.
const TOWER_STARS = [
  { x: 0.12, y: 0.1, r: 1.3, o: 0.8 }, { x: 0.3, y: 0.06, r: 1, o: 0.55 }, { x: 0.46, y: 0.12, r: 1.4, o: 0.85 },
  { x: 0.6, y: 0.05, r: 1, o: 0.5 }, { x: 0.86, y: 0.09, r: 1.2, o: 0.7 }, { x: 0.2, y: 0.22, r: 1, o: 0.5 },
  { x: 0.9, y: 0.19, r: 1.1, o: 0.6 }, { x: 0.55, y: 0.25, r: 1, o: 0.45 }, { x: 0.4, y: 0.3, r: 1.2, o: 0.55 },
];

// Flat dim over a photo backdrop (with the top/bottom scrim gradient) so tiles/text stay legible, the
// rampart photo needs more, the already-dark mountain/swamp less. Bonfire has its own crossfade branch
// and logs/tower/lighthouse are drawn, so only the plain-photo skins are listed.
const SCRIM_DIM: Partial<Record<BeaconStructureKind, number>> = {
  mountains: 0.12, wisp: 0.24, brazier: 0.42, smokesignal: 0.34,
};

// Distant beacon FIRES along the lit ridge of the mountains photo, The Beacons' LOTR chain that kindles
// one-by-one when you light up. Placed on the snow shoulders/saddles just below the peaks (where a
// watcher could actually stand), staggered so the cascade reads as a signal running along the range.
const BEACON_FLAMES = [
  { x: 0.16, y: 0.6 }, { x: 0.33, y: 0.565 }, { x: 0.5, y: 0.53 }, { x: 0.67, y: 0.56 }, { x: 0.84, y: 0.585 },
];
// Will-o'-wisps drifting low over the dark swamp water of the wisp photo.
const WISP_DOTS = [
  { x: 0.3, y: 0.58 }, { x: 0.2, y: 0.67 }, { x: 0.5, y: 0.73 }, { x: 0.7, y: 0.62 }, { x: 0.85, y: 0.7 },
];
function GlowDot({ op, x, y, r, glow, core }: { op: SharedValue<number>; x: number; y: number; r: number; glow: string; core: string }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={x} cy={y} r={r * 2.4} fill={glow} />
      <Circle cx={x} cy={y} r={r} fill={core} />
    </AnimatedG>
  );
}

// A tiny flame glyph (teardrop body + warm glow halo + bright core) for the distant ridge beacons,
// a small signal fire rather than a plain dot. base at (x,y), tip up at ~(x, y - 2.7s).
const flamePath = (x: number, y: number, s: number) =>
  `M${x} ${y} C${x - s} ${y - s * 1.2} ${x - s * 0.5} ${y - s * 2.2} ${x} ${y - s * 2.7} C${x + s * 0.5} ${y - s * 2.2} ${x + s} ${y - s * 1.2} ${x} ${y} Z`;

function RidgeFlame({ op, x, y, s }: { op: SharedValue<number>; x: number; y: number; s: number }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      {/* small, contained glow (not a big light-blob) so the flame SHAPE reads as a tiny fire */}
      <Circle cx={x} cy={y - s * 1.0} r={s * 1.5} fill="url(#scGlow)" />
      <Path d={flamePath(x, y, s)} fill="url(#scFlame)" />
      <Path d={flamePath(x, y - s * 0.15, s * 0.55)} fill="#FFF1C0" />
    </AnimatedG>
  );
}

// Fireflies: a CALMING, soft accent. Each drifts SLOWLY (long-period loopNoise) and is UNLIT far more
// than lit, it glows up gently, occasionally, then fades. With independent long periods the number lit
// at once is mostly 0, sometimes 1, rarely 2. Driven by the scene clock whether or not the beacon is lit.
const FLIES = [
  { x: 0.28, y: 0.52, sx: makeSeed(3.1, 11.4, 1.3, 14.2), sy: makeSeed(7.2, 5.5, 1.4, 12.1), bl: makeSeed(13.7, 2.2, 1.5, 9.4) },
  { x: 0.64, y: 0.46, sx: makeSeed(9.4, 3.7, 1.4, 13.4), sy: makeSeed(2.6, 13.1, 1.3, 15.0), bl: makeSeed(17.3, 6.4, 1.5, 11.7) },
  { x: 0.46, y: 0.6, sx: makeSeed(5.8, 9.2, 1.3, 15.6), sy: makeSeed(11.9, 4.3, 1.4, 12.7), bl: makeSeed(21.1, 1.7, 1.5, 13.3) },
  { x: 0.76, y: 0.55, sx: makeSeed(8.3, 7.1, 1.4, 14.0), sy: makeSeed(4.5, 10.8, 1.3, 13.2), bl: makeSeed(19.6, 8.9, 1.5, 8.6) },
  { x: 0.2, y: 0.58, sx: makeSeed(12.2, 2.9, 1.3, 16.4), sy: makeSeed(6.7, 12.4, 1.4, 12.5), bl: makeSeed(15.4, 4.1, 1.5, 10.8) },
];

function FireflyDot({ clock, x, y, sx, sy, bl }: { clock: SharedValue<number>; x: number; y: number; sx: NoiseSeed; sy: NoiseSeed; bl: NoiseSeed }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    // Blink: lit only in the TOP slice of the noise (≈ top 20%), ramped + squared, so each firefly is
    // dark most of the time and glows softly only now and then. Mode of "how many lit" is 0/1.
    let g = (loopNoise(t, bl) - 0.8) / 0.16;
    g = g < 0 ? 0 : g > 1 ? 1 : g;
    g = g * g;
    return {
      opacity: g,
      transform: [
        { translateX: x + loopNoiseSigned(t, sx, 64) }, // gentle, slow wander (not a wide dart)
        { translateY: y + loopNoiseSigned(t, sy, 80) },
      ],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={4.5} fill="url(#scFly)" />
      <Circle cx={0} cy={0} r={1.5} fill="#FFF6B0" />
    </AnimatedG>
  );
}

export type BeaconSceneProps = { skin: BeaconSkin; active: boolean; focused?: boolean };

export default function BeaconScene({ skin, active, focused = true }: BeaconSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const ops = BEACON_FLAMES.map(() => useSharedValue(0.12));

  useEffect(() => {
    if (active) {
      ops.forEach((o, i) => {
        if (reduce) { o.value = 1; return; }
        // Slow SERIES cascade, each beacon kindles ~650ms after the previous, one by one down the
        // chain (not all at once). Then a gentle idle flicker.
        o.value = withDelay(
          500 + i * 650,
          withSequence(
            withTiming(1, { duration: 520 }),
            withRepeat(withSequence(withTiming(0.72, { duration: 1000 }), withTiming(1, { duration: 1000 })), -1, true)
          )
        );
      });
    } else {
      ops.forEach((o) => { cancelAnimation(o); o.value = reduce ? 0.12 : withTiming(0.12, { duration: 500 }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => ops.forEach((o) => cancelAnimation(o)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scene clock for ambient motion (fireflies). Always registered, gated internally to the forest
  // skin (+ motion allowed) so it costs nothing elsewhere, fireflies drift whether lit or not.
  const clock = useSharedValue(0);
  const fliesOn = useSharedValue(skin.structure === 'logs' && !reduce && focused ? 1 : 0);
  useEffect(() => {
    // gate on `focused` too (like BeaconSeaScene/BeaconFireSkia) so the clock pauses off-tab.
    fliesOn.value = skin.structure === 'logs' && !reduce && focused ? 1 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.structure, reduce, focused]);
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    if (fliesOn.value === 0) return;
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrameCallback(tick, true);
  useEffect(() => () => cancelAnimation(clock), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bonfire: the PHOTO is the beacon, it crossfades from an unlit pyre to the SAME pyre blazing when
  // lit (a real fire you light). litOp drives the lit photo's opacity over the unlit base.
  const litOp = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    litOp.value = reduce ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: 420 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  const litStyle = useAnimatedStyle(() => ({ opacity: litOp.value }));
  useEffect(() => () => cancelAnimation(litOp), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The lighthouse backdrop is its own Skia sea (a separate canvas), not the photo dispatch below.
  if (skin.structure === 'lighthouse') return <BeaconSeaScene active={active} focused={focused} />;

  // Two Lanterns: a DRAWN night sky (no photo), dark gradient + crescent moon + stars + a low town
  // silhouette. The steeple and its two lanterns are the BeaconTower structure rendered in front.
  if (skin.structure === 'tower') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <LinearGradient id="twSky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#070B1A" /><Stop offset="55%" stopColor="#0E1430" /><Stop offset="100%" stopColor="#171D3A" />
            </LinearGradient>
            <RadialGradient id="twMoon" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFF6D8" stopOpacity={0.9} /><Stop offset="55%" stopColor="#E8E4C8" stopOpacity={0.28} /><Stop offset="100%" stopColor="#E8E4C8" stopOpacity={0} /></RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={H} fill="url(#twSky)" />
          {/* crescent moon: soft glow + bright disc with a dark disc offset over it */}
          <Circle cx={W * 0.76} cy={H * 0.12} r={70} fill="url(#twMoon)" />
          <Circle cx={W * 0.76} cy={H * 0.12} r={26} fill="#FBF6E2" />
          <Circle cx={W * 0.72} cy={H * 0.105} r={23} fill="#0B1126" />
          {TOWER_STARS.map((st, i) => (
            <Circle key={`tw${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#FFFFFF" opacity={st.o} />
          ))}
          {/* low town/horizon silhouette so the steeple rises out of something */}
          <Rect x={0} y={H * 0.74} width={W} height={H * 0.26} fill="#080C1C" />
        </Svg>
      </View>
    );
  }

  // Bonfire: a REAL pyre you light. The unlit (dark, charred) pyre is the base; the SAME pyre blazing
  // crossfades in over it when lit. Smoke rises from it (home's BeaconSmoke) toward a smoke-signal feel.
  if (skin.structure === 'bonfire') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Image source={BONFIRE_UNLIT} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        <Animated.View style={[StyleSheet.absoluteFill, litStyle]}>
          <Image source={BONFIRE_LIT} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        </Animated.View>
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <LinearGradient id="bfScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#000" stopOpacity={0.5} /><Stop offset="22%" stopColor="#000" stopOpacity={0.12} /><Stop offset="55%" stopColor="#000" stopOpacity={0} /><Stop offset="82%" stopColor="#000" stopOpacity={0.18} /><Stop offset="100%" stopColor="#000" stopOpacity={0.6} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={H} fill="url(#bfScrim)" />
        </Svg>
      </View>
    );
  }

  // Campfire (default): a real pixel-art moonlit forest CLEARING (CC0 ansimuz art, night-tinted + composed
  // into campfire-bg.png), with calm fireflies drifting on top. The pixel campfire (BeaconCampfirePit) sits
  // in the clearing in front; this is just the backdrop.
  if (skin.structure === 'logs') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
        <Image source={CAMPFIRE_BG} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
          <Defs>
            <RadialGradient id="scFly" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} /></RadialGradient>
          </Defs>
          {/* calm fireflies drifting over the forest */}
          {FLIES.map((f, i) => <FireflyDot key={`fly${i}`} clock={clock} x={W * f.x} y={H * f.y} sx={f.sx} sy={f.sy} bl={f.bl} />)}
        </Svg>
      </View>
    );
  }

  const s = skin.structure;
  const img = SKIN_IMAGE[s];
  if (img == null) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      {/* opaque dark base so the 220ms cross-fade never flashes the (light-theme) page bg through */}
      <Image source={img} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} cachePolicy="memory-disk" />
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          {/* Legibility scrim: darken top (status/tiles) & bottom (buttons), keep the middle clearest. */}
          <LinearGradient id="scScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.58} />
            <Stop offset="20%" stopColor="#000" stopOpacity={0.16} />
            <Stop offset="50%" stopColor="#000" stopOpacity={0} />
            <Stop offset="82%" stopColor="#000" stopOpacity={0.22} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.62} />
          </LinearGradient>
          <RadialGradient id="scGlow" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFC56B" stopOpacity={0.95} /><Stop offset="60%" stopColor="#FF9A3C" stopOpacity={0.25} /><Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} /></RadialGradient>
          <LinearGradient id="scFlame" x1="0" y1="1" x2="0" y2="0"><Stop offset="0%" stopColor="#FFE9A6" /><Stop offset="45%" stopColor="#FFB347" /><Stop offset="100%" stopColor="#FF7A1A" /></LinearGradient>
          <RadialGradient id="scGlowCyan" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#BFFBFF" stopOpacity={0.95} /><Stop offset="55%" stopColor="#3FB8E8" stopOpacity={0.22} /><Stop offset="100%" stopColor="#3FB8E8" stopOpacity={0} /></RadialGradient>
          <RadialGradient id="scFly" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} /></RadialGradient>
        </Defs>

        {/* flat per-skin dim + top/bottom scrim, over the photo */}
        <Rect x={0} y={0} width={W} height={H} fill="#05070C" opacity={SCRIM_DIM[s] ?? 0.3} />
        <Rect x={0} y={0} width={W} height={H} fill="url(#scScrim)" />

        {/* The Beacons, small signal FIRES kindling one-by-one along the ridge (where a watcher stands) */}
        {s === 'mountains' && BEACON_FLAMES.map((d, i) => (
          <RidgeFlame key={`b${i}`} op={ops[i]} x={W * d.x} y={H * d.y} s={6} />
        ))}

        {/* Will-o'-Wisp, drifting cyan swamp lights */}
        {s === 'wisp' && WISP_DOTS.map((d, i) => (
          <GlowDot key={`w${i}`} op={ops[i]} x={W * d.x} y={H * d.y} r={2.6} glow="url(#scGlowCyan)" core="#E6FEFF" />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
