// components/structures/PaintedSprite.tsx
// The tap target for a PAINTED skin: one painted object in two states stacked in the 180px
// structure box, the cold unlit painting always and the firelit one fading in over it while lit.
// Where it sits (art.top / art.foot on the 0..100 scale, uniform scale, centred) comes from
// art/build_skins.py, and the skin's `origin` must point at its fuel so the flame nests in it.
import React, { useEffect } from 'react';
import Svg, { G, Image as SvgImage } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import type { PaintedArt } from '../scenes/paintedArt';

const AnimatedG = Animated.createAnimatedComponent(G);

type Props = { art: PaintedArt; size?: number; lit?: boolean; focused?: boolean };

export default function PaintedSprite({ art, size = 180, lit = false, focused = true }: Props) {
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

  const ph = art.foot - art.top;
  const pw = ph * art.spriteAspect;
  const px = 50 - pw / 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <SvgImage x={px} y={art.top} width={pw} height={ph} href={art.sprite} preserveAspectRatio="none" />
      <AnimatedG animatedProps={warmProps}>
        <SvgImage x={px} y={art.top} width={pw} height={ph} href={art.spriteLit} preserveAspectRatio="none" />
      </AnimatedG>
    </Svg>
  );
}
