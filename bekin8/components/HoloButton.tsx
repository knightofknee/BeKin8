// components/HoloButton.tsx
// A holographic call-to-action: an iridescent foil gradient that slowly sweeps across the button,
// with a bright sheen band riding over it. Skia draws it (same stack as the beacon effects); the
// sweep is a reanimated loop feeding the gradient's start/end points. Reduce Motion holds it still.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { press } from '../utils/haptics';

const FOIL = ['#7CF7FF', '#A99BFF', '#FF92DA', '#FFE58A', '#8CFFC1', '#7CF7FF'];
const SHEEN = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'];

type Props = {
  label: string;
  sublabel?: string;
  onPress: () => void;
  /** Quieter foil for a secondary state (e.g. "You voted"). */
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export default function HoloButton({ label, sublabel, onPress, muted = false, style, accessibilityLabel }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduce = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      t.value = 0.35;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const R = 16;
  // Foil: a diagonal gradient whose axis slides across (and past) the button and back.
  const foilStart = useDerivedValue(() => vec(-size.w * 0.6 + t.value * size.w * 1.2, 0));
  const foilEnd = useDerivedValue(() => vec(size.w * 0.4 + t.value * size.w * 1.2, size.h));
  // Sheen: a narrow white band crossing in the opposite direction, so the surface "catches light".
  const sheenStart = useDerivedValue(() => vec(size.w * (1.1 - t.value * 1.4), 0));
  const sheenEnd = useDerivedValue(() => vec(size.w * (1.35 - t.value * 1.4), size.h));

  return (
    <Pressable
      onPress={() => { press(); onPress(); }}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={({ pressed }) => [styles.btn, style, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {size.w > 0 && (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <RoundedRect x={0} y={0} width={size.w} height={size.h} r={R} opacity={muted ? 0.55 : 1}>
            <LinearGradient start={foilStart} end={foilEnd} colors={FOIL} />
          </RoundedRect>
          <RoundedRect x={0} y={0} width={size.w} height={size.h} r={R} opacity={muted ? 0.4 : 0.85}>
            <LinearGradient start={sheenStart} end={sheenEnd} colors={SHEEN} />
          </RoundedRect>
        </Canvas>
      )}
      <View style={styles.content} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {sublabel ? <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 16,
    minHeight: 48,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#B69CFF',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    justifyContent: 'center',
  },
  content: { paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  label: { color: '#1B1433', fontSize: 16, fontWeight: '900', letterSpacing: 0.2 },
  sublabel: { color: '#3B3060', fontSize: 12, fontWeight: '700', marginTop: 1 },
});
