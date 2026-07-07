// components/BeaconSkyLanterns.tsx
// The SKY LANTERNS beacon's behind-the-tiles layer: after your khom loi releases from the dock,
// the whole city answers. One Skia fragment shader draws (a) the HERO lantern, the very one the
// structure just let go, rising from the anchor with the research's jellyfish motion, and (b) the
// FIELD: hundreds of distant lanterns as cell-hashed warm flickering dots drifting the same
// diagonal (up + wind toward +x), far layer slowest, exactly the "slow-motion constellation" /
// "diagonal river of dots" the Yi Peng accounts describe. Everything is a pure function of u_time
// (BeaconFireworks discipline: hashed per-cell traits, constant loop bounds, no JS particle state).
// TIMING CONTRACT (registry origin 0.40 + LanternStand + the ignite clip + this file all agree):
// from the REAL unlit-to-lit edge (t=0, the gated clock is zeroed) the structure runs its 3.2s
// one-shot (pot catches 0-0.4, shell swells 0.4-2.4, tug 2.4-2.8, release 2.8-3.2). The HERO
// appears here at u_time 3.0 rising from EXACTLY (anchorX, anchorY), the lantern body center the
// structure just vacated, at a similar ~20px size and warm paper tone, so the handoff reads as one
// continuous object. It accelerates for ~2s, settles into a steady climb with one fixed wind
// direction (+x, shared with the field), sways and bobs on two incommensurate sines plus a little
// value-noise wander, shrinks to a ~3px flickering dot over ~16s, and dissolves into the field
// (time fade 14.5-17s plus a top-edge height fade). The FIELD ramps in over ~6s of u_time, the
// city answering the release. The ignite clip's beats sit under the same clock: match strike 0,
// paper flutter 0.4-2.4, hush 2.4-2.8, lift puff + distant pop 2.8-3.4, far gong 3.5.
// HERO ARMING (u_hero): the hero exists ONLY when armed by a real unlit-to-lit edge (prevActive
// ref). A cold mount while already lit does NOT zero-and-replay: the clock starts at
// FIELD_SETTLED_T (past the ramp) and u_hero stays 0, so the sky simply already has its field.
// There is no audio re-anchor contract here: the crackle loop is the default seamless
// random-window mode, so refocus/foreground resume mid-field is correct and cheap.
// LEGIBILITY (standing rules): the field lives in the SKY ONLY, fading to zero at u_horizon
// (SKY_LANTERN_HORIZON_FRAC of the screen height, the SAME constant the scene builds its far bank
// from; the scene owns all water reflections below it). Final fragment alpha is capped at 0.5
// (below the fireworks' 0.6: this is an ambient drift, not a show), and a gentle linear top fade
// keeps the status area readable. No radial glow balls: every lantern is a tight exp point/teardrop
// falloff, the sky stays black between them.
// BUDGET: 3 field layers = 3 cell lookups (a few hashes + one exp each) per fragment; the hero is
// a single analytic teardrop + glow point paid only inside its bounding-box cull during its 3-17.5s
// window. No fbm, no per-fragment loops over particles.
// REDUCED MOTION: u_static 1 = a sparse static field, no hero, no drift, no flicker.
// NATIVE: needs a dev/EAS rebuild, Skia is a native module.
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
import { SKY_LANTERN_HORIZON_FRAC } from './scenes/SkyLanternScene';

// A cold mount while already lit starts the clock here: past the 6s field ramp and past the hero
// window, so the sky opens on the settled field (no replayed release, no phantom hero).
const FIELD_SETTLED_T = 60;

const LANTERNS_SKSL = `
uniform float u_time;    // seconds since the real lit edge (or FIELD_SETTLED_T on cold-lit mounts)
uniform float u_act;     // 0..1 lit-fade
uniform float u_hero;    // 1 only when a real unlit-to-lit edge armed the hero release
uniform float u_density; // per-skin field intensity
uniform vec2  u_origin;  // the lantern body center the structure vacated (page px)
uniform float u_horizon; // the scene's water line (px): the field exists in the sky only
uniform float u_w;       // screen width (px)
uniform float u_h;       // screen height (px)
uniform float u_static;  // 1 = reduced motion: sparse static field, no hero, no drift

const float HERO_T0   = 3.0;  // hero appears as the structure's 3.2s release finishes
const float HERO_LIFE = 17.0; // past the 14.5-17.0 dissolve; outside it the hero costs nothing
const float HERO_VY   = 30.0; // steady climb (px/s) after the ~2s acceleration
const float HERO_WIND = 12.0; // lateral wind drift (px/s), +x, the SAME direction the field drifts

float hash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

half4 main(vec2 fragCoord){
  // FIELD IS SKY ONLY: the drifting field dies approaching the scene's water line (the scene owns
  // the river's reflections). The HERO is exempt: it is born at the anchor, which sits at dock
  // height, at or below the horizon on tall screens; masking it broke the u_time 3.0 release
  // handoff (the structure's lantern faded out and nothing took over). The hero carries its own
  // pop-in, dissolve, and top-edge fades instead.
  float sky = 1.0 - smoothstep(u_horizon - 26.0, u_horizon, fragCoord.y);

  vec3  rgb  = vec3(0.0);
  float aTot = 0.0;

  // The city answers over ~6s from the release; a settled clock (cold-lit mount) opens at 1.
  float ramp = u_static > 0.5 ? 1.0 : smoothstep(0.0, 6.0, u_time);

  // ===== THE FIELD: 3 depth layers of cell-hashed drifting lanterns. Each fragment touches one
  // cell per layer: presence hash (~40% occupancy), hashed size / tone / flicker phase, and ALL
  // cells drift the same diagonal (up + wind +x), far slowest, real khom loi taking minutes to
  // cross a sky. Positions stay 0.2..0.8 inside the cell so a dot's glow never leaks past the
  // single-cell lookup. Below the horizon (sky ~ 0) the whole loop is skipped. =====
  if (sky > 0.003){
  for (int L = 0; L < 3; L++){
    float cell = L == 0 ? 44.0 : (L == 1 ? 62.0 : 88.0);
    vec2  vel  = L == 0 ? vec2(3.5, -4.7) : (L == 1 ? vec2(5.5, -7.4) : vec2(8.5, -11.3));
    float sz   = L == 0 ? 1.5 : (L == 1 ? 3.0 : 5.5);
    float bri  = L == 0 ? 0.5 : (L == 1 ? 0.75 : 1.0);
    float t    = u_static > 0.5 ? 0.0 : u_time;
    vec2  gp   = (fragCoord - vel * t) / cell;
    vec2  id   = floor(gp);
    float h    = hash(id + vec2(float(L) * 17.3, float(L) * 9.1));
    float occ  = u_static > 0.5 ? 0.18 : 0.4;   // reduced motion: sparse static field
    if (h < occ){
      float h2  = hash(id + vec2(31.7 + float(L) * 3.0, 57.3));
      vec2  pos = (id + vec2(0.2) + 0.6 * vec2(fract(h * 7.31), fract(h * 13.77))) * cell + vel * t;
      float s   = sz * (0.7 + 0.6 * h2);
      // candle flicker: two hash-phased sines multiplied, subtle, never a strobe
      float fl  = u_static > 0.5
        ? 0.85
        : 0.78 + 0.22 * sin(u_time * (1.6 + h * 2.4) + h * 40.0) * sin(u_time * (2.3 + h2 * 1.9) + h2 * 40.0);
      vec2  d   = fragCoord - pos;
      float g   = exp(-dot(d, d) / (s * s * 2.0));
      // warm candle amber, a little orange-to-gold variation per cell
      vec3  col = mix(vec3(1.0, 0.52, 0.18), vec3(1.0, 0.8, 0.42), h2);
      float a   = g * fl * bri * ramp * sky;
      rgb  += col * a;
      aTot += a;
    }
  }
  }

  // ===== THE HERO: the released lantern itself. Analytic single glow point (the fuel cell at the
  // mouth) + a soft teardrop paper body, alive only inside its time window and bounding box. =====
  if (u_hero > 0.5 && u_static < 0.5){
    float tt = u_time - HERO_T0;
    if (tt > 0.0 && tt < HERO_LIFE){
      // jellyfish rise: accelerate ~2s (quadratic, velocity continuous at the join), then steady
      float rise = tt < 2.0 ? HERO_VY * 0.25 * tt * tt : HERO_VY * (tt - 1.0);
      // wind drift ramps in with time constant 2s: integral of HERO_WIND * (1 - exp(-t/2))
      float xd   = HERO_WIND * (tt - 2.0 + 2.0 * exp(-tt * 0.5));
      // sway + bob: two incommensurate sines each, plus a little value-noise wander
      float swx  = 6.0 * sin(tt * 0.9) + 3.5 * sin(tt * 1.7 + 1.3) + 3.0 * (vnoise(vec2(tt * 0.5, 3.7)) - 0.5);
      float swy  = 2.5 * sin(tt * 1.3 + 0.7) + 1.5 * sin(tt * 2.9);
      vec2  hp   = vec2(u_origin.x + xd + swx * min(tt * 0.5, 1.0), u_origin.y - rise + swy);
      // ~20px lantern at the handoff shrinking to a ~3px dot as it joins the field
      float hs   = mix(10.0, 1.6, smoothstep(0.0, 16.0, tt));
      // fades: pop in over 0.4s, dissolve into the field over 14.5-17s, die at the top edge
      float hf   = smoothstep(0.0, 0.4, tt) * (1.0 - smoothstep(14.5, 17.0, tt));
      hf *= smoothstep(-20.0, 60.0, hp.y);
      float hfl  = 0.8 + 0.2 * sin(u_time * 11.0) * sin(u_time * 17.3 + 1.1);
      // bounding-box cull: all hero math is paid only near the lantern
      if (abs(fragCoord.x - hp.x) < hs * 4.0 + 26.0 && abs(fragCoord.y - hp.y) < hs * 5.0 + 30.0){
        vec2  d    = fragCoord - hp;
        float body = exp(-(d.x * d.x / (0.55 * hs * hs) + d.y * d.y / (1.15 * hs * hs)));
        vec2  dm   = fragCoord - (hp + vec2(0.0, hs * 0.8));
        float pt   = exp(-dot(dm, dm) / (0.35 * hs * hs));
        float a    = (body * 0.5 + pt * 0.85) * hfl * hf;
        rgb  += (vec3(1.0, 0.72, 0.38) * body * 0.5 + vec3(1.0, 0.92, 0.72) * pt * 0.85) * hfl * hf;
        aTot += a;
      }
    }
  }

  // gentle top fade so the status area always reads, then the ambient alpha cap (the sky mask is
  // already baked into the field's per-cell alpha; the hero must survive below the horizon)
  float topFade = mix(0.5, 1.0, smoothstep(0.0, 0.14 * u_h, fragCoord.y));
  rgb  *= u_density * topFade;
  aTot *= u_density * topFade;
  aTot  = min(aTot, 0.5);   // tile-legibility cap: an ambient drift sits below the fireworks' 0.6
  rgb   = min(rgb, vec3(1.0));
  return half4(rgb * u_act, aTot * u_act);
}
`;

const effect = makeShaderEffect(LANTERNS_SKSL, 'BeaconSkyLanterns');

export type BeaconSkyLanternsProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconSkyLanterns({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconSkyLanternsProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Field intensity from the skin's smoke.opacity knob (0.5 -> 1.0, the BeaconFireworks read).
  const density = Math.max(0.5, Math.min(1, skin.smoke.opacity * 2.0));

  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(active);
  const [heroArmed, setHeroArmed] = useState(false);

  // Shared gated clock: the shader only needs to run while lit, focused and motion is allowed.
  const { clock } = useGatedClock(active && !reduce && focused);

  // Clock anchoring (see the header): ZERO on the REAL unlit-to-lit edge only, which also arms
  // the hero; a cold mount while already lit starts settled (field only, no replay). Unlit
  // unmounts after the fade tail. prevActive starts null so the mount pass can tell "born lit"
  // from "just lit". An edge that lands while BLURRED is treated like born-lit (focus read
  // through a ref so the effect still keys on active alone): the structure skips its launch
  // one-shot on blur and settles into the aftermath, so on refocus the sky must open settled
  // with no hero rising from an already-empty stand.
  const prevActive = useRef<boolean | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    if (active) {
      if (was === false && focusedRef.current) {
        // the real edge: the structure's release is running, the hero lifts off at u_time 3.0
        clock.value = 0;
        setHeroArmed(true);
      } else if (was === false) {
        // edge landed while blurred: no launch played, open settled like the born-lit path
        clock.value = FIELD_SETTLED_T;
        setHeroArmed(false);
      } else if (was === null) {
        // born lit: the lantern launched long ago, open on the settled field
        clock.value = FIELD_SETTLED_T;
      }
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(t);
  }, [active, clock]);

  // Lit fade: in fast (the field must be ramping before the 3.0s hero handoff), out with the 1s
  // unmount tail. Reduced motion pins a low-alpha static field.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.4 : 0;
      return;
    }
    if (active) act.value = withTiming(1, { duration: first ? 0 : 350 });
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
      u_hero: heroArmed ? 1 : 0,
      u_density: density,
      u_origin: [anchorX, anchorY],
      u_horizon: H * SKY_LANTERN_HORIZON_FRAC,
      u_w: W,
      u_h: H,
      u_static: reduce ? 1 : 0,
    }),
    [anchorX, anchorY, density, W, H, reduce, heroArmed]
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
