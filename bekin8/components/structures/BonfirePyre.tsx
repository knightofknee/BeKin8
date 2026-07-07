// components/structures/BonfirePyre.tsx
// The "Bonfire" skin STRUCTURE and tap target: a BIG dusk-festival pyre. A teepee of leaning poles
// built over a log-cabin stack of courses (visible cut ends), nearly filling the width, with a few
// ground twigs scattered at the base. Dusk-lit warm browns with amber rim light on the upper edges
// (the warm dusk sky sits behind it). FLAME SEAT: registry origin 0.66, deep in the stack per the
// cone-from-wood rule: a real bonfire's flames engulf most of the pyre, so the crown notch (y=40)
// and poles above the seat burn inside the flame. Unlit: a pure
// static silhouette, the amber rim lights alone carry readability (nothing pulses, no glow). Lit:
// warm slivers blaze in the gaps between logs (fire seen through wood, no glow blob), rims shift hot
// orange, and the outer edges darken for contrast against the big flame above. Authored 0..100;
// 180x180 footprint.
import React, { useEffect, useState } from 'react';
import Svg, { Path, Rect, Circle, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);

const BROWN_DK = '#46291A'; // backmost poles + twig bark
const BROWN = '#5C3A24'; // primary log brown
const BROWN_LT = '#7A4E2E'; // lighter, dusk-warmed log brown
const RIM = '#A86F3E'; // amber dusk rim light (upper edges)
const RIM_HOT = '#FF7A1A'; // rim color once the pyre is burning
const GRAIN = '#33200F';
const RING_FACE = '#B9855A'; // cut-end face
const RING_LINE = '#8A5C33'; // cut-end growth ring
const MASS = '#3B2415'; // dark fill behind the poles so the heart reads solid
const EDGE_DARK = '#160B04'; // lit-state edge darkening

// Teepee poles, all rotated about the crown pivot (50,41). Tips cross just above the flame seat at
// y=40 so the crown notch cradles the flame base. `front` poles render OVER the cabin courses.
const POLES = [
  { rot: -33, x: 46.75, y: 38.5, w: 6.5, h: 56, fill: BROWN_DK, rim: 'right', front: false },
  { rot: 33, x: 46.75, y: 38.5, w: 6.5, h: 56, fill: BROWN_DK, rim: 'left', front: false },
  { rot: -19, x: 46.25, y: 37.5, w: 7.5, h: 55, fill: BROWN, rim: 'right', front: false },
  { rot: 19, x: 46.25, y: 37.5, w: 7.5, h: 55, fill: BROWN_LT, rim: 'left', front: false },
  { rot: -12, x: 46, y: 36.5, w: 8, h: 55, fill: BROWN_LT, rim: 'right', front: true },
  { rot: 12, x: 46, y: 36.5, w: 8, h: 55, fill: BROWN, rim: 'left', front: true },
] as const;

// Glowing gap slivers deep in the heart (y 60..80): seams between poles and cabin courses where the
// blaze shows through while lit.
const SLIVERS = [
  { cx: 44, cy: 63.5, w: 9, h: 2.4, rot: -16 },
  { cx: 57, cy: 71.5, w: 10, h: 2.6, rot: 8 },
  { cx: 46.5, cy: 79.5, w: 11, h: 2.8, rot: -5 },
] as const;

// A sawn log end: face + growth ring, like the cabin courses present to the viewer.
function cut(cx: number, cy: number, r: number) {
  return (
    <G key={`c${cx}-${cy}`}>
      <Circle cx={cx} cy={cy} r={r} fill={RING_FACE} stroke={GRAIN} strokeWidth="1" />
      <Circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke={RING_LINE} strokeWidth="0.7" />
    </G>
  );
}

function slivers(fill: string) {
  return SLIVERS.map((s) => (
    <G key={`s${s.cx}`} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`}>
      <Rect x={s.cx - s.w / 2} y={s.cy - s.h / 2} width={s.w} height={s.h} rx={s.h / 2} fill={fill} />
      <Rect x={s.cx - s.w * 0.28} y={s.cy - s.h * 0.25} width={s.w * 0.56} height={s.h * 0.5} rx={s.h * 0.25} fill="#FFEFC2" />
    </G>
  ));
}

// Every rim-light stroke, drawn once in dusk amber (always) and once in hot orange (lit overlay).
function RimLights({ color }: { color: string }) {
  return (
    <G>
      {POLES.map((p) => (
        <G key={`r${p.rot}`} transform={`rotate(${p.rot} 50 41)`}>
          <Line
            x1={p.rim === 'right' ? p.x + p.w - 0.9 : p.x + 0.9}
            y1={p.y + 2.5}
            x2={p.rim === 'right' ? p.x + p.w - 0.9 : p.x + 0.9}
            y2={66}
            stroke={color}
            strokeWidth="1"
            strokeLinecap="round"
            opacity={0.85}
          />
        </G>
      ))}
      {/* cabin course top edges catch the dusk */}
      <Line x1="31" y1="68.4" x2="69" y2="68.4" stroke={color} strokeWidth="0.9" strokeLinecap="round" opacity={0.9} />
      <Line x1="27" y1="76.4" x2="73" y2="76.4" stroke={color} strokeWidth="0.9" strokeLinecap="round" opacity={0.9} />
      <Line x1="23" y1="85.4" x2="77" y2="85.4" stroke={color} strokeWidth="0.9" strokeLinecap="round" opacity={0.9} />
    </G>
  );
}

// Lit-state overlay, mounted only while burning (+ fade tail): steady blaze in the heart gaps, hot
// rim lights, and a slight edge darkening so the silhouette holds against the big Skia flame above.
function HeartBlaze({ heat }: { heat: SharedValue<number> }) {
  const blazeProps = useAnimatedProps(() => ({ opacity: heat.value }));
  const darkenProps = useAnimatedProps(() => ({ opacity: heat.value * 0.3 }));
  return (
    <G>
      <AnimatedG animatedProps={darkenProps}>
        {POLES.filter((p) => Math.abs(p.rot) === 33).map((p) => (
          <G key={`d${p.rot}`} transform={`rotate(${p.rot} 50 41)`}>
            <Rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.w / 2} fill={EDGE_DARK} />
          </G>
        ))}
        <Rect x="18" y="84.5" width="13" height="10" rx="5" fill={EDGE_DARK} />
        <Rect x="69" y="84.5" width="13" height="10" rx="5" fill={EDGE_DARK} />
      </AnimatedG>
      <AnimatedG animatedProps={blazeProps}>
        {slivers('#FFC46A')}
        <RimLights color={RIM_HOT} />
      </AnimatedG>
    </G>
  );
}

export default function BonfirePyre({ size = 180, lit = false, focused = true }: { size?: number; lit?: boolean; focused?: boolean }) {
  const reduce = useReducedMotion();
  const heat = useSharedValue(lit ? 1 : 0); // lit overlay ramp
  // Mount the blaze overlay ONLY while lit (+ a fade tail) so unlit is unambiguously a cold stack.
  const [blazing, setBlazing] = useState(lit);
  useEffect(() => {
    if (lit) {
      setBlazing(true);
      return;
    }
    const t = setTimeout(() => setBlazing(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: skip the ramp and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(heat);
    if (lit) {
      heat.value = still ? 1 : withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    } else {
      heat.value = withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(heat); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* ===== Scattered ground twigs at the base ===== */}
      <G transform="rotate(7 22 92.5)">
        <Rect x="13" y="91.6" width="15" height="2.2" rx="1.1" fill={BROWN_DK} />
      </G>
      <G transform="rotate(-9 77 93)">
        <Rect x="69" y="92" width="16" height="2.4" rx="1.2" fill={BROWN} />
      </G>
      <G transform="rotate(4 36 95)">
        <Rect x="30" y="94.2" width="12" height="2" rx="1" fill={BROWN_DK} />
      </G>

      {/* Dark mass behind the poles: keeps the heart solid so the lit gaps read as depth */}
      <Path d="M50 43 L22 88 L78 88 Z" fill={MASS} />

      {/* ===== Teepee poles, back pairs (crown pivot 50,41; tips cross above the y=40 seat) ===== */}
      {POLES.filter((p) => !p.front).map((p) => (
        <G key={`p${p.rot}`} transform={`rotate(${p.rot} 50 41)`}>
          <Rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.w / 2} fill={p.fill} />
          <Line x1={p.x + p.w / 2} y1={p.y + 4} x2={p.x + p.w / 2} y2={p.y + p.h - 6} stroke={GRAIN} strokeWidth="0.6" opacity={0.5} />
        </G>
      ))}

      {/* ===== Log-cabin stack: three courses, widest at the bottom (x 18..82) ===== */}
      <Rect x="27" y="67.5" width="46" height="8.5" rx="4.25" fill={BROWN_LT} />
      <Line x1="31" y1="74" x2="69" y2="74" stroke={GRAIN} strokeWidth="0.6" opacity={0.6} />
      <Rect x="22.5" y="75.5" width="55" height="9.5" rx="4.75" fill={BROWN} />
      <Line x1="27" y1="83" x2="73" y2="83" stroke={GRAIN} strokeWidth="0.6" opacity={0.6} />
      <Rect x="18" y="84.5" width="64" height="10" rx="5" fill={BROWN_LT} />
      <Line x1="23" y1="92" x2="77" y2="92" stroke={GRAIN} strokeWidth="0.6" opacity={0.6} />

      {/* ===== Teepee poles, front crossing pair (the crown notch that cradles the flame) ===== */}
      {POLES.filter((p) => p.front).map((p) => (
        <G key={`p${p.rot}`} transform={`rotate(${p.rot} 50 41)`}>
          <Rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.w / 2} fill={p.fill} />
          <Line x1={p.x + p.w / 2} y1={p.y + 4} x2={p.x + p.w / 2} y2={p.y + p.h - 6} stroke={GRAIN} strokeWidth="0.6" opacity={0.5} />
        </G>
      ))}

      {/* ===== Visible cut ends: cabin courses + teepee pole feet ===== */}
      {cut(28.5, 71.75, 4.2)}
      {cut(71.5, 71.75, 4.2)}
      {cut(24.5, 80.25, 4.7)}
      {cut(75.5, 80.25, 4.7)}
      {cut(20.5, 89.5, 5)}
      {cut(79.5, 89.5, 5)}
      {cut(33.4, 88.5, 3.8)}
      {cut(66.6, 88.5, 3.8)}
      {cut(39.5, 90, 4.3)}
      {cut(60.5, 90, 4.3)}

      {/* Amber dusk rim light on every upper edge (always on: this is the unlit readability) */}
      <RimLights color={RIM} />

      {/* Lit: steady gap-sliver blaze + hot rims + darkened edges (only while burning; cold stack otherwise) */}
      {blazing && <HeartBlaze heat={heat} />}
    </Svg>
  );
}
