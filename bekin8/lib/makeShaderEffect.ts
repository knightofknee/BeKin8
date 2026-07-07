// lib/makeShaderEffect.ts
// Native Skia's RuntimeEffect.Make THROWS a JSError on SkSL compile failure (returning null is
// web-only CanvasKit behavior, and this app is mobile-only). Every beacon shader compiles at module
// scope, so an uncaught throw would kill module evaluation of a file home statically imports and
// crash the app at launch. Catch it so callers' existing `if (!effect)` fallbacks actually run and
// a bad shader degrades to a missing visual instead of a dead app.
import { Skia } from '@shopify/react-native-skia';
import type { SkRuntimeEffect } from '@shopify/react-native-skia';

export function makeShaderEffect(sksl: string, tag: string): SkRuntimeEffect | null {
  try {
    return Skia.RuntimeEffect.Make(sksl);
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`${tag}: shader failed to compile`, e);
    }
    return null;
  }
}
