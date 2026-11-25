// components/structures/BeaconPyre.tsx
// The "The Beacons" skin STRUCTURE: your own MOUNTAIN SIGNAL PYRE, painted. A crib stack of cut
// logs packed with kindling on a dry-stone platform (art/in/beacons-main.png, processed by
// art/build_beacons.py). Two paintings of the same pyre are stacked: the cold moonlit one always,
// and the firelit one fading in over it while lit. The real flame is the Skia fire layer.
// FLAME SEAT: registry origin 0.54, so the open top of the crib sits at y=43 of the 0..100 box and
// the flame nests in the kindling instead of perching on a flat crown. 180x180 footprint.
import React, { useEffect } from 'react';
import Svg, { Ellipse, G, Image as SvgImage } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { BEACONS_MAIN, BEACONS_MAIN_ASPECT, BEACONS_MAIN_LIT } from '../scenes/beaconsArt';

const AnimatedG = Animated.createAnimatedComponent(G);

// The painting inside the 0..100 box: top of the crib at TOP, platform foot at FOOT.
const TOP = 43;
const FOOT = 94;
const PH = FOOT - TOP;
const PW = PH * BEACONS_MAIN_ASPECT;
const PX = 50 - PW / 2;

export default function BeaconPyre({ size = 180, lit = false, focused = true }: { size?: number; lit?: boolean; focused?: boolean }) {
  const reduce = useReducedMotion();
  const warm = useSharedValue(lit ? 1 : 0);

  useEffect(() => {
    // Blur acts like reduced motion: skip the crossfade and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(warm);
    if (lit) {
      warm.value = still ? 1 : withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) });
    } else {
      warm.value = still ? 0 : withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(warm); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const warmProps = useAnimatedProps(() => ({ opacity: warm.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* contact shadow on the rock */}
      <Ellipse cx="50" cy={FOOT - 0.5} rx={PW * 0.52} ry="3" fill="#03060C" opacity={0.55} />
      <SvgImage x={PX} y={TOP} width={PW} height={PH} href={BEACONS_MAIN} preserveAspectRatio="none" />
      <AnimatedG animatedProps={warmProps}>
        <SvgImage x={PX} y={TOP} width={PW} height={PH} href={BEACONS_MAIN_LIT} preserveAspectRatio="none" />
      </AnimatedG>
    </Svg>
  );
}
