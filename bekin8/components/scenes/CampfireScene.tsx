// components/scenes/CampfireScene.tsx
// The CAMPFIRE backdrop (behind all tiles): a STORYBOOK forest clearing at night, PAINTED
// (art/in/campfire-bg.png via art/build_skins.py): big framing trees, a dim receding forest, and a
// patch of trodden earth that the log fire stands on. Drawn here: the lightning bugs and the
// firelight. Lightning bugs roam the whole screen and blink in randomized windows whenever the tab
// is focused, lit or not; while lit they carry the names of the friends going (see LightningBug).
// Lighting the beacon blooms a warm glow low over the clearing (450ms in, 600ms out) and warms the
// trunks and ground around it. A top + bottom scrim keeps white text legible.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, G, Text as SvgText } from 'react-native-svg';
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
import { campfireArt } from './paintedArt';
import { PaintedBackdrop, paintedLayout } from './PaintedBackdrop';

const AnimatedG = Animated.createAnimatedComponent(G);

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
  /** The long flight: slow seeds + how far (px) it carries the bug from its home point. */
  rx: NoiseSeed;
  ry: NoiseSeed;
  ax: number;
  ay: number;
  label: string;
  rally: boolean;
  still: boolean; // reduced motion: hold steady in place
};

function LightningBug({ clock, i, x, y, sx, sy, rx, ry, ax, ay, label, rally, still }: BugProps) {
  const named = !!label;
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const b = still ? (named ? 0.9 : 0.45) : bugBlink(t, i, rally, named);
    return {
      opacity: b,
      transform: [
        // Two motions added together: a long slow flight that carries the bug anywhere on the
        // screen, and the small quick wander of an insect that never flies straight.
        { translateX: x + (still ? 0 : loopNoiseSigned(t, rx, ax) + loopNoiseSigned(t, sx, 26)) },
        { translateY: y + (still ? 0 : loopNoiseSigned(t, ry, ay) + loopNoiseSigned(t, sy, 18)) },
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

/** Deterministic layout for n bugs. Each has a home point in the middle third of the band
 *  [y0, y1] and a long flight (rx/ry over ax/ay) that takes it across the whole band. */
function layoutBugs(n: number, W: number, y0: number, y1: number) {
  return Array.from({ length: n }, (_, i) => ({
    x: W * (0.3 + 0.4 * h01(i * 3.1 + 1.7)),
    y: y0 + (y1 - y0) * (0.35 + 0.3 * h01(i * 5.3 + 2.9)),
    // Long, mutually prime-ish periods (38..71s): no two bugs ever fly in step, and a crossing
    // takes many seconds, so a name riding a bug stays readable.
    rx: makeSeed(11 + i * 3.7, 2 + i * 1.3, 1.6, 38 + ((i * 7.3) % 33)),
    ry: makeSeed(5 + i * 2.1, 9 + i * 3.3, 1.6, 43 + ((i * 5.9) % 27)),
    ax: W * 0.62,
    ay: (y1 - y0) * 0.72,
    sx: makeSeed(3 + i * 2.3, 5 + i * 1.7, 1.3 + (i % 3) * 0.05, 11 + ((i * 1.9) % 7)),
    sy: makeSeed(7 + i * 1.1, 2 + i * 2.9, 1.35 + (i % 2) * 0.05, 13 + ((i * 2.3) % 6)),
  }));
}

const firstName = (name: string) => {
  const f = (name || '').trim().split(/\s+/)[0] || '';
  return f.length > 10 ? `${f.slice(0, 9)}…` : f;
};

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

  // The painted clearing, placed so its trodden earth sits under the logs.
  const L = paintedLayout(campfireArt, skin, W, H, anchorX, anchorY, measured);
  const seatX = L.ax;
  const seatY = L.seatY;

  // The bug field: at least BASE_BUGS, more when more friends are going (up to MAX_BUGS), wandering
  // the clearing between the tile band and the treetops above the structure.
  const bugCount = Math.min(MAX_BUGS, Math.max(BASE_BUGS, people.length));
  const bugs = useMemo(
    () => layoutBugs(bugCount, W, H * 0.13, Math.max(H * 0.5, seatY - 30)),
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
          <RadialGradient id="cfFly" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="cfGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={skin.glow.center} stopOpacity={0.5} /><Stop offset="55%" stopColor={skin.glow.edge} stopOpacity={0.2} /><Stop offset="100%" stopColor={skin.glow.edge} stopOpacity={0} />
          </RadialGradient>
          {/* warm wash localized around the fire seat, painted into the near treeline + ground */}
          <RadialGradient id="cfWarm" gradientUnits="userSpaceOnUse" cx={seatX} cy={seatY} r={W * 0.8}>
            <Stop offset="0%" stopColor="#FF9E4A" stopOpacity={0.5} /><Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.14} /><Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} />
          </RadialGradient>
          {/* Legibility scrim: darken top (status/tiles) and bottom (buttons), middle clearest. */}
          <LinearGradient id="cfScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} /><Stop offset="22%" stopColor="#000" stopOpacity={0} /><Stop offset="78%" stopColor="#000" stopOpacity={0} /><Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        <PaintedBackdrop art={campfireArt} layout={L} W={W} H={H} />

        {/* lit: firelight warms the clearing and the nearest trunks, then the bloom itself */}
        <AnimatedG animatedProps={warmProps}>
          <Rect x={0} y={0} width={W} height={H} fill="url(#cfWarm)" />
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
            rx={b.rx}
            ry={b.ry}
            ax={b.ax}
            ay={b.ay}
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
