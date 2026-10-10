// components/scenes/CampfireScene.tsx
// The CAMPFIRE backdrop (behind all tiles): a STORYBOOK moonlit forest clearing, fully procedural
// (no photos). Night-sky gradient with static star specks and a small soft moon high left; three
// receding pine-silhouette treelines (darkest nearest); a dark clearing mound that meets the log
// teepee structure at its anchor. Lightning bugs wander the clearing and blink in randomized
// windows whenever the tab is focused, lit or not; while lit they carry the names of the friends
// going (see LightningBug). Lighting the beacon blooms a warm anchor-aligned glow low over the
// clearing (450ms in, 600ms out) and warms the nearest treeline + ground very slightly. Friend
// tiles sit over the 12..62% band, so that band stays dark and quiet; a top + bottom scrim keeps
// white text legible.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, G, Text as SvgText } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoiseSigned, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';
import type { BeaconSkin } from '../../lib/beaconSkins';
import type { ScenePerson } from './BeaconsScene';

const AnimatedG = Animated.createAnimatedComponent(G);

// Static star specks (fractions of W/H), varied size/opacity, kept clear of the moon (high left).
// Lower ones fade dimmer so the tile band stays quiet.
const STARS = [
  { x: 0.38, y: 0.05, r: 1.2, o: 0.7 }, { x: 0.52, y: 0.09, r: 0.9, o: 0.45 }, { x: 0.66, y: 0.04, r: 1.4, o: 0.8 },
  { x: 0.8, y: 0.08, r: 1.0, o: 0.55 }, { x: 0.92, y: 0.05, r: 1.2, o: 0.7 }, { x: 0.46, y: 0.16, r: 1.0, o: 0.5 },
  { x: 0.6, y: 0.2, r: 0.8, o: 0.35 }, { x: 0.74, y: 0.15, r: 1.1, o: 0.6 }, { x: 0.88, y: 0.19, r: 0.9, o: 0.4 },
  { x: 0.08, y: 0.24, r: 0.9, o: 0.45 }, { x: 0.3, y: 0.27, r: 0.8, o: 0.35 }, { x: 0.55, y: 0.31, r: 0.9, o: 0.3 },
  { x: 0.82, y: 0.33, r: 0.8, o: 0.3 }, { x: 0.17, y: 0.38, r: 0.8, o: 0.25 }, { x: 0.68, y: 0.4, r: 0.8, o: 0.25 },
];

// LIGHTNING BUGS: a field of them wanders the clearing, each blinking on and off in its own
// randomized windows (a hashed cycle length, start, and duration per blink, with some blinks
// skipped), so a few glow at any moment. When the beacon is lit, the friends going take bugs in
// answer order, and a bug carries its person's first name whenever it lights. A friend who
// RALLIED gets a bigger, brighter bug that blinks more often and sometimes flutters quickly.
const BASE_BUGS = 9;
const MAX_BUGS = 14;

/** Hash to 0..1 on the UI thread (also used in JS to lay the bugs out deterministically). */
function h01(n: number): number {
  'worklet';
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** 0..1 brightness of bug `i` at time `t`: randomized on/off windows (see above). */
function bugBlink(t: number, i: number, rally: boolean, named: boolean): number {
  'worklet';
  const L = (3.6 + 4.2 * h01(i * 7.13 + 0.5)) * (rally ? 0.6 : 1);
  const tt = t + h01(i * 3.71 + 0.2) * L; // per-bug phase so they never sync
  const k = Math.floor(tt / L);
  const u = tt - k * L;
  // Skip some blinks entirely (named bugs skip less, so a name keeps coming back).
  if (h01(k * 5.71 + i * 1.93) < (named ? 0.1 : 0.25)) return 0;
  const dur = (1.0 + 1.8 * h01(k * 2.11 + i * 3.37)) * (rally ? 0.85 : 1);
  const st = h01(k * 1.37 + i * 9.13) * Math.max(0.1, L - dur);
  const x = u - st;
  if (x < 0 || x > dur) return 0;
  let b = Math.min(1, x / 0.3) * Math.min(1, (dur - x) / 0.45);
  // A rally bug sometimes flutters: a quick pulse through its glow.
  if (rally && h01(k * 3.31 + i * 1.17) > 0.45) b *= 0.65 + 0.35 * Math.cos(x * 13);
  return b;
}

type BugProps = {
  clock: SharedValue<number>;
  i: number;
  x: number;
  y: number;
  sx: NoiseSeed;
  sy: NoiseSeed;
  label: string;
  rally: boolean;
  still: boolean; // reduced motion: hold steady in place
};

function LightningBug({ clock, i, x, y, sx, sy, label, rally, still }: BugProps) {
  const named = !!label;
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const b = still ? (named ? 0.9 : 0.45) : bugBlink(t, i, rally, named);
    return {
      opacity: b,
      transform: [
        { translateX: x + (still ? 0 : loopNoiseSigned(t, sx, 70)) }, // slow wandering drift
        { translateY: y + (still ? 0 : loopNoiseSigned(t, sy, 46)) },
      ],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={rally ? 17 : 10} fill="url(#cfFly)" />
      <Circle cx={0} cy={0} r={rally ? 3.4 : 2.2} fill="#FFFBD0" />
      {named ? (
        <>
          <SvgText x={0.8} y={21} fontSize={rally ? 13 : 11.5} fontWeight="700" fill="#000" opacity={0.75} textAnchor="middle">{label}</SvgText>
          <SvgText x={0} y={20} fontSize={rally ? 13 : 11.5} fontWeight="700" fill={rally ? '#FFF2A8' : '#EEFFD0'} textAnchor="middle">{label}</SvgText>
        </>
      ) : null}
    </AnimatedG>
  );
}

/** Deterministic layout for n bugs over the clearing band [y0, y1]. */
function layoutBugs(n: number, W: number, y0: number, y1: number) {
  return Array.from({ length: n }, (_, i) => ({
    x: W * (0.07 + 0.86 * h01(i * 3.1 + 1.7)),
    y: y0 + (y1 - y0) * h01(i * 5.3 + 2.9),
    sx: makeSeed(3 + i * 2.3, 5 + i * 1.7, 1.3 + (i % 3) * 0.05, 11 + ((i * 1.9) % 7)),
    sy: makeSeed(7 + i * 1.1, 2 + i * 2.9, 1.35 + (i % 2) * 0.05, 13 + ((i * 2.3) % 6)),
  }));
}

const firstName = (name: string) => {
  const f = (name || '').trim().split(/\s+/)[0] || '';
  return f.length > 10 ? `${f.slice(0, 9)}…` : f;
};

// Deterministic jagged pine treeline: per tree a shoulder, peak, shoulder with valleys at the base,
// closed down to the bottom of the screen so nearer layers stack over farther ones.
function treelinePath(W: number, H: number, base: number, rise: number, trees: number, seed: number): string {
  const rand = (i: number) => {
    const s = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const seg = W / trees;
  let d = `M0 ${H.toFixed(1)} L0 ${base.toFixed(1)}`;
  for (let i = 0; i < trees; i++) {
    const x0 = i * seg;
    const peakX = x0 + seg * (0.35 + rand(i * 3) * 0.3);
    const peakY = base - rise * (0.55 + rand(i * 3 + 1) * 0.45);
    const midY = base - rise * (0.16 + rand(i * 3 + 2) * 0.22);
    d += ` L${(x0 + seg * 0.16).toFixed(1)} ${midY.toFixed(1)} L${peakX.toFixed(1)} ${peakY.toFixed(1)} L${(x0 + seg * 0.84).toFixed(1)} ${midY.toFixed(1)} L${(x0 + seg).toFixed(1)} ${base.toFixed(1)}`;
  }
  d += ` L${W.toFixed(1)} ${H.toFixed(1)} Z`;
  return d;
}

export type CampfireSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
  /** Friends going (answer order): they ride the lightning bugs by name. */
  people?: ScenePerson[];
};

export default function CampfireScene({ skin, active, focused = true, anchorX, anchorY, measured = false, people = [] }: CampfireSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Flame seat: anchor-aligned when measured (clamped so odd layouts can't push the clearing off
  // screen), else a sensible fraction of the window.
  const seatY = measured && anchorY != null ? Math.min(Math.max(anchorY, H * 0.55), H * 0.9) : H * 0.72;
  const seatX = measured && anchorX != null ? anchorX : W * 0.5;
  const structureBottom = seatY + (1 - skin.origin) * 180;

  const geo = useMemo(() => {
    // Treelines recede lighter with distance; the band lands roughly at 55..78% of height when unmeasured.
    const far = treelinePath(W, H, seatY - H * 0.1, H * 0.085, 18, 5.1);
    const mid = treelinePath(W, H, seatY - H * 0.04, H * 0.095, 12, 11.7);
    const near = treelinePath(W, H, seatY + H * 0.02, H * 0.11, 8, 23.3);
    // Clearing ground: a gentle mound cresting under the structure so the logs sit on it.
    const crestY = Math.min(structureBottom - 24, H * 0.92);
    const edgeY = Math.min(crestY + H * 0.035, H);
    const mound = `M0 ${H.toFixed(1)} L0 ${edgeY.toFixed(1)} Q ${seatX.toFixed(1)} ${(2 * crestY - edgeY).toFixed(1)} ${W.toFixed(1)} ${edgeY.toFixed(1)} L${W.toFixed(1)} ${H.toFixed(1)} Z`;
    return { far, mid, near, mound };
  }, [W, H, seatX, seatY, structureBottom]);

  // The bug field: at least BASE_BUGS, more when more friends are going (up to MAX_BUGS), wandering
  // the clearing between the tile band and the treetops above the structure.
  const bugCount = Math.min(MAX_BUGS, Math.max(BASE_BUGS, people.length));
  const bugs = useMemo(
    () => layoutBugs(bugCount, W, H * 0.42, Math.max(H * 0.5, seatY - 40)),
    [bugCount, W, H, seatY]
  );

  // Scene clock for the bugs (shared gated clock: registered + paused while gated off); they
  // wander whether the beacon is lit or not (gated on focus so the clock pauses off-tab).
  const { clock } = useGatedClock(!reduce && focused);

  // Firelight: blooms low over the clearing when lit, fades when doused. Starts at the lit state so
  // mounting with active=true renders lit without replaying the ignition.
  const glowOp = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (reduce) { glowOp.value = active ? 1 : 0; return; }
    glowOp.value = withTiming(active ? 1 : 0, { duration: active ? 450 : 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  const glowProps = useAnimatedProps(() => ({ opacity: glowOp.value }));
  const warmProps = useAnimatedProps(() => ({ opacity: glowOp.value * 0.5 }));
  useEffect(() => () => { cancelAnimation(glowOp); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          <LinearGradient id="cfSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0A1730" /><Stop offset="100%" stopColor="#12264A" />
          </LinearGradient>
          <RadialGradient id="cfMoon" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF6DC" stopOpacity={0.55} /><Stop offset="45%" stopColor="#E9E6C9" stopOpacity={0.18} /><Stop offset="100%" stopColor="#E9E6C9" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cfFly" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cfGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.5} /><Stop offset="55%" stopColor={skin.glow.edge} stopOpacity={0.2} /><Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          {/* warm wash localized around the fire seat, painted into the near treeline + ground */}
          <RadialGradient id="cfWarm" gradientUnits="userSpaceOnUse" cx={seatX} cy={seatY} r={W * 0.55}>
            <Stop offset="0%" stopColor="#FF9E4A" stopOpacity={0.5} /><Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.14} /><Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: darken top (status/tiles) and bottom (buttons), middle clearest. */}
          <LinearGradient id="cfScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} /><Stop offset="22%" stopColor="#000" stopOpacity={0} /><Stop offset="78%" stopColor="#000" stopOpacity={0} /><Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* night sky + static stars */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#cfSky)" />
        {STARS.map((st, i) => (
          <Circle key={`cfs${i}`} cx={W * st.x} cy={H * st.y} r={st.r} fill="#EAF0FF" opacity={st.o} />
        ))}
        {/* small soft full moon, high left, with a gentle halo; three barely-there maria blotches
            (0.08 opacity) so it reads as a moon rather than a plain disc, storybook-soft */}
        <Circle cx={W * 0.18} cy={H * 0.09} r={58} fill="url(#cfMoon)" />
        <Circle cx={W * 0.18} cy={H * 0.09} r={15} fill="#F4EFDC" opacity={0.95} />
        <Circle cx={W * 0.18 - 4.5} cy={H * 0.09 - 3.5} r={4.8} fill="#6B7488" opacity={0.08} />
        <Circle cx={W * 0.18 + 4} cy={H * 0.09 + 1.5} r={3.6} fill="#6B7488" opacity={0.08} />
        <Circle cx={W * 0.18 - 1.5} cy={H * 0.09 + 6.5} r={2.4} fill="#6B7488" opacity={0.08} />

        {/* pine treelines, receding lighter with distance, then the clearing ground */}
        <Path d={geo.far} fill="#123052" />
        <Path d={geo.mid} fill="#0D1B30" />
        <Path d={geo.near} fill="#0A1526" />
        <Path d={geo.mound} fill="#0B1D22" />

        {/* lit: very slight warm on the nearest silhouettes, then the firelight bloom itself */}
        <AnimatedG animatedProps={warmProps}>
          <Path d={geo.near} fill="url(#cfWarm)" />
          <Path d={geo.mound} fill="url(#cfWarm)" />
        </AnimatedG>
        <AnimatedG animatedProps={glowProps}>
          <Ellipse cx={seatX} cy={seatY + 34} rx={W * 0.44} ry={110} fill="url(#cfGlow)" />
        </AnimatedG>

        {/* scrim over everything so tiles/text stay legible */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#cfScrim)" />

        {/* lightning bugs over the clearing (lit or not), ABOVE the scrim so they and the names
            they carry stay bright; the friends going ride them in answer order */}
        {bugs.map((b, i) => (
          <LightningBug
            key={`cfb${i}`}
            clock={clock}
            i={i}
            x={b.x}
            y={b.y}
            sx={b.sx}
            sy={b.sy}
            label={i < people.length ? firstName(people[i].name) : ''}
            rally={i < people.length && people[i].rally === true}
            still={!!reduce}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  base: { backgroundColor: '#05070C' },
});
