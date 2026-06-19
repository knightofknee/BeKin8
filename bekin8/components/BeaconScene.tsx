// components/BeaconScene.tsx
// Full-screen BACKDROP behind all tiles (first child of the home page, pointerEvents View wrapper).
// One scene PER SKIN (dispatched by structure); returns null if a skin has none. Distant accent
// lights (GlowDot) reuse the 5 shared `ops` values, which kindle one-by-one when you light your
// beacon (the cascade) and dim when you put it out. Scenes are decorative SVG (no path-`d` anim).
//   mountains → LOTR ridge chain   tower → Old North Church / Boston harbor at night
//   logs → night forest clearing   brazier → fortress rampart   bonfire → night shore   wisp → bog
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useFrameCallback,
  withDelay,
  withTiming,
  withSequence,
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { loopNoise, loopNoiseSigned, makeSeed, type NoiseSeed } from '../lib/beaconNoise';
import type { BeaconSkin } from '../lib/beaconSkins';

const AnimatedG = Animated.createAnimatedComponent(G);

// Cascade order for the 5 reusable accent lights (used by every scene's distant glows).
const DOTS = [
  { x: 0.3, y: 0.54, order: 0 },
  { x: 0.7, y: 0.53, order: 1 },
  { x: 0.18, y: 0.41, order: 2 },
  { x: 0.52, y: 0.4, order: 3 },
  { x: 0.84, y: 0.42, order: 4 },
];

function GlowDot({ op, x, y, r, glow, core }: { op: SharedValue<number>; x: number; y: number; r: number; glow: string; core: string }) {
  const props = useAnimatedProps(() => ({ opacity: op.value }));
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={x} cy={y} r={r * 2.4} fill={glow} />
      <Circle cx={x} cy={y} r={r} fill={core} />
    </AnimatedG>
  );
}

// Fireflies: wander in 2D (loopNoise drift, NOT rising) and blink on/off independently. Driven by
// the scene clock so they move whether or not the beacon is lit.
const FLIES = [
  { x: 0.28, y: 0.56, sx: makeSeed(3.1, 11.4, 1.3, 3.3), sy: makeSeed(7.2, 5.5, 1.4, 2.6), bl: makeSeed(13.7, 2.2, 1.5, 2.9) },
  { x: 0.62, y: 0.5, sx: makeSeed(9.4, 3.7, 1.4, 3.7), sy: makeSeed(2.6, 13.1, 1.3, 2.9), bl: makeSeed(17.3, 6.4, 1.5, 3.4) },
  { x: 0.44, y: 0.62, sx: makeSeed(5.8, 9.2, 1.3, 4.1), sy: makeSeed(11.9, 4.3, 1.4, 3.2), bl: makeSeed(21.1, 1.7, 1.5, 2.4) },
  { x: 0.76, y: 0.58, sx: makeSeed(8.3, 7.1, 1.4, 3.0), sy: makeSeed(4.5, 10.8, 1.3, 3.6), bl: makeSeed(19.6, 8.9, 1.5, 3.8) },
  { x: 0.16, y: 0.64, sx: makeSeed(12.2, 2.9, 1.3, 4.3), sy: makeSeed(6.7, 12.4, 1.4, 2.7), bl: makeSeed(15.4, 4.1, 1.5, 3.1) },
];

function FireflyDot({ clock, x, y, sx, sy, bl }: { clock: SharedValue<number>; x: number; y: number; sx: NoiseSeed; sy: NoiseSeed; bl: NoiseSeed }) {
  const props = useAnimatedProps(() => {
    const t = clock.value;
    const blink = Math.pow(loopNoise(t, bl), 2.4); // mostly dim, occasional bright glow
    return {
      opacity: 0.08 + blink * 0.9,
      transform: [{ translateX: x + loopNoiseSigned(t, sx, 20) }, { translateY: y + loopNoiseSigned(t, sy, 15) }],
    };
  });
  return (
    <AnimatedG animatedProps={props}>
      <Circle cx={0} cy={0} r={5.0} fill="url(#scFly)" />
      <Circle cx={0} cy={0} r={1.6} fill="#FFF6B0" />
    </AnimatedG>
  );
}

export type BeaconSceneProps = { skin: BeaconSkin; active: boolean };

export default function BeaconScene({ skin, active }: BeaconSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const ops = DOTS.map(() => useSharedValue(0.12));

  useEffect(() => {
    if (active) {
      DOTS.forEach((d, i) => {
        if (reduce) { ops[i].value = 1; return; }
        ops[i].value = withDelay(
          700 + d.order * 320,
          withSequence(
            withTiming(1, { duration: 420 }),
            withRepeat(withSequence(withTiming(0.7, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true)
          )
        );
      });
    } else {
      ops.forEach((o) => { cancelAnimation(o); o.value = reduce ? 0.12 : withTiming(0.12, { duration: 500 }); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => ops.forEach((o) => cancelAnimation(o)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scene clock for ambient motion (fireflies). Always registered, gated internally to the forest
  // skin (+ motion allowed) so it costs nothing elsewhere — fireflies drift whether lit or not.
  const clock = useSharedValue(0);
  const fliesOn = useSharedValue(skin.structure === 'logs' && !reduce ? 1 : 0);
  useEffect(() => {
    fliesOn.value = skin.structure === 'logs' && !reduce ? 1 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.structure, reduce]);
  const tick = useCallback((info: { timeSincePreviousFrame: number | null }) => {
    'worklet';
    if (fliesOn.value === 0) return;
    clock.value += (info.timeSincePreviousFrame ?? 16.6) / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrameCallback(tick, true);
  useEffect(() => () => cancelAnimation(clock), []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = skin.structure;
  const has = (s === 'mountains' || s === 'tower' || s === 'logs' || s === 'brazier' || s === 'bonfire' || s === 'wisp');
  if (!has) return null;

  // a jagged silhouette band (rooftops / hills) from baseline yf to the bottom.
  const skyline = (yf: number, seed: number, amp: number, n: number) => {
    const y = H * yf;
    let d = `M0 ${H} L0 ${y.toFixed(0)}`;
    for (let i = 0; i <= n; i++) {
      const x = (W * i) / n;
      const h = amp * (0.4 + (((i * 53 + seed * 17) % 19) / 19));
      d += ` L${x.toFixed(0)} ${(y - h).toFixed(0)} L${(x + W / n / 2).toFixed(0)} ${(y - h * 0.4).toFixed(0)}`;
    }
    d += ` L${W} ${H} Z`;
    return d;
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        {/* ---------- The Beacons: LOTR ridge chain ---------- */}
        {s === 'mountains' && (() => {
          const ridge = (yf: number, peaks: number[]) => {
            const y = H * yf; let d = `M0 ${y}`;
            peaks.forEach((p, i) => {
              const x = (W * (i + 1)) / (peaks.length + 1);
              d += ` L${x.toFixed(0)} ${(y - p).toFixed(0)} L${(x + W / (peaks.length + 1) / 2).toFixed(0)} ${y.toFixed(0)}`;
            });
            d += ` L${W} ${(y - 10).toFixed(0)} L${W} ${H} L0 ${H} Z`; return d;
          };
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#141B33" /><Stop offset="62%" stopColor="#2A2747" /><Stop offset="100%" stopColor="#5A3F52" /></LinearGradient>
                <RadialGradient id="scGlow" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFC56B" stopOpacity={0.9} /><Stop offset="60%" stopColor="#FF9A3C" stopOpacity={0.25} /><Stop offset="100%" stopColor="#FF9A3C" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.2} cy={H * 0.12} r={1.3} fill="#fff" opacity={0.5} /><Circle cx={W * 0.7} cy={H * 0.09} r={1} fill="#fff" opacity={0.4} /><Circle cx={W * 0.84} cy={H * 0.18} r={1.2} fill="#fff" opacity={0.5} /><Circle cx={W * 0.4} cy={H * 0.07} r={1} fill="#fff" opacity={0.35} />
              <Path d={ridge(0.42, [38, 58, 30, 46])} fill="#39446A" />
              <Path d={ridge(0.55, [44, 30, 52])} fill="#2A3354" />
              {DOTS.map((d, i) => <GlowDot key={`d${i}`} op={ops[i]} x={W * d.x} y={H * d.y} r={3.2} glow="url(#scGlow)" core="#FFD98C" />)}
              <Path d={ridge(0.68, [50, 36, 44])} fill="#1B2440" />
            </>
          );
        })()}

        {/* ---------- Two Lanterns: Old North Church flanked by the dimmed red-brick North End ---------- */}
        {s === 'tower' && (() => {
          const base = H;
          // Red-brick buildings hugging BOTH sides of the steeple (like the real North End), dimmed so
          // the white/red tower in front stays the focus; center kept clear. NO beacon chain — the
          // Two Lanterns signal was a one-time event, so nothing kindles across a distance here.
          const BLD = [
            { x: 0.0, w: 0.2, top: 0.42, fill: '#412C27', cols: 3 },
            { x: 0.2, w: 0.13, top: 0.55, fill: '#372421', cols: 2 },
            { x: 0.8, w: 0.2, top: 0.45, fill: '#412C27', cols: 3 },
            { x: 0.67, w: 0.13, top: 0.56, fill: '#372421', cols: 2 },
          ];
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#080C1C" /><Stop offset="55%" stopColor="#121830" /><Stop offset="100%" stopColor="#1A2138" /></LinearGradient>
                <RadialGradient id="scMoon" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFF6D8" stopOpacity={0.85} /><Stop offset="45%" stopColor="#E8E4C8" stopOpacity={0.35} /><Stop offset="100%" stopColor="#E8E4C8" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.76} cy={H * 0.12} r={60} fill="url(#scMoon)" /><Circle cx={W * 0.76} cy={H * 0.12} r={19} fill="#FBF6E2" opacity={0.9} />
              <Ellipse cx={W * 0.8} cy={H * 0.135} rx={68} ry={12} fill="#121830" opacity={0.7} />
              <Circle cx={W * 0.18} cy={H * 0.1} r={1.2} fill="#fff" opacity={0.5} /><Circle cx={W * 0.4} cy={H * 0.06} r={1} fill="#fff" opacity={0.4} /><Circle cx={W * 0.55} cy={H * 0.11} r={1.1} fill="#fff" opacity={0.4} />
              {BLD.map((b, i) => {
                const x = b.x * W, w = b.w * W, top = b.top * H, h = base - top;
                const pad = w * 0.18, cellW = (w - pad * 2) / b.cols, winW = cellW * 0.5;
                const rows = Math.max(3, Math.floor((h - 12) / (H * 0.055))), cellH = (h - 14) / rows, winH = Math.min(cellH * 0.5, H * 0.026);
                const cells: React.ReactNode[] = [];
                for (let r = 0; r < rows; r++) for (let c = 0; c < b.cols; c++) {
                  const lit = (r * 7 + c * 3 + i * 5) % 6 === 0;
                  cells.push(<Rect key={`${i}-${r}-${c}`} x={x + pad + c * cellW + (cellW - winW) / 2} y={top + 10 + r * cellH} width={winW} height={winH} rx={0.5} fill={lit ? '#C9A868' : '#231915'} opacity={lit ? 0.3 : 0.85} />);
                }
                return (
                  <G key={`b${i}`}>
                    <Rect x={x} y={top} width={w} height={h} fill={b.fill} />
                    <Rect x={x} y={top} width={w} height={3} fill="#291B18" />
                    {cells}
                  </G>
                );
              })}
              <Rect x={0} y={base - H * 0.035} width={W} height={H * 0.035} fill="#0D0A12" />
            </>
          );
        })()}

        {/* ---------- Campfire: night forest clearing with fireflies ---------- */}
        {s === 'logs' && (() => {
          const trees = (yf: number, fill: string, count: number, hgt: number, seed: number) => {
            let d = '';
            for (let i = 0; i <= count; i++) {
              const x = (W * i) / count; const y = H * yf; const h = hgt * (0.6 + (((i * 31 + seed) % 13) / 13)); const w = h * 0.42;
              d += `M${(x - w / 2).toFixed(0)} ${y.toFixed(0)} L${x.toFixed(0)} ${(y - h).toFixed(0)} L${(x + w / 2).toFixed(0)} ${y.toFixed(0)} Z `;
            }
            return d;
          };
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#0A1410" /><Stop offset="60%" stopColor="#142019" /><Stop offset="100%" stopColor="#1C2A20" /></LinearGradient>
                <RadialGradient id="scFly" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFF0A0" stopOpacity={0.95} /><Stop offset="55%" stopColor="#C8E07A" stopOpacity={0.3} /><Stop offset="100%" stopColor="#C8E07A" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.22} cy={H * 0.14} r={26} fill="#E8EED8" opacity={0.16} /><Circle cx={W * 0.7} cy={H * 0.08} r={1.1} fill="#fff" opacity={0.4} /><Circle cx={W * 0.85} cy={H * 0.13} r={1} fill="#fff" opacity={0.35} />
              <Path d={trees(0.5, '#162018', 7, H * 0.18, 2)} fill="#13201A" opacity={0.8} />
              {FLIES.map((f, i) => <FireflyDot key={`fly${i}`} clock={clock} x={W * f.x} y={H * f.y} sx={f.sx} sy={f.sy} bl={f.bl} />)}
              <Path d={trees(0.72, '#0E1812', 6, H * 0.26, 9)} fill="#0E1812" />
            </>
          );
        })()}

        {/* ---------- Old Guard: fortress rampart at night ---------- */}
        {s === 'brazier' && (() => {
          const merlonY = H * 0.6;
          const TORCH = [{ x: 0.18, o: 0 }, { x: 0.46, o: 2 }, { x: 0.74, o: 1 }, { x: 0.9, o: 3 }];
          const merlons = () => {
            let d = `M0 ${H} L0 ${merlonY.toFixed(0)}`; const n = 9; const mw = W / n;
            for (let i = 0; i < n; i++) {
              const x = i * mw; const up = i % 2 === 0;
              d += ` L${x.toFixed(0)} ${(merlonY - (up ? 20 : 0)).toFixed(0)} L${(x + mw).toFixed(0)} ${(merlonY - (up ? 20 : 0)).toFixed(0)}`;
            }
            d += ` L${W} ${H} Z`; return d;
          };
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#0C1018" /><Stop offset="60%" stopColor="#181E28" /><Stop offset="100%" stopColor="#222934" /></LinearGradient>
                <RadialGradient id="scGlow" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFC56B" stopOpacity={0.95} /><Stop offset="60%" stopColor="#FF8A2A" stopOpacity={0.22} /><Stop offset="100%" stopColor="#FF8A2A" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.78} cy={H * 0.13} r={30} fill="#C8CEDA" opacity={0.18} />
              <Path d={skyline(0.5, 5, H * 0.07, 6)} fill="#1A2230" opacity={0.7} />
              {TORCH.map((tt, i) => <GlowDot key={`t${i}`} op={ops[tt.o]} x={W * tt.x} y={merlonY - 14} r={2.6} glow="url(#scGlow)" core="#FFD98C" />)}
              <Path d={merlons()} fill="#13171F" />
              {/* banner on a pole */}
              <Rect x={W * 0.5 - 1.5} y={merlonY - 70} width={3} height={70} fill="#0C0F15" />
              <Path d={`M${(W * 0.5 + 1.5).toFixed(0)} ${(merlonY - 66).toFixed(0)} L${(W * 0.5 + 34).toFixed(0)} ${(merlonY - 58).toFixed(0)} L${(W * 0.5 + 1.5).toFixed(0)} ${(merlonY - 44).toFixed(0)} Z`} fill="#7A2230" opacity={0.85} />
            </>
          );
        })()}

        {/* ---------- Bonfire: night shore with distant fires + moon-glint ---------- */}
        {s === 'bonfire' && (() => {
          const seaY = H * 0.5;
          const FIRES = [{ x: 0.2, o: 0 }, { x: 0.62, o: 1 }, { x: 0.82, o: 2 }];
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#080C1C" /><Stop offset="58%" stopColor="#141A30" /><Stop offset="100%" stopColor="#1E2438" /></LinearGradient>
                <LinearGradient id="scGlint" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#FBE7B0" stopOpacity={0.5} /><Stop offset="100%" stopColor="#FBE7B0" stopOpacity={0} /></LinearGradient>
                <RadialGradient id="scGlow" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#FFB35A" stopOpacity={0.95} /><Stop offset="60%" stopColor="#FF6A1A" stopOpacity={0.25} /><Stop offset="100%" stopColor="#FF6A1A" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.5} cy={H * 0.2} r={34} fill="#FBF2D2" opacity={0.5} /><Circle cx={W * 0.5} cy={H * 0.2} r={34} fill="#FBF2D2" opacity={0.25} />
              {/* sea + moon glint column */}
              <Rect x={0} y={seaY} width={W} height={H - seaY} fill="#0A1124" />
              <Rect x={W * 0.5 - 16} y={seaY} width={32} height={H * 0.22} fill="url(#scGlint)" />
              <Rect x={0} y={seaY} width={W} height={1.5} fill="#2A3A5A" opacity={0.5} />
              {FIRES.map((f, i) => <GlowDot key={`bf${i}`} op={ops[f.o]} x={W * f.x} y={seaY - 4} r={3.0} glow="url(#scGlow)" core="#FFD08A" />)}
              {/* dune foreground */}
              <Path d={`M0 ${H} L0 ${(H * 0.82).toFixed(0)} Q${(W * 0.5).toFixed(0)} ${(H * 0.72).toFixed(0)} ${W} ${(H * 0.84).toFixed(0)} L${W} ${H} Z`} fill="#0C0F18" />
              {[0.1, 0.3, 0.7, 0.9].map((gx, i) => <Line key={`g${i}`} x1={W * gx} y1={H * 0.82} x2={W * gx - 6} y2={H * 0.78} stroke="#1A2230" strokeWidth={1.5} />)}
            </>
          );
        })()}

        {/* ---------- Will-o'-Wisp: misty bog at dusk ---------- */}
        {s === 'wisp' && (() => {
          const WISPS = [{ x: 0.26, y: 0.52, o: 0 }, { x: 0.6, y: 0.46, o: 2 }, { x: 0.44, y: 0.6, o: 1 }, { x: 0.8, y: 0.5, o: 3 }, { x: 0.14, y: 0.62, o: 4 }];
          const tree = (x: number, h: number) => `M${x.toFixed(0)} ${H.toFixed(0)} L${(x - 3).toFixed(0)} ${(H - h * 0.6).toFixed(0)} L${(x - 14).toFixed(0)} ${(H - h * 0.85).toFixed(0)} M${x.toFixed(0)} ${(H - h * 0.5).toFixed(0)} L${(x + 12).toFixed(0)} ${(H - h * 0.8).toFixed(0)} M${x.toFixed(0)} ${H.toFixed(0)} L${x.toFixed(0)} ${(H - h).toFixed(0)}`;
          return (
            <>
              <Defs>
                <LinearGradient id="scSky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#0B130F" /><Stop offset="60%" stopColor="#142019" /><Stop offset="100%" stopColor="#1A2622" /></LinearGradient>
                <RadialGradient id="scGlow" cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#BFFBFF" stopOpacity={0.95} /><Stop offset="55%" stopColor="#3FB8E8" stopOpacity={0.22} /><Stop offset="100%" stopColor="#3FB8E8" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={W} height={H} fill="url(#scSky)" />
              <Circle cx={W * 0.7} cy={H * 0.12} r={24} fill="#CFE6E0" opacity={0.12} />
              {/* bare twisted trees */}
              <Path d={tree(W * 0.12, H * 0.4)} stroke="#0C140F" strokeWidth={3} fill="none" />
              <Path d={tree(W * 0.88, H * 0.34)} stroke="#0C140F" strokeWidth={3} fill="none" />
              {/* will-o'-wisps */}
              {WISPS.map((w, i) => <GlowDot key={`wi${i}`} op={ops[w.o]} x={W * w.x} y={H * w.y} r={2.4} glow="url(#scGlow)" core="#E6FEFF" />)}
              {/* fog bands */}
              <Ellipse cx={W * 0.5} cy={H * 0.66} rx={W * 0.7} ry={24} fill="#334A44" opacity={0.18} />
              <Ellipse cx={W * 0.4} cy={H * 0.78} rx={W * 0.75} ry={30} fill="#3A524C" opacity={0.2} />
              <Rect x={0} y={H * 0.86} width={W} height={H * 0.14} fill="#0E1714" opacity={0.6} />
            </>
          );
        })()}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
