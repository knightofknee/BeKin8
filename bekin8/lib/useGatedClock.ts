// lib/useGatedClock.ts
// Shared seconds clock for the beacon layers. Two-layer gating:
//  1. The frame callback is ALWAYS REGISTERED with autostart, and the worklet no-ops unless the
//     `motion` shared value is 1. This is the pattern that fixed the frozen-flame cold-mount /
//     skin-switch bug (start/stop registration was unreliable); do not replace it.
//  2. setActive(motionOn) ALSO pauses the callback while gated, so an idle layer does not hold the
//     reanimated UI-thread frame loop awake every vsync (2-3 of these per skin would otherwise wake
//     the UI thread 60-120x/s for the app's whole foreground lifetime, and can pin ProMotion
//     displays at a high refresh tier). If setActive ever misbehaves, the worst case is the old
//     harmless no-op loop, never a frozen flame: the worklet gate stays as the fallback.
import { useCallback, useEffect } from 'react';
import { useSharedValue, useFrameCallback, type SharedValue } from 'react-native-reanimated';

export function useGatedClock(motionOn: boolean): { clock: SharedValue<number>; motion: SharedValue<number> } {
  const clock = useSharedValue(0);
  const motion = useSharedValue(motionOn ? 1 : 0);
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    if (motion.value === 0) return;
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fc = useFrameCallback(tick, true);
  useEffect(() => {
    motion.value = motionOn ? 1 : 0;
    fc.setActive(motionOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOn]);
  return { clock, motion };
}
