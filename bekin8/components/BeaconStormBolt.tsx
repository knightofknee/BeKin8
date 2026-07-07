// components/BeaconStormBolt.tsx
// The STORM CALLER's fire-slot layer (full-screen Skia, in FRONT: the bolt must strike the rod
// that stands in front of the tiles): one real lightning strike with research-true flash anatomy,
// rendered by a single shader that is a pure function of u_time (zeroed when the strike arms)
// and u_seed (a fresh random per relight, so every strike forks a different channel).
// ARMING: mounts per skin but renders null until a REAL unlit -> lit edge (prevActive ref).
// First mount while already lit stays null (no phantom replay); reduced motion stays null (the
// thunder carries it). When armed: pick a new seed, zero the gated clock, show for 2.4s, hide.
// TIMING CONTRACT (t = 0 at the tap; StormRod's one-shot + the storm-ignite clip share it):
//   0.30-0.55  STEPPED LEADER: a faint thin channel builds DOWNWARD from above the screen top
//              toward the rod in DISCRETE steps (staircase floor(p * 10) / 10; research: ~50m
//              steps with pauses, scaled to readable speed), dim violet-grey, with 3 downward
//              branch forks, all geometry hashed off u_seed and displaced along y
//   0.52-0.58  a short faint UPWARD STREAMER rises from the rod tip (~8% of screen height: the
//              research's final jump, the rod answering the leader)
//   0.58       ATTACHMENT + RETURN STROKE: the whole channel goes BLINDING (2-3px white core,
//              blue-violet fringe, branches brighter where they join) plus a FULL-SCREEN FLASH
//              (additive white, peak alpha ~0.6, ~90ms decay: the millisecond daylight pop,
//              scaled for readability)
//   0.72/0.92  RESTRIKES: the SAME channel re-pops dimmer (the dart leader re-uses the geometry,
//              no new branches; flash alphas ~0.3/0.2, 50ms decays): the strobe flicker that
//              makes lightning read as lightning
//   ->1.6      continuing-current afterglow fades; fully dark by 2.0; unmount at 2.4
// GEOMETRY: chanX(y) wanders off two piecewise-LINEAR hash zigzags (the repo hash mixed across
// cells WITHOUT the smooth curve: lightning kinks, fbm is too round) whose amplitude grows with
// height above the tip and is exactly 0 at y = anchorY, so the channel meets the rod tip to the
// pixel; below the anchor nothing paints (the structure owns the rod).
// BUDGET: corridor cull: chanX at this fragment's y costs 4 hashes; all channel work is skipped
// when abs(fragX - chanX) > 90px. The full-screen flash term is a flat cheap add. Branches are
// only evaluated inside their own y-window boxes (2 hashes each to test), and only while the
// leader or first stroke is alive. Constant loop bounds (3 branches).
// LEGIBILITY: final fragment alpha capped at 0.75 (the specced 0.6 daylight pop plus the narrow
// channel core; both are sub-100ms strobes, tiles carry their own cards).
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';
import type { BeaconSkin } from '../lib/beaconSkins';
import { makeShaderEffect } from '../lib/makeShaderEffect';
import { useGatedClock } from '../lib/useGatedClock';

const BOLT_SKSL = `
uniform float u_time;   // seconds since the strike armed (0 = the tap)
uniform vec2  u_target; // rod tip px (the anchor: viewBox (50, 14) at origin 0.14)
uniform vec2  u_res;
uniform float u_seed;   // per-strike fork: every relight rolls a new channel

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

// 1D piecewise-LINEAR value noise: the repo hash mixed across cells without the smooth u curve,
// so the channel kinks at cell edges (jagged on purpose).
float zig(float y, float sc, float se){
  float i = floor(y / sc);
  float f = fract(y / sc);
  return mix(hash(vec2(i, se)), hash(vec2(i + 1.0, se)), f) - 0.5;
}

// The channel's x at a given y: wander grows with height above the tip and is exactly zero AT
// the tip, so the bolt meets the rod to the pixel.
float chanX(float y){
  float dy = max(u_target.y - y, 0.0);
  return u_target.x
       + zig(y, 92.0, u_seed) * min(dy * 0.28, 78.0)
       + zig(y, 27.0, u_seed + 4.7) * min(dy * 0.11, 24.0);
}

// Instant-on exponential decay from t0 (return strokes rise in microseconds; only decays show).
float dec(float t, float t0, float k){
  float dt = t - t0;
  return dt < 0.0 ? 0.0 : exp(-dt / k);
}

half4 main(vec2 fc){
  float t = u_time;
  if (t < 0.29 || t > 2.05) { return half4(0.0); }
  float fade = 1.0 - smoothstep(1.55, 2.0, t);

  // full-screen daylight pop + restrike strobes (flat, cheap, everywhere)
  float flashA = 0.6 * dec(t, 0.58, 0.09) + 0.3 * dec(t, 0.72, 0.05) + 0.2 * dec(t, 0.92, 0.05);

  // corridor cull for all channel work
  float cx = chanX(fc.y);
  float dxc = fc.x - cx;
  bool corr = abs(dxc) < 90.0 && fc.y <= u_target.y;

  // shared schedule scalars
  float lp = clamp((t - 0.30) / 0.25, 0.0, 1.0);
  float leadY = mix(-40.0, u_target.y, floor(lp * 10.0) / 10.0); // staircase descent
  bool leadOn = t < 0.58;
  float dec1 = dec(t, 0.58, 0.12); // first return stroke (branches ride only this one)

  // branch y-window pre-test (2 hashes per branch); branches exist only above the tip and only
  // while the leader or the first stroke is alive
  bool branchWin = false;
  if (leadOn || dec1 > 0.004) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ybi = mix(0.10, 0.55, hash(vec2(u_seed + fi * 7.7, 3.1))) * u_target.y;
      float blen = min(mix(0.10, 0.18, hash(vec2(u_seed + fi * 5.1, 1.7))) * u_res.y, u_target.y - 10.0 - ybi);
      if (fc.y >= ybi && fc.y <= ybi + blen) { branchWin = true; }
    }
  }

  if (!corr && flashA < 0.004 && !branchWin) { return half4(0.0); }

  vec3  rgb  = vec3(0.0);
  float aTot = 0.0;

  if (corr) {
    float d2 = dxc * dxc;
    // STEPPED LEADER: faint thin violet-grey channel above the descending front, with a small
    // bright bead at the front itself
    if (leadOn && t >= 0.30) {
      float lm = step(fc.y, leadY);
      float lcore = exp(-d2 / 2.2);
      float lfr = exp(-d2 / 90.0);
      float bdy = fc.y - leadY;
      float bead = exp(-(d2 + bdy * bdy) / 26.0) * 0.5;
      rgb  += vec3(0.52, 0.48, 0.68) * (lcore * 0.7 + lfr * 0.25) * lm + vec3(0.75, 0.72, 0.95) * bead;
      aTot += (lcore * 0.20 + lfr * 0.06) * lm + bead;
    }
    // UPWARD STREAMER answering from the rod tip (0.52-0.58, ~8% of screen height)
    if (t >= 0.52 && t < 0.60) {
      float spf = clamp((t - 0.52) / 0.06, 0.0, 1.0);
      float slen = 0.08 * u_res.y * spf;
      float sm = step(u_target.y - slen, fc.y) * step(fc.y, u_target.y);
      float score = exp(-d2 / 1.8) * sm;
      rgb  += vec3(0.72, 0.70, 1.0) * score * 0.55;
      aTot += score * 0.5;
    }
    // RETURN STROKE + RESTRIKES + CONTINUING CURRENT: blinding white core, blue-violet fringe.
    // The dart leader re-uses the channel, so restrikes light the SAME geometry.
    float chanI = dec1 + 0.45 * dec(t, 0.72, 0.055) + 0.28 * dec(t, 0.92, 0.055)
                + 0.18 * dec(t, 0.58, 0.45);
    if (chanI > 0.003) {
      float core = exp(-d2 / 3.2);
      float fr = exp(-d2 / 320.0);
      rgb  += (vec3(1.0) * core + vec3(0.58, 0.52, 1.0) * fr * 0.55) * chanI;
      aTot += (core + fr * 0.45) * chanI;
    }
  }

  // BRANCH FORKS: 3 short downward chains hashed off u_seed; dim while their stretch of leader
  // exists, bright on the FIRST return stroke only, brighter where they join the channel.
  if (branchWin) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ybi = mix(0.10, 0.55, hash(vec2(u_seed + fi * 7.7, 3.1))) * u_target.y;
      float blen = min(mix(0.10, 0.18, hash(vec2(u_seed + fi * 5.1, 1.7))) * u_res.y, u_target.y - 10.0 - ybi);
      if (fc.y < ybi || fc.y > ybi + blen) { continue; }
      float bI = (leadOn ? 0.16 * step(fc.y, leadY) : 0.0) + 0.8 * dec1;
      if (bI < 0.004) { continue; }
      float hb2 = hash(vec2(u_seed + fi * 3.3, 8.9));
      float side = hb2 < 0.5 ? -1.0 : 1.0;
      float slp = side * mix(0.35, 0.85, fract(hb2 * 7.31));
      float bx = chanX(ybi) + (fc.y - ybi) * slp + zig(fc.y, 22.0, u_seed + fi * 13.0) * 10.0;
      float bd = fc.x - bx;
      if (abs(bd) > 26.0) { continue; }
      float br = (fc.y - ybi) / max(blen, 1.0);
      float taper = 1.0 - smoothstep(0.55, 1.0, br);
      float join = 1.0 + 0.8 * exp(-br * 6.0);
      float bcore = exp(-bd * bd / 1.8);
      float bfr = exp(-bd * bd / 90.0);
      rgb  += (vec3(0.95, 0.93, 1.0) * bcore + vec3(0.55, 0.50, 1.0) * bfr * 0.4) * bI * taper * join;
      aTot += (bcore * 0.8 + bfr * 0.25) * bI * taper * join;
    }
  }

  // the daylight pop: additive white over everything (tiles included, for ~90ms)
  rgb  += vec3(1.0, 0.99, 1.0) * flashA;
  aTot += flashA;

  aTot = min(aTot, 0.75); // legibility cap: tiles in front always read through the strobe
  rgb  = min(rgb, vec3(1.0));
  return half4(rgb * fade, aTot * fade);
}
`;

const effect = makeShaderEffect(BOLT_SKSL, 'BeaconStormBolt');

export type BeaconStormBoltProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconStormBolt({ active, anchorX, anchorY, measured, focused = true }: BeaconStormBoltProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  const [visible, setVisible] = useState(false);
  const [seed, setSeed] = useState(0);
  const prevActive = useRef(active); // only a REAL unlit -> lit edge arms the strike

  // Gated clock: only ticks while the strike is on screen and focused; zeroed at arming so the
  // shader's whole schedule hangs off the tap. Blur mid-strike pauses it; the 2.4s timeout still
  // clears the layer, and a refocus never replays (visible is already false).
  const { clock } = useGatedClock(visible && focused && !reduce);

  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    if (!active) {
      setVisible(false); // extinguish mid-strike clears instantly (the strike is transient)
      return;
    }
    if (was || reduce) return; // first mount while lit / reduce: no bolt, the thunder carries it
    setSeed(Math.random() * 100 + 1);
    clock.value = 0;
    setVisible(true);
    const tm = setTimeout(() => setVisible(false), 2400);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);

  const uniforms = useDerivedValue(
    () => ({
      u_time: clock.value,
      u_target: [anchorX, anchorY],
      u_res: [W, H],
      u_seed: seed,
    }),
    [anchorX, anchorY, W, H, seed]
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
