// components/scenes/CastleScene.tsx
// OLD GUARD backdrop (behind all tiles): a painted castle at night (`art`): the curtain wall
// between two merlons. The basket of wood standing on the stone is the structure
// (PaintedSprite); its fire is the app's flame layer. Drawn here: the painting, the firelight that
// washes the stonework when lit, and the ANSWER: about 3 seconds after you light yours, the distant
// watchtower on the hills lights its own (the same fire, tiny). Dark again when you put yours out.
import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Ellipse, Circle, G } from 'react-native-svg';
import { Canvas } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';
import type { PaintedArt } from './paintedArt';
import { PaintedBackdrop, paintedLayout, paintedPoint } from './PaintedBackdrop';
import MiniFlame, { miniFlameAvailable } from './MiniFlame';

const AnimatedG = Animated.createAnimatedComponent(G);

/** The distant tower answers this long after your fire catches. */
const ANSWER_MS = 3000;

export type CastleSceneProps = {
  art: PaintedArt;
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function CastleScene({ art, skin, active, focused = true, anchorX, anchorY, measured = false }: CastleSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const L = paintedLayout(art, skin, W, H, anchorX, anchorY, measured);
  const answer = paintedPoint(L, art.extra.answer ?? { u: 0.85, v: 0.4 });

  // Firelight on the stone, and the answering fire. Both start at the current state so mounting
  // into a lit beacon shows it steady without replaying.
  const lit = useSharedValue(active ? 1 : 0);
  const ans = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    cancelAnimation(lit);
    cancelAnimation(ans);
    if (reduce) { lit.value = active ? 1 : 0; ans.value = active ? 1 : 0; return; }
    if (active) {
      lit.value = withTiming(1, { duration: 700 });
      ans.value = withDelay(ANSWER_MS, withTiming(1, { duration: 900 }));
    } else {
      lit.value = withTiming(0, { duration: 500 });
      ans.value = withTiming(0, { duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); cancelAnimation(ans); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const litProps = useAnimatedProps(() => ({ opacity: lit.value }));
  const ansProps = useAnimatedProps(() => ({ opacity: ans.value }));
  const { clock } = useGatedClock(focused && !reduce && active);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: art.floor }]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <RadialGradient id="csWash" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.34} />
            <Stop offset="50%" stopColor={skin.glow.edge} stopOpacity={0.13} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="csAns" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.75} />
            <Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <PaintedBackdrop art={art} layout={L} W={W} H={H} />
        {/* firelight on the stonework around the basket */}
        <AnimatedG animatedProps={litProps}>
          <Ellipse cx={L.ax} cy={L.footY + 6} rx={W * 0.62} ry={120} fill="url(#csWash)" />
        </AnimatedG>
        {/* the answering fire's glow (the flame itself is on the canvas below) */}
        <AnimatedG animatedProps={ansProps}>
          <Circle cx={answer.x} cy={answer.y - 3} r={15} fill="url(#csAns)" />
          {miniFlameAvailable ? null : <Circle cx={answer.x} cy={answer.y - 3} r={2.4} fill={skin.core[0]} />}
        </AnimatedG>
      </Svg>

      {miniFlameAvailable ? (
        <Canvas style={StyleSheet.flatten([styles.fill, { width: W, height: H }])}>
          <MiniFlame env={ans} clock={clock} skin={skin} x={answer.x} y={answer.y} height={13} offset={5.3} />
        </Canvas>
      ) : null}

      {/* Legibility scrim: darken top (status/tiles) and bottom (buttons), middle stays clear. */}
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="csScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.4} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#csScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
