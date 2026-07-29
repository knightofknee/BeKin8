// components/structures/BonfirePyre.tsx
// The Bonfire STRUCTURE and tap target, round 4: a BIG WOODEN COUNTRY PYRE that reads as fuel at
// a glance. What sells "bonfire" (research + hard-won user verdicts): BROWN logs with bark tones
// and visible cut ends, a wide criss-crossed cone over stacked base courses, kindling at the
// foot, and the whole thing planted on the ground. No outlines-on-navy, no crate geometry.
//
// TIMING CONTRACT (t=0 = the lit edge, shared with BeaconFireSkia delayMs 900 + the ignite clip):
//   0.00-0.90s  the thrown TORCH (wood-toned) arcs in from the right into the pyre's flank
//   0.90s       the Skia flame springs up (+ shockwave + shake) and this pyre's heat overlay
//               (hot rims + glowing gaps between logs) ramps in
// Cold-mounting already-lit, reduced motion, and blurred all skip the torch and jump to steady.
//
// FLAME SEAT: registry origin 0.78 (y=78), inside the stacked base courses. Cone-from-wood: the
// wood spans ~57+ viewBox units (~103px+) at the seat, matching the flame base (1.74 * width .24
// * 170 * scale 1.45 ≈ 103px); the leaning cone above the seat burns inside the flame.
// Authored 0..100; 180x180 box.
import React, { useEffect, useRef, useState } from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../../lib/beaconNoise';
import { useGatedClock } from '../../lib/useGatedClock';

const AnimatedG = Animated.createAnimatedComponent(G);

// Wood palette: warm bark browns under a low sun, dark bark outlines, tan cut faces.
const BARK_DK = '#4A2E18';
const BARK = '#6B4226';
const BARK_LT = '#7E5230';
const BARK_WARM = '#8A5A34';
const OUTLINE = '#33200F';
const CUT_FACE = '#C89A6A';
const CUT_RING = '#8A5C33';
const GRAIN = '#3A2412';
const RIM_HOT = '#FF8A2A';
const SLIVER = '#FFC46A';
const SLIVER_CORE = '#FFEFC2';

const TORCH_MS = 900;

// The leaning cone: logs hung from the apex lash point (50,33), bases swinging wide. Drawn in two
// passes (back pair first) so the criss-cross reads with depth.
type ConeLog = { rot: number; x: number; y: number; w: number; h: number; fill: string; front: boolean };
const CONE: ConeLog[] = [
  { rot: -36, x: 46.8, y: 30, w: 6.4, h: 62, fill: BARK_DK, front: false },
  { rot: 36, x: 46.8, y: 30, w: 6.4, h: 62, fill: BARK_DK, front: false },
  { rot: -24, x: 46.5, y: 29, w: 7, h: 63, fill: BARK, front: false },
  { rot: 24, x: 46.5, y: 29, w: 7, h: 63, fill: BARK_LT, front: false },
  { rot: -13, x: 46.2, y: 28, w: 7.6, h: 64, fill: BARK_LT, front: true },
  { rot: 13, x: 46.2, y: 28, w: 7.6, h: 64, fill: BARK, front: true },
  { rot: -4, x: 46.4, y: 27.5, w: 7.2, h: 64, fill: BARK_WARM, front: true },
];

// Ringed cut end: tan face + growth ring, the instant "this is a sawn log" cue.
function cut(cx: number, cy: number, r: number) {
  return (
    <G key={`c${cx}-${cy}`}>
      <Circle cx={cx} cy={cy} r={r} fill={CUT_FACE} stroke={OUTLINE} strokeWidth={1.1} />
      <Circle cx={cx} cy={cy} r={r * 0.5} fill="none" stroke={CUT_RING} strokeWidth={0.8} />
    </G>
  );
}

// The torch's thrown arc (the keeper across rounds), retargeted to the pyre's flank.
const torchX = (p: number) => {
  'worklet';
  return 112 - 56 * p;
};
const torchY = (p: number) => {
  'worklet';
  return 50 - 26 * Math.sin(Math.PI * p) + 26 * p * p;
};

function TorchFlight({ torchP }: { torchP: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const p = torchP.value;
    const flying = p > 0.005 && p < 0.985;
    return {
      opacity: flying ? 1 : 0,
      transform: [
        { translateX: torchX(p) },
        { translateY: torchY(p) },
        { rotate: `${-30 - 260 * p}deg` },
      ],
    };
  });
  // Wood-toned to match the pyre: bark stick, orange flame head with a warm core.
  return (
    <AnimatedG animatedProps={props}>
      <Rect x={-1} y={-0.5} width={2} height={7.4} rx={1} fill={BARK} stroke={OUTLINE} strokeWidth={0.7} />
      <Path d="M0 -6 C2.1 -3.8 2.4 -1.9 0 -0.3 C-2.4 -1.9 -2.1 -3.8 0 -6 Z" fill={RIM_HOT} />
      <Path d="M0 -4.3 C1 -3 1.1 -1.9 0 -1 C-1.1 -1.9 -1 -3 0 -4.3 Z" fill={SLIVER_CORE} />
    </AnimatedG>
  );
}

// Front fire, drawn OVER the front logs while burning: the other half of the sandwich. The main
// flame body (BeaconBonfireFlame) renders BEHIND the whole structure; the front is a continuous
// low BED SHEET of flame running along the base courses with a few wider licks growing out of
// it, all sharing one breath noise with small per-lick character, so front and back read as ONE
// fire the wood sits inside, never separate dancers.
const FRONT_BREATH = makeSeed(6.2, 3.8, 1.3, 4.3);

type LickCfg = { dx: number; hw: number; h: number; curl: number; sy: NoiseSeed; rot: NoiseSeed };
const LICKS: LickCfg[] = [
  { dx: -15, hw: 8.5, h: 34, curl: -1, sy: makeSeed(3.7, 9.2, 1.3, 4.9), rot: makeSeed(8.1, 2.6, 1.1, 6.1) },
  { dx: 2, hw: 10, h: 44, curl: 1, sy: makeSeed(11.3, 5.8, 1.3, 3.7), rot: makeSeed(4.4, 12.1, 1.1, 5.3) },
  { dx: 17, hw: 7.5, h: 28, curl: 1, sy: makeSeed(7.9, 10.4, 1.3, 5.9), rot: makeSeed(12.6, 3.3, 1.1, 4.7) },
];

function lickPath(hw: number, h: number, curl: number): string {
  const c = curl * hw * 0.5;
  return (
    `M ${-hw} 0 C ${-hw * 0.9} ${-h * 0.45} ${c - hw * 0.2} ${-h * 0.7} ${c} ${-h}` +
    ` C ${c + hw * 0.2} ${-h * 0.7} ${hw * 0.9} ${-h * 0.45} ${hw} 0 Z`
  );
}

// The continuous flame sheet along the fuel bed: a wavy crown spanning the base courses.
const BED_PATH =
  'M -29 0 C -25 -9 -20 -5 -15 -12 C -10 -5 -5 -11 0 -15 C 4 -8 9 -13 14 -7 C 19 -12 24 -6 29 0 Z';
const BED_CORE_PATH =
  'M -20 0 C -16 -6 -12 -4 -8 -8 C -4 -3 0 -9 4 -5 C 8 -8 13 -4 20 0 Z';

function FrontBed({
  clock, heat, still,
}: { clock: SharedValue<number>; heat: SharedValue<number>; still: boolean }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const breath = still ? 0.5 : loopNoise(t, FRONT_BREATH);
    return {
      opacity: heat.value * (0.92 + 0.08 * breath),
      transform: [
        { translateX: 50 },
        { translateY: 85 },
        { scaleY: heat.value * (0.85 + 0.25 * breath) },
      ],
    };
  }, [still]);
  return (
    <AnimatedG animatedProps={props}>
      <Path d={BED_PATH} fill="url(#bpLick)" />
      <Path d={BED_CORE_PATH} fill="url(#bpLickCore)" />
    </AnimatedG>
  );
}

function FrontLick({
  clock, heat, cfg, still,
}: { clock: SharedValue<number>; heat: SharedValue<number>; cfg: LickCfg; still: boolean }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const breath = still ? 0.5 : loopNoise(t, FRONT_BREATH); // shared with the bed: one fire
    const own = still ? 0.5 : loopNoise(t, cfg.sy);
    const sway = still ? 0 : loopNoiseSigned(t, cfg.rot, 3);
    return {
      opacity: heat.value * (0.88 + 0.12 * own),
      transform: [
        { translateX: 50 + cfg.dx },
        { translateY: 84 },
        { rotate: `${sway}deg` },
        { scaleY: heat.value * (0.8 + 0.18 * breath + 0.18 * (own - 0.5) * 2) },
      ],
    };
  }, [still]);
  return (
    <AnimatedG animatedProps={props}>
      <Path d={lickPath(cfg.hw, cfg.h, cfg.curl)} fill="url(#bpLick)" />
      <Path d={lickPath(cfg.hw * 0.55, cfg.h * 0.62, cfg.curl)} fill="url(#bpLickCore)" />
    </AnimatedG>
  );
}

// Glowing gaps between logs while burning: fire seen THROUGH the wood (never a glow ball).
const SLIVERS = [
  { cx: 42, cy: 68, w: 11, h: 2.6, rot: -8 },
  { cx: 58, cy: 72.5, w: 10, h: 2.4, rot: 7 },
  { cx: 45, cy: 80.5, w: 13, h: 2.8, rot: -4 },
  { cx: 59, cy: 86, w: 11, h: 2.6, rot: 3 },
] as const;

function HeatGlow({ heat }: { heat: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ opacity: heat.value }));
  return (
    <AnimatedG animatedProps={props}>
      {SLIVERS.map((s) => (
        <G key={`s${s.cx}`} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`}>
          <Rect x={s.cx - s.w / 2} y={s.cy - s.h / 2} width={s.w} height={s.h} rx={s.h / 2} fill={SLIVER} />
          <Rect x={s.cx - s.w * 0.28} y={s.cy - s.h * 0.25} width={s.w * 0.56} height={s.h * 0.5} rx={s.h * 0.25} fill={SLIVER_CORE} />
        </G>
      ))}
      {/* hot rim light on the front logs' upper edges */}
      {CONE.filter((l) => l.front).map((l) => (
        <G key={`r${l.rot}`} transform={`rotate(${l.rot} 50 33)`}>
          <Line
            x1={l.x + 0.8}
            y1={l.y + 3}
            x2={l.x + 0.8}
            y2={l.y + l.h * 0.62}
            stroke={RIM_HOT}
            strokeWidth={1.1}
            strokeLinecap="round"
            opacity={0.9}
          />
        </G>
      ))}
      <Line x1={18} y1={77.2} x2={82} y2={77.2} stroke={RIM_HOT} strokeWidth={1} strokeLinecap="round" opacity={0.85} />
    </AnimatedG>
  );
}

export default function BonfirePyre({ size = 180, lit = false, focused = true }: { size?: number; lit?: boolean; focused?: boolean }) {
  const reduce = useReducedMotion();
  const heat = useSharedValue(lit ? 1 : 0);
  const torchP = useSharedValue(0);
  const prevLitRef = useRef(lit);
  const { clock } = useGatedClock(lit && focused && !reduce);

  const [blazing, setBlazing] = useState(lit);
  useEffect(() => {
    if (lit) {
      setBlazing(true);
      return;
    }
    const t = setTimeout(() => setBlazing(false), 460);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    const wasLit = prevLitRef.current;
    prevLitRef.current = lit;
    const justLit = lit && !wasLit;
    const still = reduce || !focused;
    cancelAnimation(heat);
    cancelAnimation(torchP);
    if (lit) {
      if (justLit && !still) {
        torchP.value = 0;
        torchP.value = withTiming(1, { duration: TORCH_MS, easing: Easing.linear });
        heat.value = withDelay(TORCH_MS, withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }));
      } else {
        torchP.value = 0;
        heat.value = still ? 1 : withTiming(1, { duration: 280 });
      }
    } else {
      torchP.value = 0;
      heat.value = still ? 0 : withTiming(0, { duration: 380 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(
    () => () => {
      cancelAnimation(heat);
      cancelAnimation(torchP);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="bpLick" x1="0" y1="1" x2="0" y2="0">
          <Stop offset={0} stopColor="#FFB347" />
          <Stop offset={1} stopColor="#FF6A14" />
        </LinearGradient>
        <LinearGradient id="bpLickCore" x1="0" y1="1" x2="0" y2="0">
          <Stop offset={0} stopColor="#FFF4D0" />
          <Stop offset={1} stopColor="#FFC23D" />
        </LinearGradient>
      </Defs>
      {/* grounded: a soft warm shadow where the pyre meets the dirt (the scene's ground plane
          runs flush under this box) */}
      <Ellipse cx={50} cy={93} rx={41} ry={4} fill={GRAIN} opacity={0.3} />

      {/* leaning cone, back logs */}
      {CONE.filter((l) => !l.front).map((l) => (
        <G key={`b${l.rot}`} transform={`rotate(${l.rot} 50 33)`}>
          <Rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.w / 2} fill={l.fill} stroke={OUTLINE} strokeWidth={1.1} />
        </G>
      ))}

      {/* criss-cross branches through the mid: the untidy fuel-pile read */}
      <G transform="rotate(28 50 62)">
        <Rect x={22} y={60.8} width={56} height={2.4} rx={1.2} fill={BARK_DK} stroke={OUTLINE} strokeWidth={0.7} />
      </G>
      <G transform="rotate(-31 50 66)">
        <Rect x={20} y={64.8} width={60} height={2.6} rx={1.3} fill={BARK} stroke={OUTLINE} strokeWidth={0.7} />
      </G>

      {/* stacked base courses (the wide fuel bed the flame seat lives in) */}
      <Rect x={20} y={77.5} width={60} height={7.5} rx={3.75} fill={BARK_LT} stroke={OUTLINE} strokeWidth={1.1} />
      <Line x1={26} y1={82.8} x2={74} y2={82.8} stroke={GRAIN} strokeWidth={0.7} opacity={0.6} />
      <Rect x={14} y={84.5} width={72} height={8} rx={4} fill={BARK} stroke={OUTLINE} strokeWidth={1.1} />
      <Line x1={20} y1={90.4} x2={80} y2={90.4} stroke={GRAIN} strokeWidth={0.7} opacity={0.6} />

      {/* leaning cone, front logs over the courses */}
      {CONE.filter((l) => l.front).map((l) => (
        <G key={`f${l.rot}`} transform={`rotate(${l.rot} 50 33)`}>
          <Rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.w / 2} fill={l.fill} stroke={OUTLINE} strokeWidth={1.1} />
          <Line x1={l.x + l.w / 2} y1={l.y + 5} x2={l.x + l.w / 2} y2={l.y + l.h - 8} stroke={GRAIN} strokeWidth={0.6} opacity={0.5} />
        </G>
      ))}

      {/* ringed cut ends on the base courses */}
      {cut(23, 81.25, 3.9)}
      {cut(77, 81.25, 3.9)}
      {cut(17.5, 88.5, 4.2)}
      {cut(82.5, 88.5, 4.2)}

      {/* kindling scattered at the foot */}
      <G transform="rotate(9 27 91.6)">
        <Rect x={20} y={90.8} width={14} height={1.8} rx={0.9} fill={BARK_DK} />
      </G>
      <G transform="rotate(-7 73 92.2)">
        <Rect x={66} y={91.4} width={15} height={1.9} rx={0.95} fill={BARK_DK} />
      </G>

      {/* lit: glowing gaps + hot rims + the front SHEET of the fire (bed + licks) OVER the wood.
          The main flame body burns behind the whole structure, so the pyre is inside the fire. */}
      {blazing && <HeatGlow heat={heat} />}
      {blazing && <FrontBed clock={clock} heat={heat} still={reduce} />}
      {blazing && LICKS.map((cfg, i) => (
        <FrontLick key={`lk${i}`} clock={clock} heat={heat} cfg={cfg} still={reduce} />
      ))}
      {blazing && !reduce && <TorchFlight torchP={torchP} />}
    </Svg>
  );
}
