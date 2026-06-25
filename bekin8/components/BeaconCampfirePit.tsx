// components/BeaconCampfirePit.tsx
// The Campfire skin's tappable structure: a pixel-art stone FIRE PIT. Unlit shows the cold pit (stones
// + faint embers); lit shows a looping pixel CAMPFIRE (animated WebP) that grows up out of the pit with
// a quick ignite, and shrinks/fades on extinguish. The fire frames share the pit's stone base, so they
// register exactly. This skin owns its fire (home renders no SVG/Skia flame for 'logs').
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';

const PIT = require('../assets/images/skins/campfire-pit.png');
const FIRE = require('../assets/images/skins/campfire-fire.webp');

export default function BeaconCampfirePit({ lit, size = 180 }: { lit: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const [showFire, setShowFire] = useState(lit); // mount the fire only while lit (+ a short fade tail)
  const op = useSharedValue(lit ? 1 : 0);
  const scale = useSharedValue(lit ? 1 : 0.62);
  const firstRun = useRef(true);

  // Mount/unmount the fire layer (keep it briefly after extinguish so the fade can play).
  useEffect(() => {
    if (lit) {
      setShowFire(true);
      return;
    }
    const t = setTimeout(() => setShowFire(false), 360);
    return () => clearTimeout(t);
  }, [lit]);

  // Ignite (grow up from the pit) / extinguish (shrink + fade).
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (lit) {
      if (reduce || first) {
        op.value = 1;
        scale.value = 1;
      } else {
        op.value = 0;
        scale.value = 0.62;
        op.value = withTiming(1, { duration: 150 });
        scale.value = withSpring(1, { damping: 9, stiffness: 175, mass: 0.7 });
      }
    } else if (!first) {
      op.value = reduce ? 0 : withTiming(0, { duration: 320 });
      scale.value = reduce ? 0.62 : withTiming(0.74, { duration: 320 });
    }
  }, [lit, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelAnimation(op); cancelAnimation(scale); }, []);

  const fireStyle = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ scale: scale.value }] }));

  return (
    <View style={{ width: size, height: size }}>
      <Image source={PIT} style={StyleSheet.absoluteFill} contentFit="contain" />
      {showFire && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fireOrigin, fireStyle]}>
          <Image source={FIRE} style={StyleSheet.absoluteFill} contentFit="contain" />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // the fire grows UP out of the pit, so scale about the bottom-center
  fireOrigin: { transformOrigin: 'center bottom' },
});
