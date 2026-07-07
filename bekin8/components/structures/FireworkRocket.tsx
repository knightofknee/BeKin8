// components/structures/FireworkRocket.tsx
// The Fireworks skin's tap target: a REAL backyard mortar setup planted on the lawn, nothing
// floating. A wooden MORTAR RACK (two upright side boards of weathered pale wood with visible
// grain, one front cross brace with carriage bolts, feet sitting flat on the lawn line at
// y ~87-90.4 with grass tufts overlapping them) seats a dark HDPE MORTAR TUBE: a near-black
// cylinder with a subtle sheen stripe, a visible muzzle-opening ellipse, and a cool rim
// highlight. The muzzle CENTER is at exactly (50, 30). TIMING CONTRACT: the registry origin is
// 0.78, the GROUND at the rack's base: the scorch-patch anchor at (50, 78) (registry fire is
// 'none' for this skin: no Skia flame layer, the char patch drawn here is the whole aftermath
// ground); the shader still derives muzzle = anchor + (0, -86) at size 180, which is exactly
// viewBox y=30. A green VISCO FUSE (the star of the tap moment, 1.8 wide,
// gentle S-curves) exits the muzzle's right lip and curls down the tube side to a tail resting
// on the grass at (66, 84).
// Unlit: pure static. Warm porch-light tint from camera-RIGHT (the scene's house + porch light sit
// on the RIGHT side of the yard) and a cool moonlit rim from camera-LEFT.
// LIT-EDGE ONE-SHOT (prevLit ref, BeaconsScene pattern), 1.8s total, matching the ignite sound
// and the launch shader: at t=0 a bright spark leaves the grass-end tail and burns UP the fuse
// (arc-length-even waypoints, constant speed, tiny spitting spark strokes appearing and
// disappearing along the way) while a dashoffset consumes the cord behind it; at t=1.8 a 150ms
// MUZZLE FLASH (bright ellipse + upward wisp) fires and the rack KICKS ~2px DOWN into the ground
// and back (mortar recoil is downward); the shader's opening streak leaves the muzzle at t=1.85
// and the opener volley breaks at ~t=2.75. Under the 150ms flash the fuse SNAPS back to its
// half-burned steady state (below). First mount while already lit, reduced motion, and blur all
// skip the one-shot.
// LIT STEADY STATE (also first-mount-lit and every re-anchor): the show is RUNNING and the SAME
// right-lip fuse sits HALF-BURNED, exactly the state the intro burn passes through at its
// halfway mark (NARRATIVE: after the opening launch the crew re-lays a fresh charge and the
// show's slow-match keeps sputtering at the half mark). sparkP pins to FUSE_MID_P so the same
// dashoffset burn holds the tail half consumed while the muzzle half stays whole, and a small
// SPARKLER FIRE, the show's slow-match and the only live fire this skin has, sputters exactly
// at FUSE_MID, the visible cord end at the 50% arc-length point: a bright white-gold sputtering
// point (compact r-1.6 core, hot white center) throwing 7 short radiating spark strokes that
// flicker in changing subsets (three opacity loops over grouped strokes at incommensurate
// periods, plus a subtle core intensity wobble). Its warmth lands as glow strokes on the
// NEAREST WOOD EDGES ONLY (right upright edges + brace top; no radial glow balls: standing
// rule). The scorched patch at (50, 78) stays static underneath: char ring, ember flecks,
// singed blades, sooted muzzle. Unlit -> lit crossfades with the standard warm ramp; extinguish
// fades the sparkler out on the same ramp and restores the whole fuse. Reduced motion / blur
// pin the sparkler to a static mid-intensity spark on the same half-burned fuse.
// THE ONGOING SHOW SCHEDULE (recurring flash + kick): the show cycle is 20.0s and launches leave
// the muzzle at cycle-times 1.85 / 6.1 / 9.9 / 13.5 / 17.1 (slot 0 is the volley), so the muzzle
// flash + recoil kick fire on EVERY launch, not just the first. Dedicated shared values (never
// the one-shot's) run withRepeat(withSequence(delay gaps + 150ms flash pulses / 260ms kick
// pulses + a trailing hold)) composed to EXACTLY 20.0s per iteration. The recurring flash
// emanates from the muzzle OPENING itself (the mouth ellipse goes hot, a halo blooms past the
// rim, a wisp climbs out), with no side sparks so the right lip where the half-burned fuse
// still hangs stays readable; each pulse also briefly lights the sparkler core up (the flash
// value rides into its intensity read, one extra additive keyframe, cheap). RE-SYNC RULE (show contract): the sound layer
// restarts its 20s clip from 0 whenever play resumes, so the schedule re-anchors to t=0 (volley
// included, NO one-shot) on every rising edge of (lit && focused): first mount while lit,
// navigation refocus, reduce-off: and on AppState returning to 'active' while (lit && focused)
// (useFireSound's background/active convention). Only a REAL unlit -> lit edge plays the fuse
// one-shot, which covers the 1.85s volley itself; the schedule then starts phase-rotated so its
// first event is the 6.1s launch. Still (reduce / blur) cancels + pins the schedule to 0 exactly
// like the sparkler; unlit and unmount cancel it with everything else.
// Authored 0..100; 180x180 footprint. Animated (reanimated); reduced motion and blur pin static
// lit/unlit states. Fixed hook count (conditional layers mount via state, hooks live in stable
// subcomponents).
import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Svg, { Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  cancelAnimation,
  interpolate,
  Extrapolation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// HDPE mortar tube: near-black plastic, subtle sheen, cool rim
const HDPE = '#17191D';
const HDPE_SH = '#0B0D10';
const HDPE_HI = '#2E333B';
const MOUTH = '#04060A';
const RIM = '#3D434C';
// Rack wood: weathered pale boards, visible grain
const WOOD = '#9A8768';
const WOOD_HI = '#C2B08A';
const WOOD_DK = '#5F5138';
const GRAIN = '#4A3E2C';
const BOLT = '#3A3226';
// Lawn tones (match the scene's yard darks)
const GRASS = '#1E3D22';
const GRASS_DK = '#152C18';
const GRASS_HI = '#2C5430';
// The visco fuse (green-tinted cord)
const VISCO = '#7C9C55';
const VISCO_DK = '#55703A';
// Unlit readability: the scene's porch light is camera-RIGHT (warm right edges) and the moon fills
// from the left (cool left edges). Side-named so the light source assignment cannot silently flip.
const RIM_RIGHT = '#E8B978';
const RIM_LEFT = '#C7D2E0';
// Lit warmth + aftermath
const RIM_FIRE = '#FFB35C';
const EMBER = '#FF8A3C';
const EMBER_CORE = '#FFE9C0';
const CHAR = '#0A0806';
const ASH = '#2A241C';
const SINGE = '#6E4322';
const SHADOW = '#0E1220';

// Ignition timeline (ms from the lit edge; the ignite sound is built to this exact clock:
// fuse sizzle 0-1800, lift thump 1850, whistle 1900-2700, booms from 2750).
const FUSE_MS = 1800;
const SIN = Easing.inOut(Easing.sin);

// ===== THE ONGOING SHOW SCHEDULE (20.0s cycle, shared with the shader + the linear audio clip) =====
// Launches leave the muzzle at these cycle-times; slot 0 is the volley. All clocks anchor t=0 at
// the lit edge (or at a re-anchor, see the component). Every pulse LEADS its muzzle-exit by 50ms,
// the exact relationship the lit-edge one-shot uses (flash delay 1800 vs the 1850 streak), so a
// recurring launch looks identical to the first.
const SHOW_CYCLE_MS = 20000;
const SHOW_EVENTS_MS = [1850, 6100, 9900, 13500, 17100];
const SHOW_LEAD_MS = 50;
// Fresh-light phasing: the one-shot already covers the 1.85s volley, so the recurring schedule
// starts SHOW_ROT_MS in (after the one-shot's flash + kick fully settle at ~2060ms) and runs a
// ROTATED cycle whose wrapped volley lands at 21850ms = cycle 2's 1.85s. withDelay(rot,
// withRepeat(cycle)) keeps every later event on the shared clock without ever nesting an
// infinite repeat inside a sequence.
const SHOW_ROT_MS = 2200;
const SHOW_EVENTS_ROT = [...SHOW_EVENTS_MS.slice(1), SHOW_EVENTS_MS[0] + SHOW_CYCLE_MS].map(
  (e) => e - SHOW_ROT_MS
);

// One 20.0s iteration of the recurring muzzle flash: at each event a 150ms pulse (40 up / 110
// down, the one-shot's envelope), gaps as delays, then a hold at 0 padding the iteration to
// exactly SHOW_CYCLE_MS so withRepeat stays phase-locked to the audio clip forever.
function flashCycleSteps(events: number[]): number[] {
  const steps: number[] = [];
  let cursor = 0;
  for (const e of events) {
    const at = e - SHOW_LEAD_MS;
    steps.push(withDelay(at - cursor, withTiming(1, { duration: 40, easing: Easing.out(Easing.quad) })));
    steps.push(withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) }));
    cursor = at + 150;
  }
  steps.push(withTiming(0, { duration: SHOW_CYCLE_MS - cursor, easing: Easing.linear }));
  return steps;
}

// One 20.0s iteration of the recurring recoil: the existing 1.2-unit down-and-back kick (80ms
// down, 180ms back) at each event, padded to exactly SHOW_CYCLE_MS like the flash.
function kickCycleSteps(events: number[]): number[] {
  const steps: number[] = [];
  let cursor = 0;
  for (const e of events) {
    const at = e - SHOW_LEAD_MS;
    steps.push(withDelay(at - cursor, withTiming(1.2, { duration: 80, easing: Easing.out(Easing.quad) })));
    steps.push(withTiming(0, { duration: 180, easing: Easing.inOut(Easing.quad) }));
    cursor = at + 260;
  }
  steps.push(withTiming(0, { duration: SHOW_CYCLE_MS - cursor, easing: Easing.linear }));
  return steps;
}

// ===== THE FUSE PATH =====
// Authored muzzle -> tail as Catmull-Rom waypoints, converted to cubics at module scope. The
// same dense sampling yields (a) total length for the dashoffset burn (consumed tail-to-muzzle,
// exactly on-path) and (b) 6 arc-length-even spark waypoints (tail first: p=0 tail, p=1 muzzle)
// so the traveling spark moves at constant speed and meets the receding cord end.
const FUSE_PTS: [number, number][] = [
  [54.4, 30.6], // exits over the muzzle's right lip
  [57.6, 34.0],
  [55.8, 40.0],
  [59.6, 47.5],
  [56.8, 55.0],
  [60.8, 63.5],
  [58.2, 71.5],
  [62.6, 78.5],
  [66.0, 84.0], // tail resting on the grass
];

// Catmull-Rom waypoints -> cubic path string + dense samples feeding the arc-length machinery
// below (dashoffset burn, spark waypoints, the half-burn mark).
function catmull(pts: [number, number][]) {
  const n = pts.length;
  const seg: string[] = [`M${pts[0][0]} ${pts[0][1]}`];
  const samples: [number, number][] = [[pts[0][0], pts[0][1]]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, n - 1)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    seg.push(`C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0]} ${p2[1]}`);
    for (let s = 1; s <= 16; s++) {
      const t = s / 16;
      const mt = 1 - t;
      samples.push([
        mt * mt * mt * p1[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p2[0],
        mt * mt * mt * p1[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p2[1],
      ]);
    }
  }
  return { d: seg.join(' '), samples };
}

function buildFuse() {
  const { d, samples } = catmull(FUSE_PTS);
  const cum: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  const len = cum[cum.length - 1];
  const T: number[] = [];
  const X: number[] = [];
  const Y: number[] = [];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const target = (1 - t) * len; // p=0 is the tail (full arc length from the muzzle start)
    let j = 1;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const f = (target - cum[j - 1]) / Math.max(cum[j] - cum[j - 1], 1e-6);
    T.push(t);
    X.push(samples[j - 1][0] + f * (samples[j][0] - samples[j - 1][0]));
    Y.push(samples[j - 1][1] + f * (samples[j][1] - samples[j - 1][1]));
  }
  // The half-burn mark: BurnFuse's dashoffset read is p * (len + 1), so p = 0.5 leaves the
  // visible cord end at arc length (len + 1) / 2 from the muzzle start. Sample that exact spot
  // from the same cum table so the sparkler and the receding cord end meet precisely.
  const midTarget = Math.min((len + 1) / 2, len);
  let k = 1;
  while (k < cum.length - 1 && cum[k] < midTarget) k++;
  const mf = (midTarget - cum[k - 1]) / Math.max(cum[k] - cum[k - 1], 1e-6);
  const midX = samples[k - 1][0] + mf * (samples[k][0] - samples[k - 1][0]);
  const midY = samples[k - 1][1] + mf * (samples[k][1] - samples[k - 1][1]);
  return { d, len, T, X, Y, midX, midY };
}

const FUSE = buildFuse();
const FUSE_D = FUSE.d;
const FUSE_LEN = FUSE.len;
const SPARK_T = FUSE.T;
const SPARK_X = FUSE.X;
const SPARK_Y = FUSE.Y;
// Dash covers the whole path at offset 0; offset FUSE_LEN+1 hides it entirely (fuse burned).
const FUSE_DASH = `${(FUSE_LEN + 1).toFixed(2)} ${(FUSE_LEN + 8).toFixed(2)}`;
const FUSE_TAIL = { x: 66, y: 84 };

// ===== THE HALF-BURN MARK (lit steady state) =====
// After the intro one-shot (and directly on first-mount-while-lit / re-anchors) the fuse holds
// the state the burn passes through halfway: tail half consumed, muzzle half whole, the show's
// slow-match sputtering at the visible end. FUSE_MID_OFFSET is the exact strokeDashoffset the
// burn produces at p = 0.5; FUSE_MID is the (x, y) where the visible cord end sits at that
// offset, sampled from the same arc-length table, so the SparklerFire lands precisely on the
// cord end (~57.89, 57.81: on the right upright's face, above the brace).
export const FUSE_MID = { x: FUSE.midX, y: FUSE.midY };
export const FUSE_MID_OFFSET = (FUSE_LEN + 1) / 2;
// Pinning sparkP here reproduces FUSE_MID_OFFSET through BurnFuse's p * (FUSE_LEN + 1) read.
const FUSE_MID_P = 0.5;

// Opacity crossfade group (CampfireLogs pattern: mounted only while relevant, with a fade tail,
// so hooks stay inside a stable subcomponent).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// Vertical nudge group: the rack + tube assembly rides the recoil kick together; the ground
// (patch, tufts, shadows) and the fuse never move. Two contributions sum into it: the lit-edge
// one-shot's kick and the recurring show schedule's kick (they never fire together: on a fresh
// light the schedule's first event is the 6.1s launch, well after the one-shot settles).
function Kick({ y, y2, children }: { y: SharedValue<number>; y2: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ transform: [{ translateY: y.value + y2.value }] }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// The visco cord, consumed tail-to-muzzle by the burn: the path is drawn muzzle -> tail, so a
// growing dashoffset hides it from the tail end, tracking the spark exactly on-path. The pale
// exposed-powder tip vanishes the instant the burn starts.
function BurnFuse({ p }: { p: SharedValue<number> }) {
  const cord = useAnimatedProps(() => ({ strokeDashoffset: p.value * (FUSE_LEN + 1) }));
  const core = useAnimatedProps(() => ({ strokeDashoffset: p.value * (FUSE_LEN + 1) }));
  const tip = useAnimatedProps(() => ({
    opacity: interpolate(p.value, [0, 0.05], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <G>
      <AnimatedPath
        animatedProps={cord}
        d={FUSE_D}
        stroke={VISCO}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={FUSE_DASH}
      />
      <AnimatedPath
        animatedProps={core}
        d={FUSE_D}
        stroke={VISCO_DK}
        strokeWidth={0.6}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={FUSE_DASH}
      />
      <AnimatedCircle animatedProps={tip} cx={FUSE_TAIL.x} cy={FUSE_TAIL.y} r={0.7} fill="#C9BB90" />
    </G>
  );
}

// A tiny spitting spark cluster that flares in and out inside its own window of the burn.
function Spit({ p, at, children }: { p: SharedValue<number>; at: number; children: React.ReactNode }) {
  const props = useAnimatedProps(
    () => ({ opacity: interpolate(p.value, [at - 0.08, at, at + 0.08], [0, 1, 0], Extrapolation.CLAMP) }),
    [at]
  );
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// The one-shot traveling spark: a bright dot interpolated along the arc-even fuse waypoints
// (tail toward muzzle) with spitting spark strokes appearing and disappearing along the way.
function FuseSpark({ p, op }: { p: SharedValue<number>; op: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({
    opacity: op.value,
    transform: [
      { translateX: interpolate(p.value, SPARK_T, SPARK_X) },
      { translateY: interpolate(p.value, SPARK_T, SPARK_Y) },
    ],
  }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={2} fill="#FFC24A" opacity={0.28} />
      <Circle cx={0} cy={0} r={1.05} fill="#FFF6D8" />
      <Line x1={0.9} y1={-1} x2={1.9} y2={-1.9} stroke="#FFE08A" strokeWidth={0.5} strokeLinecap="round" />
      <Line x1={-1.1} y1={0.7} x2={-2} y2={1.4} stroke="#FFD24A" strokeWidth={0.45} strokeLinecap="round" />
      <Spit p={p} at={0.14}>
        <Line x1={0.8} y1={-1.4} x2={2.4} y2={-2.9} stroke="#FFE9A8" strokeWidth={0.5} strokeLinecap="round" />
        <Line x1={-1} y1={-0.5} x2={-2.6} y2={-1.1} stroke="#FFC24A" strokeWidth={0.45} strokeLinecap="round" />
      </Spit>
      <Spit p={p} at={0.36}>
        <Line x1={1.1} y1={0.4} x2={2.7} y2={1.2} stroke="#FFE9A8" strokeWidth={0.5} strokeLinecap="round" />
        <Line x1={-0.6} y1={-1.3} x2={-1.5} y2={-2.8} stroke="#FFD24A" strokeWidth={0.45} strokeLinecap="round" />
      </Spit>
      <Spit p={p} at={0.58}>
        <Line x1={-1.2} y1={0.9} x2={-2.8} y2={1.9} stroke="#FFE9A8" strokeWidth={0.5} strokeLinecap="round" />
        <Line x1={0.9} y1={-1.2} x2={1.8} y2={-2.6} stroke="#FFC24A" strokeWidth={0.4} strokeLinecap="round" />
      </Spit>
      <Spit p={p} at={0.8}>
        <Line x1={1.3} y1={-0.3} x2={2.9} y2={-0.8} stroke="#FFE9A8" strokeWidth={0.5} strokeLinecap="round" />
        <Line x1={-0.9} y1={1} x2={-1.9} y2={2.3} stroke="#FFD24A" strokeWidth={0.45} strokeLinecap="round" />
      </Spit>
    </AnimatedG>
  );
}

// ===== THE SPARKLER (lit steady state) =====
// The show's slow-match, and the only live fire this skin has (registry fire is 'none'): a
// bright white-gold point sputtering IN PLACE at FUSE_MID, the burning end of the half-burned
// fuse. A compact core (r 1.6, hot white center) wobbles gently while 7 short radiating spark
// strokes flicker in changing subsets: three opacity loops over grouped strokes with
// incommensurate periods (660 / 740 / 770ms), so the visible subset never settles onto a beat.
// Its warmth lands as glow strokes on the nearest wood edges only (right upright edges + the
// brace top, breathing with the core: no radial glow balls). `still` (reduced motion or blur)
// cancels the loops and pins a static mid-intensity spark. `boost` is the recurring show's
// muzzle-flash value: each launch pulse rides into the core intensity read (one extra additive
// keyframe, cheap), briefly snapping the core to full bright as if the blast lights it up.
function SparklerFire({ still, boost }: { still: boolean; boost: SharedValue<number> }) {
  const coreK = useSharedValue(0.9); // core intensity wobble, 0.78..1
  const gA = useSharedValue(1); // stroke group A opacity
  const gB = useSharedValue(0.35); // stroke group B opacity
  const gC = useSharedValue(0.7); // stroke group C opacity

  useEffect(() => {
    cancelAnimation(coreK);
    cancelAnimation(gA);
    cancelAnimation(gB);
    cancelAnimation(gC);
    if (still) {
      // Static mid-intensity spark: core steady, a mixed subset of strokes held visible.
      coreK.value = 0.9;
      gA.value = 1;
      gB.value = 0.35;
      gC.value = 0.7;
      return;
    }
    // Each loop is a short sequence of bright/dark beats that lands back on its start value, so
    // the repeat is seamless; the three totals share no small common multiple.
    coreK.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 260, easing: SIN }),
        withTiming(0.78, { duration: 340, easing: SIN }),
        withTiming(0.9, { duration: 300, easing: SIN })
      ),
      -1,
      false
    );
    gA.value = withRepeat(
      withSequence(
        withTiming(0.12, { duration: 180, easing: SIN }),
        withTiming(0.85, { duration: 140, easing: SIN }),
        withTiming(0.3, { duration: 190, easing: SIN }),
        withTiming(1, { duration: 150, easing: SIN })
      ),
      -1,
      false
    );
    gB.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 160, easing: SIN }),
        withTiming(0.2, { duration: 210, easing: SIN }),
        withTiming(0.75, { duration: 170, easing: SIN }),
        withTiming(0.35, { duration: 200, easing: SIN })
      ),
      -1,
      false
    );
    gC.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 230, easing: SIN }),
        withTiming(0.95, { duration: 150, easing: SIN }),
        withTiming(0.45, { duration: 180, easing: SIN }),
        withTiming(0.7, { duration: 210, easing: SIN })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => () => {
    cancelAnimation(coreK);
    cancelAnimation(gA);
    cancelAnimation(gB);
    cancelAnimation(gC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glow = useAnimatedProps(() => ({ opacity: interpolate(coreK.value, [0.78, 1], [0.32, 0.6]) }));
  const core = useAnimatedProps(() => ({ opacity: Math.min(1, coreK.value + boost.value) }));
  const a = useAnimatedProps(() => ({ opacity: gA.value }));
  const b = useAnimatedProps(() => ({ opacity: gB.value }));
  const c = useAnimatedProps(() => ({ opacity: gC.value }));

  return (
    <G>
      {/* sparkler light on the nearest wood edges only: right upright sides + brace top */}
      <AnimatedG animatedProps={glow}>
        <Line x1={57.05} y1={52.8} x2={57.05} y2={63} stroke="#FFCF7E" strokeWidth={0.5} strokeLinecap="round" opacity={0.85} />
        <Line x1={61.35} y1={54.2} x2={61.35} y2={62} stroke="#FFC46A" strokeWidth={0.45} strokeLinecap="round" opacity={0.7} />
        <Line x1={55.4} y1={63.3} x2={61.6} y2={63.3} stroke="#FFCF7E" strokeWidth={0.45} strokeLinecap="round" opacity={0.6} />
      </AnimatedG>
      <G transform={`translate(${FUSE_MID.x} ${FUSE_MID.y})`}>
        <AnimatedG animatedProps={a}>
          <Line x1={1} y1={-0.8} x2={2.6} y2={-2.2} stroke="#FFF3C8" strokeWidth={0.5} strokeLinecap="round" />
          <Line x1={-1.2} y1={0.6} x2={-2.9} y2={1.3} stroke="#FFD24A" strokeWidth={0.45} strokeLinecap="round" />
          <Line x1={0.3} y1={1.2} x2={0.7} y2={3} stroke="#FFE08A" strokeWidth={0.45} strokeLinecap="round" />
        </AnimatedG>
        <AnimatedG animatedProps={b}>
          <Line x1={-0.8} y1={-1} x2={-2.1} y2={-2.7} stroke="#FFE9A8" strokeWidth={0.5} strokeLinecap="round" />
          <Line x1={1.3} y1={0.7} x2={3.1} y2={1.6} stroke="#FFD24A" strokeWidth={0.45} strokeLinecap="round" />
        </AnimatedG>
        <AnimatedG animatedProps={c}>
          <Line x1={-0.3} y1={-1.3} x2={-0.8} y2={-3.1} stroke="#FFF3C8" strokeWidth={0.45} strokeLinecap="round" />
          <Line x1={1} y1={1} x2={2.3} y2={2.5} stroke="#FFC24A" strokeWidth={0.45} strokeLinecap="round" />
        </AnimatedG>
        {/* the sputtering point itself: compact core dot with a hot white center, no halo */}
        <AnimatedG animatedProps={core}>
          <Circle cx={0} cy={0} r={1.6} fill="#FFD98C" />
          <Circle cx={0} cy={0} r={0.7} fill="#FFF8E6" />
        </AnimatedG>
      </G>
    </G>
  );
}

// A small static grass tuft (lawn darks, matching the scene's yard).
function Tuft({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <Path d="M0 0.4 C-0.5 -1.4 -0.3 -2.8 0.4 -4" stroke={GRASS_HI} strokeWidth={0.7} strokeLinecap="round" fill="none" />
      <Path d="M0.9 0.4 C1.3 -0.8 1.9 -1.8 2.8 -2.5" stroke={GRASS} strokeWidth={0.65} strokeLinecap="round" fill="none" />
      <Path d="M-0.9 0.4 C-1.4 -0.7 -2.1 -1.4 -3 -1.8" stroke={GRASS_DK} strokeWidth={0.65} strokeLinecap="round" fill="none" />
    </G>
  );
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function FireworkRocket({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  const warmOp = useSharedValue(lit ? 1 : 0); // unlit -> aftermath crossfade
  // burn progress: 0 fresh fuse (tail) .. 1 consumed (muzzle); lit steady state pins FUSE_MID_P
  const sparkP = useSharedValue(lit ? FUSE_MID_P : 0);
  const sparkOp = useSharedValue(0); // traveling spark visibility
  const flashOp = useSharedValue(0); // one-shot muzzle flash at t=1.8
  const kickY = useSharedValue(0); // one-shot recoil nudge, DOWN then back (viewBox units; ~2px at 180)
  const showFlash = useSharedValue(0); // RECURRING show: muzzle flash pulse, one per launch
  const showKick = useSharedValue(0); // RECURRING show: recoil pulse, one per launch
  const prevLit = useRef(lit); // first mount while lit must skip the fuse one-shot
  // Live mirrors for the mount-once AppState listener (useFireSound's enabledRef convention).
  const litRef = useRef(lit);
  const focusedRef = useRef(focused);
  const reduceRef = useRef(reduce);
  litRef.current = lit;
  focusedRef.current = focused;
  reduceRef.current = reduce;

  // Mount the aftermath overlays only while lit, with a fade tail covering the extinguish ramp.
  const [warming, setWarming] = useState(lit);
  // Mount the spark + flash layers only for the one-shot run.
  const [sparking, setSparking] = useState(false);
  useEffect(() => {
    if (lit) {
      setWarming(true);
      return;
    }
    const t = setTimeout(() => setWarming(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  // Starts the recurring show schedule on its dedicated values. Anchored (skipVolley false):
  // the full cycle runs from t=0, volley pulse at 1.85s included (re-anchors: the sound clip
  // just restarted from 0). skipVolley true (fresh light): the one-shot covers the volley, so
  // the schedule starts SHOW_ROT_MS in on the rotated cycle, first event at the 6.1s launch.
  // Only touches stable refs, so the mount-once AppState listener may capture it safely.
  const startShowSchedule = (skipVolley: boolean) => {
    cancelAnimation(showFlash);
    cancelAnimation(showKick);
    showFlash.value = 0;
    showKick.value = 0;
    if (skipVolley) {
      showFlash.value = withDelay(SHOW_ROT_MS, withRepeat(withSequence(...flashCycleSteps(SHOW_EVENTS_ROT)), -1, false));
      showKick.value = withDelay(SHOW_ROT_MS, withRepeat(withSequence(...kickCycleSteps(SHOW_EVENTS_ROT)), -1, false));
    } else {
      showFlash.value = withRepeat(withSequence(...flashCycleSteps(SHOW_EVENTS_MS)), -1, false);
      showKick.value = withRepeat(withSequence(...kickCycleSteps(SHOW_EVENTS_MS)), -1, false);
    }
  };

  useEffect(() => {
    const wasLit = prevLit.current;
    prevLit.current = lit;
    // Blur acts like reduced motion: cancel everything and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(warmOp);
    cancelAnimation(sparkP);
    cancelAnimation(sparkOp);
    cancelAnimation(flashOp);
    cancelAnimation(kickY);
    cancelAnimation(showFlash);
    cancelAnimation(showKick);
    if (lit) {
      if (still) {
        // Covered or reduced: settle straight into the static aftermath (fuse half-burned,
        // sparkler seat) and pin the show schedule to 0 alongside the sparkler. Nothing runs
        // until uncovered.
        setSparking(false);
        sparkP.value = FUSE_MID_P;
        sparkOp.value = 0;
        flashOp.value = 0;
        kickY.value = 0;
        showFlash.value = 0;
        showKick.value = 0;
        warmOp.value = 1;
        return;
      }
      if (wasLit) {
        // Re-anchor (RE-SYNC RULE): first mount while already lit, a navigation refocus, or a
        // reduce toggle off. The sound layer restarts its 20s clip from 0 on resume, so the
        // show schedule restarts anchored at t=0 WITH the 1.85s volley; the one-shot never
        // replays here (the fuse stays pinned at its half-burned steady state).
        setSparking(false);
        sparkP.value = FUSE_MID_P;
        sparkOp.value = 0;
        flashOp.value = 0;
        kickY.value = 0;
        warmOp.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
        startShowSchedule(false);
        return;
      }
      // Real unlit -> lit edge: the fuse show, on the ignite-sound clock. The spark burns
      // tail-to-muzzle over 1.8s (constant speed; the dashoffset eats the cord behind it), then
      // at t=1.8 the muzzle flashes for 150ms, the rack kicks ~2px DOWN and back (mortar recoil),
      // and the aftermath (scorch, sparkler at the fuse's half mark) ramps in underneath the
      // launch (the shader streak leaves at 1.85). The recurring schedule starts rotated
      // underneath it: its first event is the 6.1s launch, every launch after that flashing +
      // kicking forever.
      setSparking(true);
      sparkP.value = 0;
      sparkOp.value = 1;
      flashOp.value = 0;
      kickY.value = 0;
      sparkP.value = withSequence(
        withTiming(1, { duration: FUSE_MS, easing: Easing.linear }),
        // Snap to the half-burned steady state, masked by the 150ms muzzle flash: the crew
        // re-lays a fresh charge and the show's slow-match keeps sputtering at the half mark.
        withTiming(FUSE_MID_P, { duration: 40, easing: Easing.linear })
      );
      sparkOp.value = withDelay(FUSE_MS - 20, withTiming(0, { duration: 80 }));
      flashOp.value = withDelay(
        FUSE_MS,
        withSequence(
          withTiming(1, { duration: 40, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) })
        )
      );
      kickY.value = withDelay(
        FUSE_MS,
        withSequence(
          withTiming(1.2, { duration: 80, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 180, easing: Easing.inOut(Easing.quad) })
        )
      );
      warmOp.value = withDelay(FUSE_MS, withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }));
      startShowSchedule(true);
      const t = setTimeout(() => setSparking(false), FUSE_MS + 350);
      return () => clearTimeout(t);
    }
    // Unlit: kill any in-flight one-shot AND the show schedule, restore a fresh fuse, fade the
    // aftermath out (instant when pinned or already dark).
    setSparking(false);
    sparkP.value = 0;
    sparkOp.value = 0;
    flashOp.value = 0;
    kickY.value = 0;
    showFlash.value = 0;
    showKick.value = 0;
    warmOp.value = still || warmOp.value < 0.01 ? 0 : withTiming(0, { duration: 420 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  // RE-SYNC RULE, AppState side: we mirror useFireSound's convention (flag on 'background',
  // act on the next 'active'). The OS froze our clocks while backgrounded but the sound layer
  // restarts its 20s clip from 0 on resume, so if the beacon is still lit and focused we drop
  // any in-flight one-shot, settle the aftermath, and restart the show schedule anchored at
  // t=0 (volley included): every layer starts the 20s cycle together.
  useEffect(() => {
    let wasBackgrounded = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wasBackgrounded = true;
        return;
      }
      if (state !== 'active' || !wasBackgrounded) return;
      wasBackgrounded = false;
      if (!litRef.current || !focusedRef.current || reduceRef.current) return;
      setSparking(false);
      cancelAnimation(warmOp);
      cancelAnimation(sparkP);
      cancelAnimation(sparkOp);
      cancelAnimation(flashOp);
      cancelAnimation(kickY);
      sparkP.value = FUSE_MID_P;
      sparkOp.value = 0;
      flashOp.value = 0;
      kickY.value = 0;
      warmOp.value = 1;
      startShowSchedule(false);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    cancelAnimation(warmOp);
    cancelAnimation(sparkP);
    cancelAnimation(sparkOp);
    cancelAnimation(flashOp);
    cancelAnimation(kickY);
    cancelAnimation(showFlash);
    cancelAnimation(showKick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Ground contact shadows seat the rack on the lawn */}
      <Ellipse cx={50} cy={89.5} rx={27} ry={4.4} fill={SHADOW} opacity={0.35} />
      <Ellipse cx={40} cy={90.6} rx={9.5} ry={1.6} fill={SHADOW} opacity={0.5} />
      <Ellipse cx={60} cy={90.6} rx={9.5} ry={1.6} fill={SHADOW} opacity={0.5} />

      {/* Back grass at the tube's base: the patch fringe (char covers the roots when lit) */}
      <Tuft x={41.5} y={81} s={0.8} />
      <Tuft x={59.5} y={81.5} s={0.8} flip />
      <Tuft x={46} y={82.6} s={0.6} flip />

      {/* ===== AFTERMATH GROUND (lit): scorched patch centered on the (50, 78) anchor. No flame
           layer burns here anymore (registry fire 'none'): the char + static embers ARE the
           ground; the live fire is the sparkler up at the fuse's half mark. ===== */}
      {warming && (
        <Fade op={warmOp}>
          <Ellipse cx={50} cy={78.4} rx={13.2} ry={4.2} fill="#141008" opacity={0.85} />
          <Ellipse cx={50} cy={78.4} rx={10.8} ry={3.3} fill={CHAR} opacity={0.95} />
          <Ellipse cx={49.4} cy={78.2} rx={5.6} ry={1.9} fill={ASH} opacity={0.7} />
          {/* irregular char blotches breaking the ring's edge */}
          <Ellipse cx={40.5} cy={79.6} rx={2.4} ry={1} fill={CHAR} opacity={0.8} />
          <Ellipse cx={59} cy={79.2} rx={2.8} ry={1.1} fill={CHAR} opacity={0.8} />
          <Ellipse cx={52.5} cy={81.6} rx={3} ry={1.1} fill={CHAR} opacity={0.7} />
          {/* faint ember bed glow + static glowing flecks */}
          <Ellipse cx={50} cy={78.6} rx={9} ry={2.8} fill={EMBER} opacity={0.08} />
          <Circle cx={44.2} cy={78.9} r={0.5} fill={EMBER} opacity={0.9} />
          <Circle cx={47.5} cy={79.9} r={0.4} fill={EMBER} />
          <Circle cx={47.4} cy={79.8} r={0.2} fill={EMBER_CORE} />
          <Circle cx={54.2} cy={77.6} r={0.45} fill={EMBER} opacity={0.85} />
          <Circle cx={57.8} cy={79.3} r={0.5} fill={EMBER} />
          <Circle cx={57.7} cy={79.2} r={0.22} fill={EMBER_CORE} />
          <Circle cx={50.9} cy={80.6} r={0.35} fill="#E86F28" opacity={0.85} />
          {/* singed blades at the patch edge, two with ember-hot tips */}
          <Path d="M38.5 80.5 C38.1 79.2 38.3 78.2 38.9 77.4" stroke={SINGE} strokeWidth={0.6} strokeLinecap="round" fill="none" />
          <Path d="M62.5 80.2 C62.9 79 62.7 78 62.1 77.2" stroke={SINGE} strokeWidth={0.6} strokeLinecap="round" fill="none" />
          <Path d="M44 81.8 C43.7 81 43.8 80.2 44.3 79.6" stroke="#5C3418" strokeWidth={0.55} strokeLinecap="round" fill="none" />
          <Path d="M56.6 81.9 C56.9 81.1 56.8 80.3 56.3 79.7" stroke="#5C3418" strokeWidth={0.55} strokeLinecap="round" fill="none" />
          <Circle cx={38.9} cy={77.4} r={0.25} fill="#B36A2A" />
          <Circle cx={62.1} cy={77.2} r={0.25} fill="#B36A2A" />
        </Fade>
      )}

      {/* ===== THE RACK + TUBE ASSEMBLY (rides the recoil kicks together: one-shot + show) ===== */}
      <Kick y={kickY} y2={showKick}>
        {/* left upright board: weathered pale wood, grain, knot; cool moonlit outer edge */}
        <Rect x={38.4} y={46} width={4.8} height={41} fill={WOOD} />
        <Rect x={38.4} y={46} width={4.8} height={1.1} fill={WOOD_DK} opacity={0.9} />
        <Line x1={38.5} y1={46.15} x2={43.1} y2={46.15} stroke={WOOD_HI} strokeWidth={0.4} opacity={0.8} />
        <Path d="M39.6 48 C39.4 58 39.9 68 39.5 85" stroke={GRAIN} strokeWidth={0.4} opacity={0.5} fill="none" />
        <Path d="M41.9 47.5 C42.1 58 41.7 70 42 85.5" stroke={GRAIN} strokeWidth={0.4} opacity={0.4} fill="none" />
        <Circle cx={40.9} cy={64.5} r={0.55} fill={GRAIN} opacity={0.55} />
        <Line x1={38.6} y1={46.4} x2={38.6} y2={86.6} stroke={RIM_LEFT} strokeWidth={0.5} opacity={0.22} />
        <Line x1={43} y1={46.4} x2={43} y2={86.6} stroke={WOOD_DK} strokeWidth={0.7} opacity={0.8} />
        {/* right upright board: porch-warm outer edge */}
        <Rect x={56.8} y={46} width={4.8} height={41} fill={WOOD} />
        <Rect x={56.8} y={46} width={4.8} height={1.1} fill={WOOD_DK} opacity={0.9} />
        <Line x1={56.9} y1={46.15} x2={61.5} y2={46.15} stroke={WOOD_HI} strokeWidth={0.4} opacity={0.8} />
        <Path d="M58 47.5 C58.2 58 57.8 70 58.1 85.5" stroke={GRAIN} strokeWidth={0.4} opacity={0.4} fill="none" />
        <Path d="M60.3 48 C60.1 58 60.5 68 60.2 85" stroke={GRAIN} strokeWidth={0.4} opacity={0.5} fill="none" />
        <Circle cx={58.9} cy={57.5} r={0.5} fill={GRAIN} opacity={0.5} />
        <Line x1={61.4} y1={46.4} x2={61.4} y2={86.6} stroke={RIM_RIGHT} strokeWidth={0.5} opacity={0.4} />
        <Line x1={57} y1={46.4} x2={57} y2={86.6} stroke={WOOD_DK} strokeWidth={0.7} opacity={0.8} />
        {/* feet: flat boards on the lawn line (y 87-90.4), end grain darkened */}
        <Rect x={31.5} y={87} width={17.5} height={3.4} fill={WOOD} />
        <Rect x={31.5} y={87} width={1} height={3.4} fill={WOOD_DK} opacity={0.7} />
        <Line x1={31.8} y1={87.3} x2={48.8} y2={87.3} stroke={WOOD_HI} strokeWidth={0.5} opacity={0.7} />
        <Line x1={31.8} y1={90.1} x2={48.8} y2={90.1} stroke={WOOD_DK} strokeWidth={0.8} opacity={0.85} />
        <Rect x={51} y={87} width={17.5} height={3.4} fill={WOOD} />
        <Rect x={67.5} y={87} width={1} height={3.4} fill={WOOD_DK} opacity={0.7} />
        <Line x1={51.2} y1={87.3} x2={68.2} y2={87.3} stroke={WOOD_HI} strokeWidth={0.5} opacity={0.7} />
        <Line x1={51.2} y1={90.1} x2={68.2} y2={90.1} stroke={WOOD_DK} strokeWidth={0.8} opacity={0.85} />

        {/* the HDPE mortar tube: near-black cylinder, muzzle CENTER at exactly (50, 30) */}
        <Rect x={44} y={30} width={12} height={49} fill={HDPE} />
        <Rect x={53.2} y={31.2} width={2.8} height={47.4} fill={HDPE_SH} opacity={0.85} />
        <Rect x={45} y={31.6} width={3.2} height={46.4} fill="#22262C" opacity={0.6} />
        <Rect x={45.9} y={31.8} width={1.3} height={46} fill={HDPE_HI} opacity={0.7} />
        {/* molded band lines + a dim warning-label panel */}
        <Line x1={44.3} y1={44} x2={55.7} y2={44} stroke="#000" strokeWidth={0.4} opacity={0.28} />
        <Line x1={44.3} y1={61.5} x2={55.7} y2={61.5} stroke="#000" strokeWidth={0.4} opacity={0.24} />
        <Rect x={46.8} y={48.6} width={4} height={5.2} fill="#B4B2A6" opacity={0.16} />
        <Line x1={47.4} y1={50} x2={50.2} y2={50} stroke="#D8D6CC" strokeWidth={0.5} opacity={0.16} />
        <Line x1={47.4} y1={51.6} x2={50.2} y2={51.6} stroke="#D8D6CC" strokeWidth={0.5} opacity={0.14} />
        <Line x1={47.4} y1={53.2} x2={49.2} y2={53.2} stroke="#D8D6CC" strokeWidth={0.5} opacity={0.12} />
        {/* rounded base seated between the boards */}
        <Ellipse cx={50} cy={79} rx={6} ry={2} fill={HDPE} />
        <Path d="M44.4 79.2 A5.8 1.9 0 0 0 55.6 79.2" stroke="#000" strokeWidth={0.6} opacity={0.4} fill="none" />
        {/* the muzzle: opening ellipse, inner-wall shadow, cool far-rim highlight, near rim */}
        <Ellipse cx={50} cy={30} rx={6.05} ry={2.3} fill="#23262B" />
        <Ellipse cx={50} cy={30.1} rx={4.8} ry={1.65} fill={MOUTH} />
        <Path d="M45.6 30.6 A4.6 1.5 0 0 0 54.4 30.6" stroke="#1A1E24" strokeWidth={0.7} fill="none" />
        <Path d="M44.5 29.7 A5.85 2.15 0 0 1 55.5 29.7" stroke={RIM_RIGHT} strokeWidth={0.5} opacity={0.45} fill="none" />
        <Path d="M44.6 30.4 A5.9 2.2 0 0 0 55.4 30.4" stroke={RIM} strokeWidth={0.55} opacity={0.8} fill="none" />
        {/* unlit side lights: cool moon left, warm porch right */}
        <Line x1={44.35} y1={32.6} x2={44.35} y2={78} stroke={RIM_LEFT} strokeWidth={0.45} opacity={0.18} />
        <Line x1={55.65} y1={32.8} x2={55.65} y2={78} stroke={RIM_RIGHT} strokeWidth={0.45} opacity={0.32} />

        {/* front cross brace clamping the tube, carriage bolts into each upright */}
        <Rect x={37.6} y={63} width={24.8} height={3.4} fill={WOOD} />
        <Line x1={37.9} y1={63.35} x2={62.1} y2={63.35} stroke={WOOD_HI} strokeWidth={0.55} opacity={0.8} />
        <Line x1={37.9} y1={66} x2={62.1} y2={66} stroke={WOOD_DK} strokeWidth={0.7} opacity={0.85} />
        <Line x1={44} y1={64.8} x2={56} y2={64.7} stroke={GRAIN} strokeWidth={0.35} opacity={0.4} />
        <Circle cx={40.8} cy={64.7} r={0.6} fill={BOLT} />
        <Circle cx={40.65} cy={64.55} r={0.2} fill={RIM_RIGHT} opacity={0.6} />
        <Circle cx={59.2} cy={64.7} r={0.6} fill={BOLT} />
        <Circle cx={59.05} cy={64.55} r={0.2} fill={RIM_RIGHT} opacity={0.6} />

        {/* Lit aftermath on the hardware: muzzle soot + firelight from the patch below */}
        {warming && (
          <Fade op={warmOp}>
            {/* smoke-stained muzzle: sooted rim + streaks licking down the tube */}
            <Path d="M44.5 29.7 A5.85 2.15 0 0 1 55.5 29.7" stroke="#61656D" strokeWidth={0.7} opacity={0.55} fill="none" />
            <Path d="M44.2 30.9 L55.8 30.9 L55.8 34.2 C54 35.8 52.4 34 50.6 35.6 C48.8 37.1 47 34.6 45.6 36 C44.9 36.6 44.4 36 44.2 35.2 Z" fill="#040404" opacity={0.5} />
            {/* (no charred stub at the right lip: the half-burned fuse still exits it whole) */}
            {/* faint underlight from the ember bed (no flame anymore, so it stays low; the
                 sparkler layer adds its own brighter warmth on the right upright) */}
            <Line x1={44.35} y1={58} x2={44.35} y2={77.6} stroke={RIM_FIRE} strokeWidth={0.55} opacity={0.28} />
            <Line x1={55.65} y1={58} x2={55.65} y2={77.6} stroke={RIM_FIRE} strokeWidth={0.55} opacity={0.34} />
            <Path d="M44.6 79 A5.8 1.9 0 0 0 55.4 79" stroke={RIM_FIRE} strokeWidth={0.6} opacity={0.3} fill="none" />
            <Line x1={43.1} y1={64} x2={43.1} y2={86.4} stroke={RIM_FIRE} strokeWidth={0.5} opacity={0.3} />
            <Line x1={56.9} y1={64} x2={56.9} y2={86.4} stroke={RIM_FIRE} strokeWidth={0.5} opacity={0.3} />
            <Line x1={33} y1={87.15} x2={48.5} y2={87.15} stroke={RIM_FIRE} strokeWidth={0.45} opacity={0.22} />
            <Line x1={51.5} y1={87.15} x2={67} y2={87.15} stroke={RIM_FIRE} strokeWidth={0.45} opacity={0.22} />
            <Line x1={38.2} y1={66.15} x2={61.8} y2={66.15} stroke={RIM_FIRE} strokeWidth={0.5} opacity={0.25} />
          </Fade>
        )}

        {/* One-shot muzzle flash at t=1.8: bright ellipse + upward wisp, 150ms */}
        {sparking && (
          <Fade op={flashOp}>
            <Ellipse cx={50} cy={29.8} rx={8.5} ry={3.4} fill="#FFC24A" opacity={0.5} />
            <Ellipse cx={50} cy={29.7} rx={4.6} ry={1.9} fill="#FFF6DC" />
            <Path d="M50 28.6 C48.8 25.2 51.3 22 50.2 17.6" stroke="#FFE4A8" strokeWidth={1.7} strokeLinecap="round" fill="none" opacity={0.85} />
            <Line x1={45.6} y1={28.8} x2={42.9} y2={26.7} stroke="#FFD98E" strokeWidth={0.7} strokeLinecap="round" />
            <Line x1={54.4} y1={28.7} x2={57.1} y2={26.5} stroke="#FFD98E" strokeWidth={0.7} strokeLinecap="round" />
          </Fade>
        )}

        {/* RECURRING show flash: one 150ms pulse per launch of the ongoing 20s show. Unlike the
             intro one-shot it emanates from the muzzle OPENING itself: the mouth ellipse goes
             hot (same rx 4.8 / ry 1.65 as the opening), a halo blooms just past the rim, a wisp
             climbs out, and the lit rim flares. No side sparks: the right lip keeps the
             half-burned fuse readable (the sparkler core down at the fuse's half mark brightens
             on this same pulse instead). */}
        {warming && (
          <Fade op={showFlash}>
            <Ellipse cx={50} cy={29.9} rx={6.6} ry={2.6} fill="#FFC24A" opacity={0.4} />
            <Ellipse cx={50} cy={30.1} rx={4.8} ry={1.65} fill="#FFF6DC" />
            <Path d="M50 28.9 C49.2 25.8 51.2 22.8 50.3 18.9" stroke="#FFE4A8" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.8} />
            <Path d="M44.5 29.7 A5.85 2.15 0 0 1 55.5 29.7" stroke="#FFE9C0" strokeWidth={0.55} opacity={0.75} fill="none" />
          </Fade>
        )}
      </Kick>

      {/* ===== THE VISCO FUSE: muzzle lip down the tube side to its tail on the grass.
           Unlit it waits whole; on the lit edge the dashoffset burns it tail-to-muzzle; the lit
           steady state pins it half-burned (tail half gone, sparkler on the cord end). ===== */}
      <BurnFuse p={sparkP} />

      {/* ===== THE SPARKLER (lit steady state): the show's slow-match sputtering at FUSE_MID,
           the burning end of the half-burned fuse above. Rides the standard warm ramp both in
           (under the launch) and out (extinguish). ===== */}
      {warming && (
        <Fade op={warmOp}>
          <SparklerFire still={reduce || !focused} boost={showFlash} />
        </Fade>
      )}

      {/* Front grass tufts overlapping the rack feet: the rack is planted, nothing floats */}
      <Tuft x={33.5} y={90.8} />
      <Tuft x={45.5} y={91.2} s={0.9} flip />
      <Tuft x={54.5} y={91} s={0.9} />
      <Tuft x={65.5} y={90.6} flip />
      <Tuft x={67.5} y={85.4} s={0.7} />

      {/* One-shot: the spark racing up the fuse on the lit edge (mounted only for the run) */}
      {sparking && <FuseSpark p={sparkP} op={sparkOp} />}
    </Svg>
  );
}
