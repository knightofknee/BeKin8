// components/BeaconSmokeSignal.tsx
// The SMOKE SIGNAL beacon's smoke layer: VOLUMETRIC FBM SIGNAL CLOUDS on a telegraph rhythm.
// Each released puff is drawn as what it physically is: a buoyant VORTEX-RING THERMAL, never a
// perfect ball. The silhouette is LUMPY (an FBM sampled on the puff-local unit direction, which
// is seam-free because it never touches atan, modulates the envelope radius +-30%, seeded per
// slot + cycle and slowly evolving with age); the body MUSHROOMS with age (young puffs slightly
// taller than wide at 0.85 x 1.05, roughly round mid-life, old puffs flattened caps at
// 1.30 x 0.80); the UNDERSIDE is ragged and curling (extra noise erosion strengthens toward the
// bottom edge while density biases ~15% toward the upper half, the dense rounded cap of a
// rolling thermal); and for the youngest ~25% of life a thin tapering STEM of the same FBM smoke
// trails from the puff's underside back to the fire anchor, eroded by noise and fully gone by
// age 0.25 as the thermal pinches off. The interior stays a dense near-white VOLUME of the same
// domain-warped multi-octave FBM smoke the campfire's ambient column uses (see BeaconSmokeSkia),
// sampled in PUFF-LOCAL coordinates so the texture scales with the cloud; rim erosion contrast
// is raised so the edges tear turbulently while the core stays thick smoldering-fuel signal
// smoke. A slow internal churn (the local field scrolls upward ~0.25 local units/s and the warp
// seeds drift with age) keeps every cloud alive on the climb.
// TELEGRAPH RHYTHM: a repeating 7s master cycle releases a group of puffs 1.4s apart (at
// 0 / 1.4 / 2.8s into the cycle); ~40% of cycles hash to 2-puff messages (slot 2 sits out) and
// ~30% of releases are short puffs (0.7x life, same total travel), long-short like real signaling.
// REAL SMOKE SPEED: each puff drifts for a 13s LIFE, nearly twice the 7s cycle, so the clouds
// hang and rise slowly instead of sprinting. Because LIFE > CYCLE, each slot renders TWO
// GENERATIONS (the current cycle's puff AND the previous cycle's, still mid-air); without the
// second generation the older cloud would teleport when the slot's cycle counter wraps.
// PERSIST + EXIT: puffs do NOT dissolve mid-air. Opacity ramps in over the first 6% of life,
// holds near 1 until 85%, eases only to 0.85 by end of life, and the cloud EXITS through the top:
// a LINEAR rise (constant ~55px/s: every cloud climbs at the same speed, no fresh puff ever
// sprints past the older one above it, and a message stacks into an even ladder) whose
// total travel is anchor height + 120px, so at age 1.0 the center sits 146px above y=0, more than
// the 96px worst-case visible reach (envelope death 1.15 x max lump 1.3 x exit height factor
// 0.80 x 80px max radius = 95.7px); the slot wraps with no visible pop, for normal and short
// puffs alike. VOLUME SHADING sells the golden hour (the sun just set behind the
// mesas, light comes from LOW): cool violet-grey tops, near-white body, warm sunset underlight on
// the lower edge, plus a stronger fire-warm tint for the youngest ~15% of life. Fully
// u_time-driven and deterministic: no JS-side per-puff state. The skin's REAL flame is a separate
// fire layer at the anchor and the stone fire ring is a drawn structure; this layer draws ONLY the
// smoke. Rendered in home's SMOKE slot, BEHIND the friend tiles (tiles are priority info; puff
// alpha peaks ~0.55 so tiles stay readable, and alpha softens toward a 0.25 floor as the puff
// center climbs through the top 10-30% band of the screen, keeping the header text legible while
// exiting puffs stay clearly visible). NATIVE: needs a dev/EAS rebuild, Skia is a native module.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';
import { makeShaderEffect } from '../lib/makeShaderEffect';
import { useGatedClock } from '../lib/useGatedClock';

// Near-white smoke BODY tint: white signal smoke is mostly water vapor + pale fine particulate.
// The shader's volume shading grades around this base (cool violet-grey tops, warm underside).
const SMOKE_RGB: [number, number, number] = [0.95, 0.94, 0.96];

// Hash/value-noise FBM (NO trig in the noise, a mobile-GPU killer) + one domain-warp pass, the
// same recipe as the campfire's ambient smoke (BeaconSmokeSkia), at 4 octaves for cauliflower
// detail at puff scale. Cost stays sane: every puff evaluation is bounding-distance culled
// BEFORE any noise runs at 1.5R per anisotropy axis (the worst-case reach of the lumpy
// anisotropic envelope: 1.15 envelope death x 1.3 max lump = 1.495) plus a circular corner
// trim, so the 4 FBM calls (1 silhouette lump + 2 warp + 1 body) only execute inside puff
// footprints; the young-puff stem adds 1 FBM inside its own narrow segment-box cull.
const SMOKE_SKSL = `
uniform float u_time;     // seconds since lit
uniform float u_act;      // 0..1 lit-fade
uniform float u_density;  // per-skin intensity multiplier
uniform vec2  u_origin;   // fire anchor (page px); puffs are born just above it
uniform float u_h;        // screen height (px); drives the top-band alpha softening
uniform vec3  u_color;    // near-white smoke BODY tint (volume shading grades tops/underside)

// Telegraph rhythm vs. real smoke speed: the CYCLE (release rhythm) stays a crisp 7s telegraph,
// slot k releasing at the fixed offset k*SPACE (0 / 1.4 / 2.8s), but each puff LIVES 13s, so the
// clouds drift up slowly like real smoke. LIFE > CYCLE means a slot's previous release is still
// mid-air when its next one fires; main() renders two generations per slot to cover it.
const float CYCLE = 7.0;   // master telegraph cycle (s): release rhythm
const float SPACE = 1.4;   // spacing between releases inside a group (s)
const float LIFE  = 13.0;  // full lifetime of one puff (s): smoke is not fast

float hash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++){
    v += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

half4 main(vec2 fragCoord){
  vec3  rgb  = vec3(0.0);
  float aTot = 0.0;

  // 3 telegraph slots x 2 generations = 6 evaluations max. LIFE (13s) > CYCLE (7s), so when a
  // slot's cycle counter wraps its previous release is still mid-air: evaluate BOTH the current
  // cycle's puff (tin in [0, CYCLE)) and the previous cycle's (tin in [CYCLE, 2*CYCLE)), or the
  // older cloud would teleport at the wrap. 2*CYCLE = 14s covers the full 13s life.
  for (int k = 0; k < 3; k++){
    float fk   = float(k);
    float t    = u_time - fk * SPACE;            // fixed per-slot offset: 0 / 1.4 / 2.8 s
    float cyc0 = floor(t / CYCLE);
    for (int g = 0; g < 2; g++){
      float c = cyc0 - float(g);
      if (c < -0.5) continue;                    // no releases from before the beacon was lit
      float tin = t - c * CYCLE;                 // seconds since this release (older gen: 7..14)

      // Pattern variation: ~40% of cycles are 2-puff messages; slot 2 sits those cycles out.
      if (k == 2 && hash(vec2(c + 5.7, 91.3)) < 0.4) continue;

      // Long-short telegraph feel: ~30% of releases are short signals, smaller and shorter-lived
      // (0.7x life). They climb at the SAME shared speed as the big ones and DISSOLVE mid-climb
      // (see the envelope below): a small thermal mixing out early, like real small puffs.
      float rnd     = hash(vec2(fk + 1.7, c + 11.3));
      float isShort = step(rnd, 0.3);
      float sizeMul = mix(1.0, 0.7, isShort);
      float age     = tin / (LIFE * mix(1.0, 0.7, isShort)); // normalized 0..1 over THIS puff's life
      if (age >= 1.0) continue;                  // gone; slot silent until its next generation

      // PERSIST + EXIT rise: LINEAR in TIME (tin, not age), so EVERY cloud climbs at one shared
      // constant speed, (anchorY + 120) / LIFE, ~55px/s typical. The old ease-out made each fresh
      // release sprint past the slower older cloud above it (user: unnatural); age-based linear
      // would still make short puffs 1.43x faster. Constant shared speed also stacks a message
      // into an even ladder (SPACE * velocity ~ 77px between clouds). Normal puffs: at age 1.0
      // (tin = LIFE) the center is at (u_origin.y - 26) - (u_origin.y + 120) = -146px; worst-case
      // visible reach is 1.15 x lumpy radius (max lump 1.3) x exit height factor 0.80 x R max
      // 80px = 95.7px, so they clear the top by ~50px before the generation ends: no pop. Short
      // puffs cannot reach the top in 0.7 LIFE at shared speed; their dissolve handles the wrap.
      float py = (u_origin.y - 26.0) - tin * ((u_origin.y + 120.0) / LIFE);

      // Wind shear: steady drift slightly right (~32px by end of life) + sway that grows with age.
      float jit = (hash(vec2(c + 3.9, fk + 27.1)) - 0.5) * 14.0;
      float px  = u_origin.x + jit + 32.0 * age
                + sin(u_time * 0.4 + fk * 2.4 + c * 1.3) * 12.0 * age;

      // Front-loaded growth: full width by 75% of life, so high puffs hold a stable, readable
      // size on the climb-out instead of thinning away near the top.
      float R  = mix(16.0, 80.0, smoothstep(0.0, 0.75, age)) * sizeMul;

      // THERMAL ANISOTROPY (mushrooming): a rising thermal is never a ball. Young puffs are
      // slightly taller than wide, roughly round through mid-life, old puffs flatten into wide
      // caps as the vortex ring spreads. Smoothly interpolated with age.
      float young = 1.0 - smoothstep(0.10, 0.50, age);
      float old   = smoothstep(0.50, 0.90, age);
      float wFac  = 1.0 - 0.15 * young + 0.30 * old;   // width  0.85 -> 1.00 -> 1.30
      float hFac  = 1.0 + 0.05 * young - 0.20 * old;   // height 1.05 -> 1.00 -> 0.80

      // PERSIST envelope: quick ramp-in (first 6% of life), then HOLD near full, easing only to
      // 0.85 by end of life. A NORMAL puff never dies mid-air; it leaves through the top of the
      // screen. A SHORT puff is a small thermal that mixes out: it dissolves over the last third
      // of its life (fully gone by age 0.96, so its slot wrap can never pop a visible cloud).
      float env = smoothstep(0.0, 0.06, age) * (1.0 - 0.15 * smoothstep(0.85, 1.0, age));
      env *= mix(1.0, 1.0 - smoothstep(0.62, 0.96, age), isShort);

      // Top-band softening for header legibility (this layer is NOT under the scene's scrim):
      // fade toward a 0.25 floor as the puff center climbs from 30% to 10% of screen height, so
      // exiting puffs stay clearly visible without washing out the header text.
      env *= mix(0.25, 1.0, smoothstep(u_h * 0.10, u_h * 0.30, py));
      if (env < 0.004) continue;

      // TRAILING STEM (the release moment): for the youngest ~25% of life a thin tapering wisp
      // of the same FBM smoke trails from the puff's underside back toward the fire anchor,
      // eroded by noise and fully gone by age 0.25 as the thermal pinches off. Its own cheap
      // bounding cull (padded segment box, ZERO noise outside it) confines the extra FBM call
      // to the narrow capsule; the wisp fades before wrap, so it cannot pop either.
      if (age < 0.25) {
        vec2  sB    = vec2(u_origin.x, u_origin.y - 10.0);
        float syTop = py + R * hFac * 0.45;
        if (fragCoord.x > min(px, sB.x) - 22.0 && fragCoord.x < max(px, sB.x) + 22.0 &&
            fragCoord.y > syTop - 4.0 && fragCoord.y < sB.y + 8.0) {
          vec2  sA  = vec2(px, syTop);
          vec2  sAB = sB - sA;
          float sT  = clamp(dot(fragCoord - sA, sAB) / max(dot(sAB, sAB), 1.0), 0.0, 1.0);
          float sD  = length(fragCoord - (sA + sAB * sT));
          float sHf = mix(5.0, 8.0, sT);           // pinched at the puff, fuller near the fire
          if (sD < sHf) {
            float sProf = 1.0 - smoothstep(0.0, sHf, sD);
            float sN    = fbm(vec2(fragCoord.x * 0.09 + fk * 3.7 + c * 5.3,
                                   fragCoord.y * 0.05 - u_time * 1.1));
            float sDen  = smoothstep(0.24, 0.68, sProf * (0.40 + sN * 0.85));
            float sFad  = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.08, 0.25, age));
            vec3  sCol  = mix(u_color, vec3(1.0, 0.66, 0.36), 0.55); // fresh off the fire: warm
            float sa    = clamp(sDen * sFad * 0.45 * u_density, 0.0, 1.0);
            rgb  += sCol * sa * (1.0 - aTot);
            aTot += sa * (1.0 - aTot);
          }
        }
      }

      // Bounding-distance cull before ANY puff noise work, sized to the worst-case reach of the
      // lumpy anisotropic envelope: 1.15 (envelope death) x 1.3 (max lump) = 1.495, so 1.5R per
      // anisotropy axis, plus a circular pre-cull that trims the box corners.
      vec2 d0 = fragCoord - vec2(px, py);
      if (abs(d0.x) > R * 1.5 * wFac) continue;
      if (abs(d0.y) > R * 1.5 * hFac) continue;
      vec2  d1 = vec2(d0.x / wFac, d0.y / hFac);   // anisotropy-corrected puff-local px
      float r1 = length(d1);
      if (r1 > R * 1.5) continue;

      // LUMPY SILHOUETTE: an FBM sampled on the puff-local unit DIRECTION (seam-free, unlike
      // atan whose angle wraps pi to -pi on the left side) modulates the envelope radius +-30%.
      // Seeded per slot + cycle so every puff lumps differently, drifting slowly with age so the
      // billows evolve on the climb. This runs AFTER the bounding cull, so it only pays inside
      // puff footprints.
      vec2  dir   = d1 / max(r1, 1e-4);
      vec2  seedV = vec2(fk * 9.13 + c * 3.71, c * 7.77 - fk * 4.19);
      float lump  = (fbm(dir * 1.4 + seedV + age * 0.7) - 0.5) * 2.0;
      float Reff  = R * (1.0 + 0.30 * lump);

      // VOLUME OF SMOKE, not a drawn blob: puff-local coordinates (q scales with the cloud) for
      // texture and shading, radial envelope measured against the LUMPY radius, full inside 0.55
      // and feathering to 0 by 1.15; the FBM field, masked by that envelope, makes the wispy
      // cottony edges on its own.
      vec2  q    = d1 / R;
      float lr   = r1 / Reff;
      float envR = 1.0 - smoothstep(0.55, 1.15, lr);
      if (envR <= 0.0) continue;
      float yn   = d1.y / Reff;                    // -1 top rim .. +1 bottom rim (lump-relative)

      // Slow internal churn: the local field scrolls upward ~0.25 local units/s (features rise
      // through the cloud), and the warp seeds drift with age so the billows roll as they climb.
      // Same domain-warp recipe as the campfire's ambient smoke, at signal-cloud scale.
      vec2  sp   = (q + vec2(0.0, u_time * 0.25)) * 2.3 + vec2(fk * 7.31, c * 4.7 + fk * 3.1);
      vec2  warp = vec2(fbm(sp + 2.7 + age * 0.5), fbm(sp + 9.1 - age * 0.5));
      float body = fbm(sp + warp * 1.7);

      // VORTEX-RING STRUCTURE, then contrast-shape into a dense band. Three physical cues:
      // 1) the UNDERSIDE is ragged and curling: noise erosion strengthens toward the bottom edge
      //    (warp.y is already an FBM value, reused at zero extra cost);
      // 2) density biases ~15% toward the upper half (1.08 vs 0.92), densest just below the cap
      //    top, the rounded cap of a rolling thermal;
      // 3) rim erosion contrast is raised so edges tear turbulently, while a small core boost
      //    keeps the interior dense and white: thick signal puffs from smoldering damp fuel.
      float under = smoothstep(0.0, 1.0, yn);
      float rim   = smoothstep(0.45, 1.15, lr);
      float vBias = mix(0.92, 1.08, 1.0 - smoothstep(-0.5, 0.7, yn));
      float field = body * vBias * envR + 0.06 * (1.0 - rim)
                  - under * warp.y * 0.5
                  - rim * warp.x * 0.30;
      float dens  = smoothstep(0.16, 0.56, field);
      if (dens < 0.004) continue;

      // VOLUME SHADING, golden hour: the sun just set behind the mesas, so light comes from LOW.
      // q.y is the fragment's height inside the puff (about -1 top rim .. +1 bottom rim, in the
      // anisotropy-corrected local frame): cool violet-grey tops, near-white body, warm sunset
      // underlight creeping up the lower edge.
      float rel = q.y;
      vec3  col = mix(vec3(0.74, 0.72, 0.80), u_color, smoothstep(-0.9, 0.0, rel));
      col = mix(col, vec3(1.0, 0.74, 0.50), 0.45 * smoothstep(0.1, 0.9, rel));

      // Stronger fire-warm tint for the youngest ~15% of life (just left the fire), layered on
      // top of the golden-hour shading, then cooling off as the puff climbs.
      float warm = (1.0 - smoothstep(0.04, 0.15, age)) * 0.6;
      col = mix(col, vec3(1.0, 0.62, 0.32), warm);

      // Peak alpha ~0.55 so the friend tiles in front stay readable.
      float a = clamp(dens * env * 0.55 * u_density, 0.0, 1.0);
      rgb  += col * a * (1.0 - aTot);            // premultiplied "over" accumulate
      aTot += a * (1.0 - aTot);
    }
  }

  return half4(rgb * u_act, aTot * u_act);
}
`;

const effect = makeShaderEffect(SMOKE_SKSL, 'BeaconSmokeSignal');

export type BeaconSmokeSignalProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconSmokeSignal({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconSmokeSignalProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Per-skin puff intensity (from the skin's smoke.opacity knob), normalized to a sane multiplier.
  // No plumes gate here, the smoke signal ALWAYS renders its puffs (its smoke.plumes is 0 only to
  // disable the generic BeaconSmoke layer for this skin).
  const density = Math.max(0.5, Math.min(1, skin.smoke.opacity * 2.0));

  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  // Shared gated clock (see useGatedClock): registered + paused while gated, reliable across
  // cold/skin mounts. The GPU shader still only paints while the Canvas is mounted (visible = lit),
  // so the expensive work hard-stops when unlit; only this counter advances.
  const { clock } = useGatedClock(active && !reduce && focused);

  // Mount only while lit (+ a fade tail) so nothing renders when unlit.
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(t);
  }, [active]);

  // Fade the puffs in/out with the lit state.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.9 : 0;
      return;
    }
    if (active) act.value = withTiming(1, { duration: first ? 0 : 1100 });
    else if (!first) act.value = withTiming(0, { duration: 850 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  useEffect(
    () => () => {
      cancelAnimation(act);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_act: act.value,
      u_density: density,
      u_origin: [anchorX, anchorY],
      u_h: H,
      u_color: [SMOKE_RGB[0], SMOKE_RGB[1], SMOKE_RGB[2]],
    }),
    [anchorX, anchorY, density, H]
  );

  if (!measured || !visible || !effect) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={[styles.fill, { width: W, height: H }]}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
