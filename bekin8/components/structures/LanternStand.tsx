// components/structures/LanternStand.tsx
// The Sky Lanterns skin's tap target: a khom loi PAPER LANTERN on its bamboo stand at the edge of
// a Ping River dock (Yi Peng, Chiang Mai). Research-true build: the lantern is a tall sa-paper
// CYLINDER with a DOMED top, about 2:1 height to width (the classic Thai ~1m x 0.5m), faint
// vertical crumple lines in the paper, an exposed bamboo mouth RING at the bottom opening, and the
// dark FUEL CELL (a wax block wired onto crossed bamboo) visible in the mouth. It hangs by a short
// cord from a leaning bamboo shepherd's-crook pole (node lines, tip curled over), and beside the
// stand a small CLAY FUEL POT cradled in a low bamboo tripod holds the lighting flame. Stand feet
// sit on the dock at y ~88; the lantern BODY CENTER is at exactly (50, 40), the registry's origin
// 0.40 anchor, so the shader hero rises from precisely where the paper body was.
// Unlit: pure static. Pale paper silhouette against the river night, cool moon rim from camera
// LEFT, a faint warm underlight on the lower right from the far bank's festival lights (the scene
// puts the temple and lights camera RIGHT). Nothing pulses.
// LIT-EDGE ONE-SHOT (prevLit ref, FireworkRocket pattern), 3.2s total, matched to the ignite clip
// and the shader hero's 3.0s handoff:
//   t 0.0-0.4  the fuel pot catches (pot flame ramps in) and a small flame appears at the
//              lantern's fuel cell (tiny warm stroke flames, no glow balls);
//   t 0.4-2.4  the shell WARMS AND SWELLS: an interior amber wash climbs the paper (a bright
//              mouth band first, then a full vertical gradient wash, brightest at the mouth)
//              while the body inflates 0.97 -> 1.03 around its center with a gentle hanging sway;
//   t 2.4-2.8  the TUG: it strains upward 2.6 viewBox units (the research's tactile release cue:
//              "the lantern pulls upward on your arms");
//   t 2.8-3.2  RELEASE: it accelerates upward out of the box, fading as it crosses the top edge,
//              and the cord slips free. The shader hero appears at u_time 3.0 rising from the
//              (50, 40) anchor at a similar ~20px size and tone, so the crossfade reads as the
//              same lantern leaving the stand.
// LIT STEADY STATE (also first-mount-lit, reduced motion, and blur): the lantern is GONE, it
// launched. What remains is the stand: the crook pole with its SLACK cord dangling, the fuel pot
// burning with 3 small flickering flame strokes (incommensurate flicker periods, the FireworkRocket
// sparkler convention) whose warmth lands as rim strokes on the NEAREST bamboo edges only (the
// tripod legs and the pot rim, plus a whisper on the pole base), and a second FOLDED flat lantern
// leaning at the stand's base: the next wish. The burning pot is the readable lit cue and the
// extinguish tap target.
// EXTINGUISH: the pot flame and the after-launch props fade out and the hanging lantern fades
// back onto the crook, 600ms, quiet.
// REDUCED MOTION / BLUR: static states only. Lit pins the pot flame at a mid-intensity frame (no
// launch one-shot, no flicker loops); unlit is the static hanging lantern.
// Authored 0..100; 180x180 footprint. Fixed hook count: conditional layers mount via state and
// all animated hooks live in stable subcomponents.
import React, { useEffect, useRef, useState } from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  cancelAnimation,
  interpolate,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);

// Sa-paper: warm cream, moon-cool left shade, festival-warm right band
const PAPER = '#EFE3C6';
const PAPER_DK = '#B9A47C';
const PAPER_WARM = '#E4C695';
const CRUMPLE = '#B9A57E';
// Bamboo: sun-dried culm, dark nodes, pale sheen
const BAMBOO = '#8F7C4F';
const BAMBOO_DK = '#5C4F30';
const BAMBOO_HI = '#C2AE78';
const NODE = '#453A22';
const CORD = '#C9B98C';
// Clay fuel pot
const CLAY = '#7A4A32';
const CLAY_DK = '#4A2A1C';
const CLAY_HI = '#A96A48';
const OIL = '#1A0F08';
// Flames: candle-warm strokes only (standing rule: no radial glow balls)
const FLAME_GOLD = '#FFD98C';
const FLAME_HOT = '#FFF3C8';
const FLAME_ORANGE = '#FFB347';
// Unlit readability: the moon fills from camera LEFT (cool), the far bank's festival lights sit
// camera RIGHT (warm). Side-named so the light assignment cannot silently flip.
const RIM_LEFT = '#C7D2E0';
const RIM_RIGHT = '#E8B978';
const RIM_FIRE = '#FFB35C';
const SHADOW = '#0E1220';

// The lantern body: domed top, straight cylinder sides, taper to the bamboo mouth ring. Body
// center is EXACTLY (50, 40): top y 13.5, mouth y 65.8, width 26.
const BODY_D =
  'M37 25 C37 17.5 42.5 13.5 50 13.5 C57.5 13.5 63 17.5 63 25 L63 57.5 C63 61.5 60.5 64.2 57 65.6 L43 65.6 C39.5 64.2 37 61.5 37 57.5 Z';
// Lower-third band used by the early mouth wash (the wash climbs: mouth band first, full later).
const MOUTH_BAND_D =
  'M37.6 50 L62.4 50 L62.4 57.5 C62.4 61 60.2 63.6 56.8 65 L43.2 65 C39.8 63.6 37.6 61 37.6 57.5 Z';
// The bamboo crook pole: planted at (73, 88.5), leaning up and left, tip curled back down.
const POLE_D = 'M73 88.5 C72.2 72 69 40 61 21 C57.6 12.8 52.6 6.6 48.8 7.6 C47.6 7.9 47.2 8.9 47.6 10';

// One-shot clock (ms from the lit edge; the ignite clip is authored to this exact line: match
// strike + catch 0-400, paper flutter 400-2400, hush 2400-2800, lift puff + pop 2800-3400).
const CATCH_MS = 400;
const TUG_AT_MS = 2400;
const RELEASE_AT_MS = 2800;
const ONE_SHOT_MS = 3200;
const SIN = Easing.inOut(Easing.sin);

// Opacity crossfade group (CampfireLogs / FireworkRocket pattern).
function Fade({ op, children }: { op: SharedValue<number>; children: React.ReactNode }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// The hanging lantern's whole transform stack in one group: lift (translateY), hanging sway
// (rotation about the cord attachment (50, 12)) and the inflate (scale about the body center
// (50, 40)), plus the crossfade opacity. RN-style transform arrays, FireworkRocket convention.
function LanternG({
  op,
  lift,
  sway,
  swell,
  children,
}: {
  op: SharedValue<number>;
  lift: SharedValue<number>;
  sway: SharedValue<number>;
  swell: SharedValue<number>;
  children: React.ReactNode;
}) {
  const props = useAnimatedProps(() => ({
    opacity: op.value,
    transform: [
      { translateY: lift.value },
      { translateX: 50 },
      { translateY: 12 },
      { rotate: `${sway.value}deg` },
      { translateX: -50 },
      { translateY: -12 },
      { translateX: 50 },
      { translateY: 40 },
      { scale: swell.value },
      { translateX: -50 },
      { translateY: -40 },
    ],
  }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

// ===== THE FUEL POT FLAME (lit steady state) =====
// Three small flame strokes over the clay pot's oil cup, flickering on three incommensurate
// opacity loops (620 / 730 / 810ms totals, the sparkler convention) plus a gentle core wobble.
// Warmth lands as rim strokes on the NEAREST bamboo edges only: the tripod legs, the pot rim, and
// a whisper on the pole base across the dock. `still` (reduced motion or blur) cancels the loops
// and pins a static mid-intensity flame.
function PotFlame({ still }: { still: boolean }) {
  const coreK = useSharedValue(0.9);
  const fA = useSharedValue(1);
  const fB = useSharedValue(0.4);
  const fC = useSharedValue(0.7);

  useEffect(() => {
    cancelAnimation(coreK);
    cancelAnimation(fA);
    cancelAnimation(fB);
    cancelAnimation(fC);
    if (still) {
      coreK.value = 0.9;
      fA.value = 1;
      fB.value = 0.4;
      fC.value = 0.7;
      return;
    }
    coreK.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 240, easing: SIN }),
        withTiming(0.78, { duration: 330, easing: SIN }),
        withTiming(0.9, { duration: 290, easing: SIN })
      ),
      -1,
      false
    );
    fA.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: 170, easing: SIN }),
        withTiming(1, { duration: 150, easing: SIN }),
        withTiming(0.6, { duration: 160, easing: SIN }),
        withTiming(1, { duration: 140, easing: SIN })
      ),
      -1,
      false
    );
    fB.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 190, easing: SIN }),
        withTiming(0.3, { duration: 200, easing: SIN }),
        withTiming(0.8, { duration: 160, easing: SIN }),
        withTiming(0.4, { duration: 180, easing: SIN })
      ),
      -1,
      false
    );
    fC.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 220, easing: SIN }),
        withTiming(0.9, { duration: 160, easing: SIN }),
        withTiming(0.5, { duration: 210, easing: SIN }),
        withTiming(0.7, { duration: 220, easing: SIN })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => () => {
    cancelAnimation(coreK);
    cancelAnimation(fA);
    cancelAnimation(fB);
    cancelAnimation(fC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const a = useAnimatedProps(() => ({ opacity: fA.value }));
  const b = useAnimatedProps(() => ({ opacity: fB.value }));
  const c = useAnimatedProps(() => ({ opacity: fC.value }));
  const core = useAnimatedProps(() => ({ opacity: coreK.value }));
  const rim = useAnimatedProps(() => ({ opacity: interpolate(coreK.value, [0.78, 1], [0.4, 0.7]) }));

  return (
    <G>
      {/* firelight on the nearest bamboo edges only: tripod legs, pot rim, a pole-base whisper */}
      <AnimatedG animatedProps={rim}>
        <Line x1={24.4} y1={85.6} x2={27.9} y2={77.6} stroke={RIM_FIRE} strokeWidth={0.5} strokeLinecap="round" opacity={0.8} />
        <Line x1={31.6} y1={86} x2={28.4} y2={78.2} stroke={RIM_FIRE} strokeWidth={0.45} strokeLinecap="round" opacity={0.65} />
        <Path d="M24 76.7 A3.6 1.2 0 0 1 30.9 76.5" stroke={RIM_FIRE} strokeWidth={0.5} fill="none" opacity={0.8} />
        <Line x1={71.9} y1={87.5} x2={71.6} y2={80.5} stroke={RIM_FIRE} strokeWidth={0.45} strokeLinecap="round" opacity={0.3} />
      </AnimatedG>
      {/* the three flame strokes over the oil cup (strokes only, sparkler precedent) */}
      <AnimatedG animatedProps={a}>
        <Path d="M27.6 75.8 C28 73.2 27.4 71.4 28.2 69" stroke={FLAME_GOLD} strokeWidth={1.15} strokeLinecap="round" fill="none" />
      </AnimatedG>
      <AnimatedG animatedProps={b}>
        <Path d="M26.8 75.8 C26.2 73.6 27 71.8 26.4 70.2" stroke={FLAME_ORANGE} strokeWidth={1.0} strokeLinecap="round" fill="none" />
      </AnimatedG>
      <AnimatedG animatedProps={c}>
        <Path d="M28.2 75.6 C28.8 74.2 28.4 73 29 71.6" stroke={FLAME_HOT} strokeWidth={0.7} strokeLinecap="round" fill="none" />
      </AnimatedG>
      <AnimatedG animatedProps={core}>
        <Ellipse cx={27.5} cy={75.5} rx={1.2} ry={0.7} fill={FLAME_HOT} />
      </AnimatedG>
    </G>
  );
}

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function LanternStand({ size = 180, lit = false, focused = true }: Props) {
  const reduce = useReducedMotion();
  // Hanging lantern: opacity + the launch transform stack
  const hangOp = useSharedValue(lit ? 0 : 1);
  const lift = useSharedValue(0);
  const sway = useSharedValue(0);
  const swell = useSharedValue(1);
  // One-shot interior light: the early mouth band, then the full climbing wash, plus the tiny
  // fuel-cell flame strokes that ride inside the lantern.
  const washMouth = useSharedValue(0);
  const washFull = useSharedValue(0);
  const cellOp = useSharedValue(0);
  // Lit steady layers: the burning pot (+ rim warmth), and the after-launch props (slack cord +
  // the folded next-wish lantern).
  const potWarm = useSharedValue(lit ? 1 : 0);
  const afterOp = useSharedValue(lit ? 1 : 0);
  const prevLit = useRef(lit); // first mount while lit must skip the launch one-shot

  // Mount gates (hooks stay in stable subcomponents): the hanging lantern unmounts only in the
  // lit steady state; the wash/cell layers exist only during the one-shot run; the lit layers
  // stay mounted through the extinguish fade tail.
  const [hanging, setHanging] = useState(!lit);
  const [launching, setLaunching] = useState(false);
  const [litLayer, setLitLayer] = useState(lit);
  useEffect(() => {
    if (lit) {
      setLitLayer(true);
      return;
    }
    const t = setTimeout(() => setLitLayer(false), 700);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    const wasLit = prevLit.current;
    prevLit.current = lit;
    const still = reduce || !focused; // blur acts like reduced motion: snap, never animate
    cancelAnimation(hangOp);
    cancelAnimation(lift);
    cancelAnimation(sway);
    cancelAnimation(swell);
    cancelAnimation(washMouth);
    cancelAnimation(washFull);
    cancelAnimation(cellOp);
    cancelAnimation(potWarm);
    cancelAnimation(afterOp);
    if (lit) {
      if (still || wasLit) {
        // First mount while already lit, re-focus, reduce, or a blur landing mid-flight: the
        // lantern launched some time ago. Settle straight into the steady aftermath: no lantern,
        // slack cord, folded next wish, pot burning (PotFlame pins itself when still).
        setLaunching(false);
        setHanging(false);
        hangOp.value = 0;
        lift.value = 0;
        sway.value = 0;
        swell.value = 1;
        washMouth.value = 0;
        washFull.value = 0;
        cellOp.value = 0;
        if (still) {
          potWarm.value = 1;
          afterOp.value = 1;
        } else {
          potWarm.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
          afterOp.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) });
        }
        return;
      }
      // Real unlit -> lit edge: the release, on the ignite-clip clock. Pot catches over 0.4s, the
      // cell flame appears, the shell swells 0.97 -> 1.03 with a hanging sway while the amber wash
      // climbs (mouth band first, full gradient after), the tug at 2.4 strains it 2.6 units up,
      // and at 2.8 it accelerates out of the box, fading as it crosses the top edge. The shader
      // hero takes over at 3.0 rising from the (50, 40) anchor.
      setHanging(true);
      setLaunching(true);
      hangOp.value = 1;
      lift.value = 0;
      sway.value = 0;
      swell.value = 0.97;
      washMouth.value = 0;
      washFull.value = 0;
      cellOp.value = 0;
      potWarm.value = withTiming(1, { duration: CATCH_MS });
      cellOp.value = withDelay(150, withTiming(1, { duration: 300 }));
      washMouth.value = withDelay(CATCH_MS, withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }));
      washFull.value = withDelay(800, withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }));
      swell.value = withDelay(CATCH_MS, withTiming(1.03, { duration: 2000, easing: SIN }));
      sway.value = withDelay(
        CATCH_MS,
        withSequence(
          withTiming(1.1, { duration: 700, easing: SIN }),
          withTiming(-0.9, { duration: 800, easing: SIN }),
          withTiming(0.2, { duration: 500, easing: SIN }),
          withTiming(0, { duration: 400, easing: SIN })
        )
      );
      lift.value = withDelay(
        TUG_AT_MS,
        withSequence(
          withTiming(-2.6, { duration: 400, easing: Easing.out(Easing.quad) }),
          withTiming(-78, { duration: 400, easing: Easing.in(Easing.cubic) })
        )
      );
      hangOp.value = withDelay(RELEASE_AT_MS + 50, withTiming(0, { duration: 350, easing: Easing.in(Easing.quad) }));
      afterOp.value = withDelay(RELEASE_AT_MS, withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }));
      const t = setTimeout(() => {
        setLaunching(false);
        setHanging(false);
      }, ONE_SHOT_MS + 150);
      return () => clearTimeout(t);
    }
    // Extinguish: pot flame and after-launch props fade, the hanging lantern fades back onto the
    // crook (600ms, quiet). Still states snap.
    setLaunching(false);
    setHanging(true);
    lift.value = 0;
    sway.value = 0;
    swell.value = 1;
    washMouth.value = 0;
    washFull.value = 0;
    cellOp.value = 0;
    if (still) {
      hangOp.value = 1;
      potWarm.value = 0;
      afterOp.value = 0;
      return;
    }
    hangOp.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) });
    potWarm.value = withTiming(0, { duration: 600 });
    afterOp.value = withTiming(0, { duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => {
    cancelAnimation(hangOp);
    cancelAnimation(lift);
    cancelAnimation(sway);
    cancelAnimation(swell);
    cancelAnimation(washMouth);
    cancelAnimation(washFull);
    cancelAnimation(cellOp);
    cancelAnimation(potWarm);
    cancelAnimation(afterOp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* the interior wash: brightest at the mouth, climbing to a faint warmth at the dome */}
        <LinearGradient id="lstWash" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0%" stopColor="#FFB347" stopOpacity={0.7} />
          <Stop offset="45%" stopColor="#FFC46A" stopOpacity={0.4} />
          <Stop offset="100%" stopColor="#FFE9C0" stopOpacity={0.06} />
        </LinearGradient>
      </Defs>

      {/* Dock contact shadows: the stand and tripod are planted, nothing floats */}
      <Ellipse cx={73} cy={89.4} rx={7.5} ry={1.5} fill={SHADOW} opacity={0.5} />
      <Ellipse cx={27.6} cy={89.2} rx={8.5} ry={1.6} fill={SHADOW} opacity={0.45} />
      <Ellipse cx={70} cy={88.9} rx={4.5} ry={1.1} fill={SHADOW} opacity={0.35} />

      {/* ===== THE CROOK POLE: one leaning bamboo culm, node lines, tip curled over ===== */}
      <Path d={POLE_D} stroke={BAMBOO} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d={POLE_D} stroke={BAMBOO_HI} strokeWidth={0.7} strokeLinecap="round" fill="none" opacity={0.35} />
      <Path
        d="M73.9 88.5 C73.1 72 69.9 40 61.9 21.4 C58.9 14 54.6 8.6 50.9 8.4"
        stroke={BAMBOO_DK}
        strokeWidth={0.8}
        strokeLinecap="round"
        fill="none"
        opacity={0.65}
      />
      {/* culm node lines stepping up the pole */}
      <Line x1={71.5} y1={79.5} x2={74.3} y2={79.8} stroke={NODE} strokeWidth={0.8} opacity={0.8} />
      <Line x1={70.3} y1={65} x2={73.1} y2={65.4} stroke={NODE} strokeWidth={0.8} opacity={0.8} />
      <Line x1={68.2} y1={50.5} x2={71} y2={50.9} stroke={NODE} strokeWidth={0.8} opacity={0.75} />
      <Line x1={65} y1={36.5} x2={67.7} y2={37.1} stroke={NODE} strokeWidth={0.8} opacity={0.75} />
      <Line x1={60.3} y1={24} x2={62.9} y2={25.1} stroke={NODE} strokeWidth={0.75} opacity={0.7} />
      <Line x1={54.6} y1={14.6} x2={56.5} y2={16.3} stroke={NODE} strokeWidth={0.7} opacity={0.65} />
      {/* cool moon rim on the pole's left flank */}
      <Path d="M72.1 88.3 C71.3 72 68.1 40.4 60.2 21.6" stroke={RIM_LEFT} strokeWidth={0.45} fill="none" opacity={0.22} />

      {/* ===== THE FUEL POT on its low bamboo tripod (the lighting flame lives here) ===== */}
      <Line x1={22.6} y1={88.3} x2={28.6} y2={74.8} stroke={BAMBOO} strokeWidth={1.15} strokeLinecap="round" />
      <Line x1={33.2} y1={88.3} x2={26.2} y2={74.8} stroke={BAMBOO_DK} strokeWidth={1.15} strokeLinecap="round" />
      <Line x1={27.2} y1={89} x2={27.5} y2={75.5} stroke={BAMBOO_DK} strokeWidth={1.0} strokeLinecap="round" opacity={0.8} />
      {/* lashing cord where the legs cross */}
      <Line x1={25.9} y1={75.6} x2={29} y2={76.4} stroke={CORD} strokeWidth={0.7} strokeLinecap="round" opacity={0.85} />
      <Line x1={25.9} y1={76.6} x2={29} y2={75.4} stroke={CORD} strokeWidth={0.7} strokeLinecap="round" opacity={0.7} />
      {/* the clay pot cradled at the crossing: rim, oil cup, round belly */}
      <Path d="M23.8 76.8 C23.9 80.4 25.5 82.4 27.5 82.4 C29.5 82.4 31.1 80.4 31.2 76.8 Z" fill={CLAY} />
      <Path d="M27.5 82.4 C29.5 82.4 31.1 80.4 31.2 76.8 L29.3 76.8 C29.3 79.8 28.5 81.6 27.5 82.4 Z" fill={CLAY_DK} opacity={0.7} />
      <Ellipse cx={27.5} cy={76.8} rx={3.7} ry={1.2} fill={CLAY_HI} />
      <Ellipse cx={27.5} cy={76.9} rx={2.7} ry={0.85} fill={OIL} />
      <Path d="M23.9 76.6 A3.65 1.15 0 0 1 31.1 76.6" stroke={RIM_LEFT} strokeWidth={0.4} fill="none" opacity={0.3} />

      {/* ===== LIT STEADY LAYERS ===== */}
      {litLayer && (
        <Fade op={afterOp}>
          {/* the cord slipped free: slack, dangling off the crook tip with its little tie loop */}
          <Path d="M47.6 10 C47.3 13.5 48.7 16.5 47.9 20.4" stroke={CORD} strokeWidth={0.7} strokeLinecap="round" fill="none" />
          <Circle cx={47.9} cy={21.2} r={0.7} stroke={CORD} strokeWidth={0.5} fill="none" />
          {/* the next wish: a folded flat lantern leaning on the pole base */}
          <Path d="M66.2 88 L69.2 73.5 L73.8 74.5 L71 88 Z" fill="#CFC09C" opacity={0.9} />
          <Line x1={67.8} y1={87.6} x2={70.6} y2={74} stroke="#A8946E" strokeWidth={0.45} opacity={0.8} />
          <Line x1={69.3} y1={73.9} x2={73.5} y2={74.8} stroke="#E8DBB8" strokeWidth={0.4} opacity={0.7} />
          <Path d="M66.6 88 L69.4 74.2" stroke="#8A7856" strokeWidth={0.4} opacity={0.6} fill="none" />
        </Fade>
      )}
      {litLayer && (
        <Fade op={potWarm}>
          <PotFlame still={reduce || !focused} />
        </Fade>
      )}

      {/* ===== THE HANGING LANTERN (unlit steady + the launch one-shot) ===== */}
      {hanging && (
        <LanternG op={hangOp} lift={lift} sway={sway} swell={swell}>
          {/* taut cord from the crook tip to the hanging knot on the dome */}
          <Line x1={47.9} y1={9.2} x2={49.9} y2={13.2} stroke={CORD} strokeWidth={0.7} strokeLinecap="round" />
          <Circle cx={50} cy={13.6} r={0.7} fill={BAMBOO_DK} />
          {/* the paper shell */}
          <Path d={BODY_D} fill={PAPER} />
          {/* moon-cool left shade and festival-warm right band (flat washes, no glow) */}
          <Path
            d="M42 15.5 C38.5 18 37.3 21 37.3 25 L37.3 57.4 C37.3 60.6 39.2 63 42.4 64.5 C40.6 61.2 39.9 58.4 39.9 54.5 L39.9 22.5 C39.9 19.5 40.7 17.2 42 15.5 Z"
            fill={PAPER_DK}
            opacity={0.5}
          />
          <Path
            d="M58 15.5 C61.5 18 62.7 21 62.7 25 L62.7 57.4 C62.7 60.6 60.8 63 57.6 64.5 C59.4 61.2 60.1 58.4 60.1 54.5 L60.1 22.5 C60.1 19.5 59.3 17.2 58 15.5 Z"
            fill={PAPER_WARM}
            opacity={0.55}
          />
          {/* faint vertical crumple lines in the sa paper + the dome seam */}
          <Path d="M44 17 C43.6 30 44.3 44 43.9 62" stroke={CRUMPLE} strokeWidth={0.4} fill="none" opacity={0.45} />
          <Path d="M49.5 14.5 C49.2 30 49.9 46 49.5 64.5" stroke={CRUMPLE} strokeWidth={0.4} fill="none" opacity={0.4} />
          <Path d="M55 16 C55.4 30 54.7 46 55.2 63" stroke={CRUMPLE} strokeWidth={0.4} fill="none" opacity={0.45} />
          <Path d="M59 19 C59.3 32 58.8 46 59.1 60" stroke={CRUMPLE} strokeWidth={0.4} fill="none" opacity={0.35} />
          <Path d="M37.6 25 C41 22.4 45 21.2 50 21.2 C55 21.2 59 22.4 62.4 25" stroke={CRUMPLE} strokeWidth={0.4} fill="none" opacity={0.35} />
          {/* unlit rim light: cool moon edge left, warm festival underlight lower right */}
          <Path d="M37.6 25 C37.6 18.2 42.6 14.3 49.3 14.1" stroke={RIM_LEFT} strokeWidth={0.55} fill="none" opacity={0.5} />
          <Line x1={37.5} y1={26} x2={37.5} y2={56.5} stroke={RIM_LEFT} strokeWidth={0.45} opacity={0.28} />
          <Path d="M62.5 50 L62.5 57.4 C62.5 60.7 60.4 63.2 57.2 64.7" stroke={RIM_RIGHT} strokeWidth={0.55} fill="none" opacity={0.45} />

          {/* ONE-SHOT interior light: the amber wash climbing the paper (mouth band, then full) */}
          {launching && (
            <G>
              <Fade op={washMouth}>
                <Path d={MOUTH_BAND_D} fill="#FFC46A" opacity={0.5} />
              </Fade>
              <Fade op={washFull}>
                <Path d={BODY_D} fill="url(#lstWash)" />
                <Path d={BODY_D} stroke={FLAME_GOLD} strokeWidth={0.5} fill="none" opacity={0.4} />
              </Fade>
            </G>
          )}

          {/* the bamboo mouth ring, the dark opening, and the wax fuel cell on crossed bamboo */}
          <Ellipse cx={50} cy={65.8} rx={6} ry={1.35} fill="#241A0C" opacity={0.9} />
          <Ellipse cx={50} cy={65.8} rx={7} ry={1.8} stroke={BAMBOO} strokeWidth={1.05} fill="none" />
          <Path d="M43.2 66.3 A6.9 1.75 0 0 0 56.8 66.3" stroke={BAMBOO_DK} strokeWidth={0.5} fill="none" opacity={0.8} />
          <Line x1={44.4} y1={65.2} x2={55.6} y2={66.4} stroke={NODE} strokeWidth={0.7} strokeLinecap="round" />
          <Line x1={44.4} y1={66.4} x2={55.6} y2={65.2} stroke={NODE} strokeWidth={0.7} strokeLinecap="round" />
          <Rect x={48.7} y={64.7} width={2.6} height={2} rx={0.3} fill="#2E2620" />
          <Line x1={48.9} y1={64.9} x2={51.1} y2={64.9} stroke="#57493A" strokeWidth={0.35} opacity={0.8} />

          {/* ONE-SHOT: the little fuel-cell flame catching at the mouth (warm strokes only) */}
          {launching && (
            <Fade op={cellOp}>
              <Path d="M49 65.2 C48.6 63.7 49.2 62.6 48.8 61.4" stroke={FLAME_GOLD} strokeWidth={0.9} strokeLinecap="round" fill="none" />
              <Path d="M51 65.2 C51.3 63.6 50.8 62.8 51.3 61.2" stroke={FLAME_HOT} strokeWidth={0.7} strokeLinecap="round" fill="none" />
              <Ellipse cx={50} cy={65} rx={0.9} ry={0.5} fill={FLAME_HOT} opacity={0.9} />
            </Fade>
          )}
        </LanternG>
      )}
    </Svg>
  );
}
