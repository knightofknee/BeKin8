// components/scenes/StainedGlassScene.tsx
// STAINED GLASS: the whole skin is a STAINED-GLASS WINDOW (its own art style, unlike every illustrated or painted
// skin): the whole screen is one leaded window. Glass is polygons and thick dark lines by nature,
// so here the geometry IS the art instead of something to hide.
//
// The picture is a watchfire in an iron basket on a castle wall, drawn the way a glazier would:
//   - the fire is the HEART of the window: teardrop rings of pale gold, gold, orange and red
//   - every pane outside it lies on rings and spokes radiating from the fire (a sunburst), amber
//     rays alternating with deep-blue and violet night glass, a few pale star panes far out
//   - the basket is dark bronze glass, the wall below is a course of grey masonry panes with
//     merlons rising at the sides
//
// BEHAVIOR (the reason for the style): unlit, there is no light behind the window. You see dull
// grey-blue glass and moonlit lead came: the drawing is all there, dormant. Lighting the beacon
// puts the fire BEHIND the glass: the heart catches first and the light travels outward pane by
// pane (each pane switches on whole, slightly out of step with its neighbors) until the window
// glows. Fire panes then flicker individually. Putting it out drains the light back.
//
// One SkSL shader, drawn in the scene (behind-tiles) slot. The structure box in front of it is an
// empty tap target (structures/GlassWatchfire): the basket and fire it marks are in the glass.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';

const GLASS_SKSL = `
uniform float u_time;   // seconds (fire-pane flicker)
uniform float u_lit;    // 0..1 lit ramp
uniform float u_lt;     // seconds since the lit edge: how far the light has travelled
uniform vec2  u_res;
uniform vec2  u_c;      // basket rim center (px): the flame seat
uniform float u_base;   // bottom of the structure box (px): top of the wall walk

float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

half4 main(vec2 xy) {
  const float TAU = 6.2831853;
  vec2 c = u_c + vec2(0.0, -34.0);          // heart of the fire
  vec2 p = xy - c;
  float dist = length(p);

  // Teardrop metric: rings pinch toward the top and flatten underneath, so the inner rings draw a
  // flame and the outer ones settle into a sunburst.
  float up = clamp(-p.y / 150.0, 0.0, 1.0);
  vec2 q = p.y < 0.0 ? vec2(p.x * (1.0 + 0.9 * up), p.y * 0.66) : vec2(p.x, p.y * 1.3);
  float r = length(q);
  float a = atan(q.y, q.x);

  float rr = pow(r / 20.0, 0.8);
  float ring = floor(rr);
  float fr = fract(rr);
  float n = 5.0 + ring * 3.0;                // panes in this ring
  float off = h1(vec2(ring, 7.0));           // each ring turned a little: joints never line up
  float af = (a / TAU + 0.5) * n + off;
  float spoke = mod(floor(af), n);
  float fa = fract(af);
  float id = h1(vec2(ring * 13.1 + 1.0, spoke * 7.7 + 3.0));

  float r0 = 20.0 * pow(ring, 1.25);
  float r1 = 20.0 * pow(ring + 1.0, 1.25);
  float dR = min(fr, 1.0 - fr) * (r1 - r0);
  float dA = min(fa, 1.0 - fa) * (TAU * max(r, 1.0) / n);
  float d = ring < 0.5 ? (1.0 - fr) * (r1 - r0) : min(dR, dA);   // distance to the nearest came (px)
  float reach = r0;                                             // when the light gets here

  // ---- the wall: masonry panes, merlons at the sides ----
  float wallY = u_base - 4.0;
  float mx = abs(xy.x - u_c.x);
  float merlonTop = wallY - 50.0;
  bool merlon = xy.y > merlonTop && xy.y <= wallY && mx > 100.0 && mod(floor((mx - 100.0) / 46.0), 2.0) < 0.5;
  bool stone = xy.y > wallY || merlon;

  // ---- the iron basket: a bowl narrowing to a stem and a foot ----
  float by = xy.y - (u_c.y - 2.0);
  float bh = max(wallY - (u_c.y - 2.0), 1.0);
  float t = clamp(by / bh, 0.0, 1.0);
  float halfW = mix(42.0, 8.0, smoothstep(0.0, 0.5, t));
  halfW = t > 0.86 ? mix(8.0, 30.0, (t - 0.86) / 0.14) : halfW;
  bool iron = !stone && by > 0.0 && abs(xy.x - u_c.x) < halfW;

  vec3 col;
  float warm = 0.0;     // how much this pane belongs to the fire (drives the flicker)

  if (stone) {
    float row = floor(xy.y / 24.0);
    vec2 b = vec2(xy.x + mod(row, 2.0) * 27.0, xy.y);
    vec2 cell = floor(b / vec2(54.0, 24.0));
    vec2 f = fract(b / vec2(54.0, 24.0));
    d = min(min(f.x, 1.0 - f.x) * 54.0, min(f.y, 1.0 - f.y) * 24.0);
    d = min(d, abs(xy.y - (merlon ? merlonTop : wallY)));
    if (xy.y <= wallY) {
      float edge = mod(mx - 100.0, 46.0);
      d = min(d, min(edge, 46.0 - edge));
    }
    id = h1(cell + 3.0);
    col = mix(vec3(0.30, 0.33, 0.43), vec3(0.47, 0.49, 0.58), id);
    reach = dist;
  } else if (iron) {
    // bands across the bowl + the outline of the basket itself
    float band = by / 15.0;
    d = min(abs(abs(xy.x - u_c.x) - halfW), min(fract(band), 1.0 - fract(band)) * 15.0);
    d = min(d, abs(xy.x - u_c.x) > 3.0 ? abs(mod(xy.x - u_c.x + 200.0, 21.0) - 10.5) : 1.5);
    id = h1(vec2(floor(band), floor((xy.x - u_c.x + 200.0) / 21.0)));
    col = mix(vec3(0.20, 0.15, 0.12), vec3(0.40, 0.27, 0.16), id);
    reach = dist;
  } else {
    // outline of the basket against the glass
    if (by > 0.0 && xy.y <= wallY) d = min(d, abs(abs(xy.x - u_c.x) - halfW));
    d = min(d, abs(xy.y - wallY));
    if (xy.y > merlonTop && mx > 100.0) {
      float edge = mod(mx - 100.0, 46.0);
      d = min(d, min(edge, 46.0 - edge));
      if (mod(floor((mx - 100.0) / 46.0), 2.0) < 0.5) d = min(d, abs(xy.y - merlonTop));
    }

    // The fire stands ON the basket: its rings stop at the rim instead of curling under the bowl
    // (below the rim the same panes are ordinary sunburst glass).
    float fring = by > 0.0 ? max(ring, 4.0) : ring;
    if (ring < 4.0) d = min(d, abs(by));
    if (fring < 1.0)      { col = vec3(1.00, 0.97, 0.80); warm = 1.0; }
    else if (fring < 2.0) { col = mix(vec3(1.00, 0.86, 0.36), vec3(1.00, 0.74, 0.22), id); warm = 1.0; }
    else if (fring < 3.0) { col = mix(vec3(1.00, 0.56, 0.12), vec3(0.98, 0.40, 0.08), id); warm = 1.0; }
    else if (fring < 4.0) { col = mix(vec3(0.86, 0.20, 0.08), vec3(0.70, 0.10, 0.10), id); warm = 0.9; }
    else {
      // The sunburst: panes whose middle falls on a ray carry amber light outward, fading with
      // distance; the rest is night glass in blues and violets, the odd one teal.
      float ac = fract((spoke + 0.5 - off) / n);
      float ray = mod(floor(ac * 14.0), 2.0);
      float rayW = ray * exp(-(max(ring, 4.0) - 4.0) * 0.30);
      vec3 night = mix(vec3(0.07, 0.12, 0.34), vec3(0.20, 0.14, 0.42), id);
      night = mix(night, vec3(0.05, 0.22, 0.36), step(0.8, id) * 0.8);
      vec3 amber = mix(vec3(0.95, 0.62, 0.14), vec3(0.80, 0.30, 0.10), h1(vec2(id, 2.0)));
      col = mix(night, amber, rayW);
      warm = rayW;
      if (id > 0.965 && ring > 6.0) col = vec3(0.95, 0.90, 0.62);   // a star
    }
  }

  // ---- light: nothing behind the glass until the fire is lit, then it spreads pane by pane ----
  float front = u_lt * 300.0;
  float on = u_lit * smoothstep(0.0, 36.0, front - reach - id * 55.0);
  float fall = mix(1.0, 0.34, smoothstep(70.0, 460.0, dist));
  float flick = 1.0 + warm * 0.16 * sin(u_time * (5.0 + id * 7.0) + id * 40.0) + 0.05 * sin(u_time * 0.7 + id * 20.0);
  float tex = 0.86 + 0.14 * smoothstep(0.0, 9.0, d) + 0.06 * (h1(floor(xy * 0.5)) - 0.5);

  vec3 dormant = mix(vec3(dot(col, vec3(0.3, 0.5, 0.2))), col, 0.55) * 0.20;
  vec3 lit = col * fall * flick * tex * 1.05;
  if (stone) lit = col * 0.55 * (0.35 + 0.65 * exp(-dist / 260.0)) * vec3(1.25, 0.92, 0.66);
  if (iron)  lit = col * vec3(1.6, 1.0, 0.6) * tex;
  vec3 outc = mix(dormant, lit, on);

  // lead came: catches the moon by night, goes black against the light
  float lead = smoothstep(1.1, 2.3, d);
  vec3 came = mix(vec3(0.10, 0.115, 0.15), vec3(0.02, 0.02, 0.03), on);
  outc = mix(came, outc, lead);

  // legibility: calm the top (status, tiles) and the bottom (buttons)
  float y = xy.y / u_res.y;
  outc *= 1.0 - 0.55 * smoothstep(0.30, 0.02, y);
  outc *= 1.0 - 0.60 * smoothstep(0.80, 1.0, y);
  return half4(outc, 1.0);
}
`;

const effect = makeShaderEffect(GLASS_SKSL, 'StainedGlassScene');

// u_lt for a window that is already fully lit (cold mount into a lit beacon, reduced motion).
const SETTLED = 30;

export type StainedGlassSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function StainedGlassScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: StainedGlassSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // The flicker clock only runs while there is light behind the glass.
  const { clock } = useGatedClock(focused && !reduce && active);

  const lit = useSharedValue(active ? 1 : 0);
  const lt = useSharedValue(active ? SETTLED : 0);
  const firstRef = useRef(true);
  const prevRef = useRef(active);
  useEffect(() => {
    const first = firstRef.current;
    firstRef.current = false;
    const was = prevRef.current;
    prevRef.current = active;
    cancelAnimation(lit);
    cancelAnimation(lt);
    if (reduce) {
      lit.value = active ? 1 : 0;
      lt.value = active ? SETTLED : 0;
      return;
    }
    if (active) {
      lit.value = withTiming(1, { duration: 250 });
      if (first) {
        lt.value = SETTLED;
      } else if (!was) {
        // fresh light: the front leaves the heart of the fire and crosses the window
        lt.value = 0;
        lt.value = withTiming(SETTLED, { duration: SETTLED * 1000, easing: Easing.linear });
      }
    } else {
      lit.value = withTiming(0, { duration: 900 });
      lt.value = withDelay(950, withTiming(0, { duration: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); cancelAnimation(lt); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cx = measured && anchorX != null ? anchorX : W * 0.5;
  const cy = measured && anchorY != null ? anchorY : H * 0.62;
  const base = Math.min(cy - skin.origin * 180 + 180, H * 0.9);

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_lit: lit.value,
      u_lt: lt.value,
      u_res: [W, H],
      u_c: [cx, cy],
      u_base: base,
    }),
    [W, H, cx, cy, base]
  );

  if (!effect) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]} />;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Canvas style={StyleSheet.flatten([styles.fill, { width: W, height: H }])}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: '#07090F' },
  fill: { position: 'absolute', top: 0, left: 0 },
});
