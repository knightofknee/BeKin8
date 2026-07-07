// components/BeaconFireworks.tsx
// The FIREWORKS beacon's behind-the-tiles layer: a BACKYARD SHELL SHOW over someone's lawn,
// rendered by one Skia fragment shader, fully deterministic in u_time (Steinrucken SH17A-style
// stateless fireworks, rebudgeted for mobile). No JS particle state, no FBM anywhere, constant
// SkSL loop bounds.
// STAGING: u_origin is the GROUND at the mortar rack's base (the skin's origin 0.78 anchor: the
// scorched-grass patch, whose small Skia flame is a SEPARATE layer, not ours). The HDPE mortar
// tube's MUZZLE sits 86px above that anchor (viewBox y=30 at size 180): MUZZLE_DY below. Launch
// streaks leave the muzzle; bursts and everything else are unchanged in screen space.
// TIMING CONTRACT (registry origin + structure + ignite clip + this file all agree): from the lit
// edge (t=0) the structure's fuse spark burns for 1.8s, the muzzle flashes and the rack kicks at
// 1.8, the opening streak leaves the muzzle at 1.85 (slot 0's launch), and the opener VOLLEY
// breaks at 2.75 / 3.03 / 3.30 (launch + the 0.9s LAUNCH rise + the 0.28/0.55 sub delays). The
// audio is built to the same line: fuse sizzle 0-1.8s, lift thump 1.85s, whistle 1.9-2.7s, booms
// from 2.75s.
// THE SHOW, 20s SYNCED LOOP (LINEAR AUDIO CONTRACT): the sound engine plays a 20-second clip in
// linear loop mode, started at the lit edge (the SAME t=0 as this shader's zeroed gated clock)
// and looping exactly every 20s, with whistles and booms authored at fixed clip times. RE-ANCHOR
// RULE (both layers together): the sound layer restarts its clip from 0 whenever play resumes, so
// the gated clock here is zeroed at the SAME three moments: (1) the lit edge, (2) the rising edge
// of focused while lit (navigation refocus: the clock pauses on blur and would otherwise resume
// mid-cycle against a clip restarted at 0), and (3) AppState returning to 'active' after a
// background while lit && focused (app foreground: same desync). After any pause both layers
// start the 20s cycle together at t=0. The shader
// therefore fires at FIXED TIMES on a 20s cycle (CYCLE): per slot, showCycle = floor((u_time -
// launchTime) / 20). Slot 0 EVERY cycle is the 3-break VOLLEY (launch at cycle-time 1.85, breaks
// 2.75 / 3.03 / 3.30); slots 1-4 are 28-particle singles breaking at 7.0 / 10.8 / 14.4 / 18.0
// (launches 0.9s earlier: 6.1 / 9.9 / 13.5 / 17.1). Times NEVER vary, cycle after cycle, which is
// what keeps the audio loop honest; variety comes from hashing EVERY per-burst trait (burst
// point, launch lean, palette, rotation, per-particle speeds) off (showCycle, slot). Each firing:
// a LAUNCH phase (0..0.9s), one ANALYTIC bright streak rising from the muzzle to a hash-picked
// burst point (x = anchor +-0.28W, clamped 15..85% W; y = 16..34% H) with a hash-varied lateral
// lean, a bright round head bloom and a 54px velocity-elongated fading tail, plus a tiny 4-speck
// hashed spark scatter at the muzzle for the first 0.12s; then a BURST phase (0.9s + 2.3s BLIFE),
// hash particles flying radially under analytic gravity, each a velocity-stretched exp glow
// trail, hashed speed variance 0.6..1.1, a late-life sin twinkle, burst-wide fade over the last
// 30%, and a soft expanding halo flash for the first 250ms. COLORS: per-burst hashed palette from
// 4 festival pairs (gold / red / teal / violet); particles are born hot white and mix toward the
// pair with age.
// THE VOLLEY (slot 0, every cycle): 3 breaks, the main at the apex plus two hashed secondaries
// (46..74px x on forced-opposite sides, -40..+30px y, clamped on-screen) delayed +0.28s and
// +0.55s, 20 particles each instead of 28 (60 evaluations worst case, see BUDGET), everything
// hashed off (showCycle, sub-index). The volley window is VSHOW = 3.75 (LAUNCH + 0.55 + BLIFE),
// so the last break fades fully at cycle-time 5.6, half a second before slot 1's 6.1 launch.
// GAPS (burst life 2.3s; no long dark-sky stretches, no audible awkward loop): fade-to-next-break
// gaps are 5.6->7.0 (1.4s), 9.3->10.8 (1.5s), 13.1->14.4 (1.3s), 16.7->18.0 (1.3s), and across
// the cycle boundary 20.3->22.75 (2.45s: slot 4's break at 18.0 lives to 20.3, wrapping 0.3s into
// the next cycle's pre-volley window; the next break is that cycle's 2.75). All stay under the
// ~2.5s ceiling, and every gap except the wrap is bridged even earlier by the next launch streak
// (fade-to-launch: 0.5 / 0.6 / 0.4 / 0.4s).
// BUDGET (hard): every sub-burst runs its 20/28-particle loop ONLY inside its own bounding circle
// computed BEFORE the loop (gravity is common to the swarm, so the center is the break point plus
// the shared drop; radius is maxSpeed * burstAge plus trail + glow margin); outside it, zero
// per-particle work. The launch streak (and its muzzle sparks) has its own cheap segment-box
// cull. OVERLAP: the schedule never overlaps two slots (fade -> next launch: 5.6 < 6.1, 9.3 <
// 9.9, 13.1 < 13.5, 16.7 < 17.1, and slot 4's wrap 20.3 < the next cycle's 21.85 volley launch),
// so only the volley's own staggered subs coexist: per-fragment worst case is the volley's
// 3 x 20 = 60 particle evaluations on overlapping fragments, singles run 28. That is at or under
// the repo's smoke-shader ceiling, and OUTSIDE the volley it is below the old two-slot design's
// 56-eval steady state.
// DETERMINISM + FIRST LAUNCH: negative showCycles are skipped (c < 0: nothing exists from before
// the beacon was lit, the BeaconSmokeSignal trick, so no phantom mid-air bursts at mount; at
// u_time 0 every slot's c is -1, so the sky stays empty until the first launch at 1.85s), and
// slot 0's launch is 1.85s so the opening streak leaves the muzzle exactly as the structure's
// 1.8s fuse one-shot finishes and fires its handoff kick. home mounts this layer per SKIN (not
// per lit state), so the lit edge also ZEROES the gated clock (re-anchor point 1 of 3, see the
// RE-ANCHOR RULE above): every relight re-arms the fuse-to-launch choreography AND restarts the
// 20s audio clip from the same t=0, keeping every boom on its break.
// TILE LEGIBILITY: bursts live at 16..34% H, inside the tile band's top, so the final fragment
// alpha is capped at 0.6 (tiles carry their own cards; the aurora precedent allows sky effects
// behind them). The below-anchor mask now keys off the GROUND anchor: burst/halo light dies by
// anchorY - 40 (40px above the grass line), so nothing ever paints over the controls area below
// the structure; the launch streak and its muzzle sparks are exempt inside their narrow corridor
// (they must reach down to the muzzle, 86px above the anchor). Reduced motion: one static
// mid-bloom SINGLE burst (slot 0, cycle 0, age 0.5, no volley) at low alpha. NATIVE: needs a
// dev/EAS rebuild, Skia is a native module.
import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
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

const FIREWORKS_SKSL = `
uniform float u_time;    // seconds since the last re-anchor (zeroed on lit edge, refocus, foreground)
uniform float u_act;     // 0..1 lit-fade
uniform float u_density; // per-skin show intensity (scales overall brightness)
uniform vec2  u_origin;  // GROUND anchor (page px): the grass patch at the mortar rack's base
uniform float u_w;       // screen width (px); burst-point spread + clamps
uniform float u_h;       // screen height (px); burst altitude band
uniform float u_static;  // 1 = reduced motion: one frozen mid-bloom burst, no schedule

const float LAUNCH = 0.9;   // rise time (s)
const float BLIFE  = 2.3;   // burst life after the pop (s)
const float SHOW   = 3.2;   // LAUNCH + BLIFE; a single's window, then the slot is dark
const float VSHOW  = 3.75;  // volley window: LAUNCH + 0.55 (last sub-break delay) + BLIFE
const float CYCLE  = 20.0;  // SHOW_CYCLE: fixed show period = the linear audio clip's exact loop
const float SPD    = 130.0; // base radial particle speed (px/s), hashed 0.6..1.1 per particle
const float MUZZLE_DY = -86.0; // mortar muzzle: viewBox y=30 at size 180, 86px above the anchor

float hash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

half4 main(vec2 fragCoord){
  vec3  rgb  = vec3(0.0);
  float aTot = 0.0;
  vec2  muz  = u_origin + vec2(0.0, MUZZLE_DY); // shells leave the tube mouth, not the grass

  // CONTROLS GUARD: burst/halo light fades to zero below anchorY - 40. The anchor is the GROUND
  // at the rack's base, so all sky light dies 40px above the grass line and never paints over the
  // controls area below the structure. The launch streak is exempt inside its own narrow
  // corridor: it must reach down to the muzzle (86px above the anchor), and its first-instant
  // spark scatter lives there too. The small Skia patch flame at the anchor is a separate layer.
  float bmask = 1.0 - smoothstep(u_origin.y - 70.0, u_origin.y - 40.0, fragCoord.y);

  for (int k = 0; k < 5; k++){
    float fk = float(k);
    // FIXED LAUNCH TIMES on the shared 20s cycle (the break lands 0.9s after the launch, matching
    // the audio clip's authored whistles/booms): slot 0 launches at cycle-time 1.85 (the volley;
    // breaks 2.75 / 3.03 / 3.30), slots 1-4 launch at 6.1 / 9.9 / 13.5 / 17.1 (breaks 7.0 / 10.8
    // / 14.4 / 18.0). Slot 0's 1.85 also lines up with the structure's fuse: the spark burns
    // 0..1.8s, the muzzle flashes and the rack kicks at 1.8, the shell leaves the tube at 1.85.
    // Times NEVER vary between cycles; only the hashed traits below do.
    float offs = k == 0 ? 1.85 : (k == 1 ? 6.1 : (k == 2 ? 9.9 : (k == 3 ? 13.5 : 17.1)));
    float t    = u_time - offs;
    float c    = floor(t / CYCLE);     // this slot's showCycle: the cycle its launch belongs to
    float tin  = t - c * CYCLE;        // time since this slot's launch within that cycle
    if (u_static > 0.5){
      if (k > 0) { continue; }
      c   = 0.0;                       // reduced motion: slot 0, cycle 0,
      tin = LAUNCH + 0.5 * BLIFE;      // frozen mid-bloom (age 0.5), single burst (no volley)
    }
    if (c < -0.5) { continue; }        // nothing exists from before the beacon was lit: at
                                       // u_time 0 every slot's c is -1, so the sky stays empty
                                       // until the first launch at 1.85

    // VOLLEY flag: slot 0 is the 3-break volley EVERY cycle (the audio loop authors three booms
    // at 2.75/3.03/3.30 each pass); reduced motion keeps its single frozen burst instead.
    bool volley = (k == 0) && (u_static < 0.5);
    if (tin >= (volley ? VSHOW : SHOW)) { continue; } // dark stretch of the cycle

    // Per-burst hashed identity: everything about this firework derives from (showCycle, slot),
    // so every cycle re-rolls positions, leans, palettes and spins while the times stay fixed.
    float seed = c * 7.31 + fk * 17.77;
    float h1 = hash(vec2(seed + 0.7, fk + 1.3)); // burst x spread
    float h2 = hash(vec2(seed + 5.1, fk + 6.9)); // burst altitude
    float h3 = hash(vec2(seed + 9.4, fk + 2.2)); // launch lean
    float h4 = hash(vec2(seed + 3.8, fk + 8.5)); // palette pick
    float h5 = hash(vec2(seed + 6.2, fk + 4.1)); // burst rotation

    float bx = clamp(u_origin.x + (h1 - 0.5) * 0.56 * u_w, 0.15 * u_w, 0.85 * u_w);
    float by = mix(0.16 * u_h, 0.34 * u_h, h2);

    // Festival palette pair, hash-picked per burst. Defaults to gold, overridden by thresholds.
    vec3 colA = vec3(1.0, 0.851, 0.549);                                                  // gold
    vec3 colB = vec3(1.0, 0.604, 0.235);
    if (h4 >= 0.75)      { colA = vec3(0.706, 0.612, 1.0);  colB = vec3(1.0, 0.604, 0.835); }  // violet
    else if (h4 >= 0.5)  { colA = vec3(0.435, 0.89, 0.816); colB = vec3(0.749, 0.957, 1.0); }  // teal
    else if (h4 >= 0.25) { colA = vec3(1.0, 0.416, 0.353);  colB = vec3(1.0, 0.761, 0.29);  }  // red

    if (tin < LAUNCH){
      // LAUNCH: the shell lift. One analytic streak from the MUZZLE to the break point with a
      // bright round head bloom and a velocity-elongated tail, no loop. Its own cheap segment-box
      // cull (padded for the lateral lean + glow width) confines all the math, including the
      // muzzle spark scatter below.
      float lean = (h3 - 0.5) * 64.0;
      float pad  = abs(lean) + 28.0;
      if (fragCoord.x > min(muz.x, bx) - pad && fragCoord.x < max(muz.x, bx) + pad &&
          fragCoord.y > by - 26.0 && fragCoord.y < muz.y + 20.0){
        float s   = tin / LAUNCH;
        float se  = 1.0 - (1.0 - s) * (1.0 - s);   // fast off the rack, decelerating into the apex
        float s2  = max(s - 0.08, 0.0);
        float se2 = 1.0 - (1.0 - s2) * (1.0 - s2);
        vec2 head = vec2(mix(muz.x, bx, se)  + lean * sin(se  * 3.14159), mix(muz.y, by, se));
        vec2 prev = vec2(mix(muz.x, bx, se2) + lean * sin(se2 * 3.14159), mix(muz.y, by, se2));
        vec2 back  = prev - head;                  // tail points back down the flight path
        vec2 bu    = back / max(length(back), 0.001);
        vec2 d     = fragCoord - head;
        float proj = clamp(dot(d, bu), 0.0, 54.0); // 54px tail (was 42): a real lift charge now
        float dist = length(d - bu * proj);
        float g = exp(-dist * dist * 0.16) * (1.0 - (proj / 54.0) * 0.85);
        g += exp(-dot(d, d) * 0.055) * 0.55;       // brighter round head bloom
        g *= smoothstep(0.0, 0.06, s);             // pop on at the thump, never before
        g *= 0.82 + 0.18 * sin(u_time * 42.0 + fk * 7.0); // lift sputter
        vec3 scol = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.72, 0.38), proj / 54.0);
        float a = g * 1.05;
        rgb  += scol * a;
        aTot += a;

        // MUZZLE SPARK SCATTER: for the first 0.12s of the lift, 4 hashed hot specks kick out of
        // the tube mouth with the shell. Cheap: 2 hashes + one exp each, paid only by fragments
        // inside the streak corridor cull while tin < 0.12.
        if (tin < 0.12){
          float mf = exp(-tin * 24.0);
          for (int m = 0; m < 4; m++){
            float fm = float(m);
            float m1 = hash(vec2(seed + fm * 2.13, fm + 4.7));
            float m2 = hash(vec2(fm * 5.91 + seed, seed + 1.9));
            vec2  sp = muz + vec2((m1 - 0.5) * 24.0, -m2 * 14.0 - tin * 90.0);
            vec2  sd = fragCoord - sp;
            float sg = exp(-dot(sd, sd) * 0.3) * mf;
            rgb  += vec3(1.0, 0.87, 0.6) * sg;
            aTot += sg;
          }
        }
      }
    } else if (bmask > 0.003){
      float bt0 = tin - LAUNCH;
      vec2  bp  = vec2(bx, by);
      float rot = h5 * 6.2831853;

      // SUB-BURST loop: 1 break for the singles (slots 1-4), 3 for slot 0's volley. Each
      // sub-burst gets ITS OWN bounding cull rather than one enlarged circle over all three: the
      // secondaries sit up to ~74px away and are staggered 0.28/0.55s, so a single circle
      // covering every break across their staggered lifetimes would gate 2-3x the area and charge
      // all 60 evaluations to every fragment inside it; per-sub circles keep not-yet-broken and
      // already-faded subs at zero cost and confine each live swarm's work to its own footprint.
      float pcnt = volley ? 20.0 : 28.0; // volley budget: 3 x 20 = 60 evals, once per cycle
      for (int j = 0; j < 3; j++){
        if (j > 0 && !volley) { continue; }  // slots 1-4 are single bursts
        float fj   = float(j);
        float sdel = j == 0 ? 0.0 : (j == 1 ? 0.28 : 0.55);
        float bt   = bt0 - sdel;
        if (bt < 0.0) { continue; }          // this break has not popped yet
        float age  = bt / BLIFE;
        if (age >= 1.0) { continue; }        // this break has fully faded

        // Secondary breaks sit around the main one: hashed 46..74px x on forced-opposite sides,
        // -40..+30px y, clamped on-screen. Hashes key off (showCycle, sub-index) via sseed.
        float sseed = seed + fj * 29.17;
        vec2  sbp   = bp;
        if (j > 0){
          float hbx  = hash(vec2(sseed + 11.3, fk + 12.9));
          float hby  = hash(vec2(sseed + 14.6, fk + 7.7));
          float side = j == 1 ? -1.0 : 1.0;
          sbp = vec2(clamp(bp.x + side * mix(46.0, 74.0, hbx), 0.05 * u_w, 0.95 * u_w),
                     bp.y + mix(-40.0, 30.0, hby));
        }
        float smul = j == 0 ? 1.0 : 0.85;    // secondaries read as smaller sympathetic breaks

        // BUDGET GATE: per-sub bounding circle BEFORE the particle loop. Gravity is common to
        // the whole swarm, so the circle's center is the break point plus the shared drop; the
        // radius is the fastest particle's reach plus trail (44px) + glow margin.
        vec2  ctr = vec2(sbp.x, sbp.y + 90.0 * bt * bt);
        float cr  = SPD * smul * 1.1 * bt + 100.0;
        vec2  cd  = fragCoord - ctr;
        if (dot(cd, cd) >= cr * cr) { continue; }

        // Soft expanding halo flash at the break center for the first 250ms.
        if (bt < 0.25){
          float hr   = mix(10.0, 70.0, bt * 4.0) * smul;
          vec2  hd   = fragCoord - sbp;
          float halo = exp(-dot(hd, hd) / (hr * hr) * 2.2) * (1.0 - bt * 4.0);
          float ha   = halo * 0.5 * smul * bmask;
          rgb  += mix(vec3(1.0), colA, 0.35) * ha;
          aTot += ha;
        }

        float fade  = 1.0 - smoothstep(0.7, 1.0, age); // break-wide fade over the last 30%
        float twmix = smoothstep(0.4, 0.75, age);      // twinkle fades in late in life

        for (int i = 0; i < 28; i++){
          float fi = float(i);
          if (fi >= pcnt) { continue; }      // volley breaks run 20 spokes; guard is one compare
          float p1  = hash(vec2(fi * 1.37 + sseed, sseed + 2.7));    // speed variance
          float p2  = hash(vec2(sseed * 1.9 + fi * 0.71, fi + 9.1)); // jitter + color + twinkle
          float ang = fi * (6.2831853 / pcnt) + rot + fj * 1.7 + (p2 - 0.5) * 0.24; // even spokes
          vec2  dir = vec2(cos(ang), sin(ang));
          float spd = SPD * smul * mix(0.6, 1.1, p1);
          vec2  pp  = sbp + dir * (spd * bt) + vec2(0.0, 90.0 * bt * bt); // analytic gravity arc
          vec2  d   = fragCoord - pp;
          if (dot(d, d) > 4900.0) { continue; }  // 70px coarse reject: max trail 44 + glow margin

          // Velocity-stretched glow: elongate the exp falloff back along the velocity so each
          // spark reads as a short trail, without any sub-loop.
          vec2  v    = dir * spd + vec2(0.0, 180.0 * bt);
          float vl   = max(length(v), 1.0);
          vec2  vu   = v / vl;
          float tl   = min(vl * 0.1, 44.0);      // ~0.1s of travel; trails lengthen as sparks fall
          float proj = clamp(dot(d, -vu), 0.0, tl);
          float dist = length(d + vu * proj);
          float tw   = mix(1.0, 0.45 + 0.55 * sin((bt + p2 * 9.0) * 24.0), twmix);
          float g    = exp(-dist * dist * 0.11) * (1.0 - (proj / max(tl, 1.0)) * 0.85) * tw * fade;
          vec3  pcol = mix(colA, colB, p2);
          vec3  col  = mix(vec3(1.0, 0.98, 0.93), pcol, smoothstep(0.05, 0.5, age)); // white-hot birth
          float a    = g * 0.85 * bmask;
          rgb  += col * a;
          aTot += a;
        }
      }
    }
  }

  rgb  *= u_density;
  aTot *= u_density;
  aTot  = min(aTot, 0.6);      // tile-legibility cap: tiles in front always read
  rgb   = min(rgb, vec3(1.0));
  return half4(rgb * u_act, aTot * u_act);
}
`;

const effect = makeShaderEffect(FIREWORKS_SKSL, 'BeaconFireworks');

export type BeaconFireworksProps = {
  skin: BeaconSkin;
  active: boolean;
  anchorX: number;
  anchorY: number;
  measured: boolean;
  focused?: boolean;
};

export default function BeaconFireworks({ skin, active, anchorX, anchorY, measured, focused = true }: BeaconFireworksProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Show intensity from the skin's smoke.opacity knob (0.5 -> 1.0 for the stock fireworks skin).
  const density = Math.max(0.5, Math.min(1, skin.smoke.opacity * 2.0));

  const act = useSharedValue(0);
  const firstRun = useRef(true);
  const [visible, setVisible] = useState(false);

  // Shared gated clock (see useGatedClock): registered + paused while gated, reliable across
  // cold/skin mounts. The GPU shader only paints while the Canvas is mounted (visible = lit), so
  // the expensive work hard-stops when unlit; only this counter advances.
  const { clock } = useGatedClock(active && !reduce && focused);

  // Mount only while lit (+ a fade tail) so nothing renders when unlit. The lit edge also ZEROES
  // the clock: home mounts this layer per skin (not per lit state), so without the reset a relight
  // would resume mid-schedule, the tap payoff could lag most of a cycle, and the 20s linear audio
  // clip (which restarts at the same lit edge) would drift off the visuals. At u_time = 0 the
  // c < 0 guards keep the sky empty while the structure's 1.8s fuse spark burns; slot 0's opening
  // streak leaves the muzzle at 1.85s, right as that fuse one-shot finishes and fires its handoff
  // kick.
  useEffect(() => {
    if (active) {
      clock.value = 0;
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(t);
  }, [active, clock]);

  // RE-ANCHOR point 2 of 3 (see the header's RE-ANCHOR RULE): navigation refocus. The gated
  // clock pauses while blurred (motionOn drops with focused) but the audio layer restarts its
  // clip from 0 when play resumes, so resuming mid-cycle would drift every boom off its break.
  // Zero the clock on the RISING edge of focused while lit; the prev-ref edge check keeps plain
  // re-renders (and the lit edge, handled above) from firing it. The shader is stateless off
  // u_time (all per-burst traits hash off showCycle/slot), so zeroing the clock is the whole
  // reset: there is no per-cycle JS state to clear.
  const prevFocused = useRef(focused);
  useEffect(() => {
    const rose = focused && !prevFocused.current;
    prevFocused.current = focused;
    if (rose && active) clock.value = 0;
  }, [focused, active, clock]);

  // RE-ANCHOR point 3 of 3: app foreground. Backgrounding stops the display link, freezing the
  // gated clock mid-cycle, and the sound layer re-kicks its clip from 0 on the next 'active'
  // (useFireSound's wasBackgrounded pattern; brief 'inactive' hops like the app switcher pause
  // neither audio nor frames, so they must NOT re-anchor). Mirror it exactly: zero the clock on
  // 'active' AFTER a background while lit && focused. Refs (the useFireSound convention) let the
  // once-mounted listener read the current props.
  const activeRef = useRef(active);
  activeRef.current = active;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => {
    let wasBackgrounded = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wasBackgrounded = true;
      } else if (state === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        if (activeRef.current && focusedRef.current) clock.value = 0;
      }
    });
    return () => sub.remove();
  }, [clock]);

  // Fade the show in/out with the lit state. Fade-in is FAST (it must be fully up well before the
  // 1.85s first launch, so the streak never plays behind a half-faded layer); fade-out matches
  // the 1s unmount tail.
  useEffect(() => {
    const first = firstRun.current;
    firstRun.current = false;
    if (reduce) {
      act.value = active ? 0.45 : 0; // static mid-bloom burst reads at low alpha
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
      u_density: density,
      u_origin: [anchorX, anchorY],
      u_w: W,
      u_h: H,
      u_static: reduce ? 1 : 0,
    }),
    [anchorX, anchorY, density, W, H, reduce]
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
