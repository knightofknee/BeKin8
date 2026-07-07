// components/scenes/SearchlightScene.tsx
// The PREMIERE SEARCHLIGHT backdrop (behind all tiles): a 1930s Hollywood premiere seen from a
// city rooftop. SVG below: a deep charcoal-indigo night, a layered art-deco skyline (stepped
// setbacks, a water tower, thin antenna masts) with sparse warm amber tungsten windows (research:
// the 1930s city glows amber against the carbon arc's blue-white), and the rooftop foreground: a
// deck line under the structure's feet, a roof-access bulkhead to the left, the searchlight's
// power cable continuing along the deck off-frame right, and a coping-stone parapet spanning the
// bottom. Skia above: ONE cloud-band canvas across the top of the screen (AuroraScene pattern),
// a low cloud deck seen from below with slow lateral FBM drift, and the lit payoff: the DISC, a
// soft elliptical pool of arc light on the cloud base where the shaft terminates, with the BeKin
// emblem inside it as a DARK SHADOW (research-true bat-signal physics: the cutout blocks light, so
// the cloud lights up AROUND the emblem, brightness scaled by local cloud density: no clouds = a
// weak splash). One faint distant second beam rises from the far skyline on its own slow period
// (the city answering). If the shader fails to compile the canvas is skipped and the SVG night
// stands alone (static sky, no clouds): never a blank screen.
//
// SWEEP CONTRACT (shared by RooftopSearchlight, SearchlightScene, BeaconSearchlightBeam):
//   SWEEP_PERIOD = 22.0 s; sway = sin(2*PI*t/22); shaped = sway^3 (dwells near vertical);
//   theta = 0.62 * shaped (radians off vertical, max ~35.5 deg). t is a gated clock ZEROED on the
//   real unlit-to-lit edge in ALL THREE components; they mount together on a skin switch and pause
//   together on blur, so the barrel, the shaft and the cloud disc stay in lockstep. Here:
//   discX = anchorX + tan(theta) * (anchorY - discY), the pure geometric intersection of the
//   shaft with the cloud base. The emblem sharpens while the sweep DWELLS near vertical
//   (emblemK = 1 - smoothstep(0.08, 0.25, abs(shaped))) and smears away at speed.
//
// CLOUD BAND CONTRACT: the canvas spans the top 26% of the screen (CLOUD_FRAC; the beam layer's
// u_cloudY is the same 0.26 * H, so the shaft fades out exactly where this band takes over). The
// disc rides the cloud base at DISC_FRAC = 0.14 * H. The disc gates in at sweep-time 0.45-0.65,
// matching the beam's strike gate (a soft fade, cold-mount safe).
//
// TIMING: two clocks. The DRIFT clock (cloud motion) runs whenever focused and not reduced, lit
// or unlit. The SWEEP clock gates on (active && focused && !reduce) and is zeroed on the real lit
// edge (prevActive ref), keeping lockstep with the beam layer and the structure's barrel.
// LEGIBILITY: aurora-style top scrim INSIDE the shader (the band only reaches 26%, above the 22%
// scrim knee); an SVG scrim rect handles the bottom ramp. The 12-62% tile band stays calm: the
// only lit motion there is the beam layer in front, and this scene's midband is static city.
// Reduced motion: static frame, theta pinned 0 (disc straight above the anchor, emblem sharp), no
// drift, no second beam, lit state snaps.
//
// KNOBS: CLOUD_FRAC / DISC_FRAC; DISC_RX/RY + EMBLEM_H px in the shader; the second beam's period
// (34s) and alpha inside the shader's u_lit branch; DECK_BELOW_BOTTOM for the deck line seat.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Path, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import type { BeaconSkin } from '../../lib/beaconSkins';
import { makeShaderEffect } from '../../lib/makeShaderEffect';
import { useGatedClock } from '../../lib/useGatedClock';

const AnimatedG = Animated.createAnimatedComponent(G);

// CLOUD BAND CONTRACT constants (the beam layer computes u_cloudY from the same CLOUD_FRAC).
const CLOUD_FRAC = 0.26;
const DISC_FRAC = 0.14;
// The deck line sits this many px above the structure box's bottom (feet at viewBox y 87).
const DECK_BELOW_BOTTOM = 23.4;

const SEARCHLIGHT_SKSL = `
uniform float u_time;   // drift clock (cloud motion; runs lit or unlit)
uniform float u_sweep;  // sweep clock (SWEEP CONTRACT t; zeroed on the real lit edge)
uniform float u_lit;    // 0..1 lit ramp
uniform vec2  u_res;    // canvas size px (width, band height = 0.26 * H)
uniform float u_h;      // full page height px (scrim + disc geometry)
uniform vec2  u_anchor; // lens center page px (viewBox (50, 30) of the structure)
uniform float u_static; // 1 = reduced motion: theta 0, emblem sharp, no second beam

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ return vnoise(p) * 0.65 + vnoise(p * 2.3 + 11.7) * 0.35; }

half4 main(vec2 uv){
  float py = uv.y / u_h; // page-relative y (the canvas sits at the top of the screen)

  // Sky base: the exact same top-to-bottom mix as the SVG gradient underneath, so the band's
  // bottom edge is seam-free.
  vec3 col = mix(vec3(0.031, 0.039, 0.071), vec3(0.098, 0.118, 0.200), py);

  // ---------- CLOUD DECK (seen from below, slow lateral drift) ----------
  float den = fbm(vec2(uv.x * 0.006 + u_time * 0.010, uv.y * 0.015));
  den = den * 0.75 + 0.25 * vnoise(vec2(uv.x * 0.02 + u_time * 0.017, uv.y * 0.05 + 3.7));
  float shape = smoothstep(0.38, 0.78, den);
  shape *= 1.0 - smoothstep(u_res.y * 0.70, u_res.y * 0.98, uv.y); // deck thins toward the seam
  // unlit: near-black grey-blue, barely there; lit: the ambient haze lifts slightly
  vec3 cloudCol = vec3(0.078, 0.094, 0.125) + vec3(0.055, 0.075, 0.100) * u_lit;
  col = mix(col, cloudCol, shape * (0.55 + 0.20 * u_lit));

  // ---------- SWEEP CONTRACT ----------
  float theta = 0.0;
  float shaped = 0.0;
  if (u_static < 0.5){
    float sway = sin(6.2831853 * u_sweep / 22.0);
    shaped = sway * sway * sway;
    theta = 0.62 * shaped;
  }

  // ---------- THE DISC: the shaft's pool of light on the cloud base (DISC_FRAC) ----------
  float discY = ${DISC_FRAC} * u_h;
  float discX = u_anchor.x + tan(theta) * (u_anchor.y - discY);
  // gates in at the arc catch (matches the beam layer's 0.45-0.6 strike gate); cold-mount safe
  float gate = u_static > 0.5 ? 1.0 : smoothstep(0.45, 0.65, u_sweep);
  vec2 dd = vec2((uv.x - discX) / 88.0, (uv.y - discY) / 34.0);
  float pool = exp(-dot(dd, dd) * 1.6);
  float local = 0.25 + 0.75 * shape; // no clouds under the shaft = a weak splash

  // THE EMBLEM: a dark silhouette SDF inside the disc (the cutout casts a shadow; the cloud
  // lights up AROUND it). A bold flame teardrop over a short base bar, ~60px tall (EMBLEM_H).
  vec2 qq = vec2(uv.x - discX, discY - uv.y) / 60.0; // y up, emblem-local units
  float emblemK = u_static > 0.5 ? 1.0 : 1.0 - smoothstep(0.08, 0.25, abs(shaped));
  float e = mix(0.10, 0.032, emblemK); // smeared at speed, sharp in the dwell
  float qy = qq.y;
  float wUp = 0.27 * pow(clamp((0.44 - qy) / 0.49, 0.0, 1.0), 0.62); // concave taper to the tip
  float bly = (qy + 0.05) / 0.27; // squared by multiply: pow() with a negative base can NaN in SkSL
  float wLo = 0.27 * sqrt(max(1.0 - bly * bly, 0.0)); // round belly
  float w = qy > -0.05 ? wUp : wLo;
  float qx = abs(qq.x - 0.045 * sin((qy + 0.30) * 5.2)); // a slight flame lick
  float flame = (1.0 - smoothstep(w - e, w + e, qx))
              * smoothstep(-0.35, -0.30, qy) * (1.0 - smoothstep(0.42, 0.47, qy));
  float bar = (1.0 - smoothstep(0.30 - e, 0.30 + e, abs(qq.x)))
            * smoothstep(-0.54, -0.50, qy) * (1.0 - smoothstep(-0.39, -0.35, qy));
  float emblem = max(flame, bar) * emblemK;

  vec3 beamCol = vec3(0.918, 0.957, 1.0); // carbon-arc blue-white (#EAF4FF)
  float disc = pool * local * gate * u_lit;
  col += beamCol * disc * 0.85 * (1.0 - emblem * 0.88);

  // ---------- ONE DISTANT SECOND BEAM: the city answering (lit only, its own slow period) ----------
  if (u_lit > 0.01 && u_static < 0.5){
    vec2 o2 = vec2(0.86 * u_res.x, 0.62 * u_h); // far skyline, below the band
    float sway2 = sin(6.2831853 * (u_sweep + 9.0) / 34.0);
    float th2 = 0.5 * sway2 * sway2 * sway2;
    vec2 d2 = uv - o2;
    float ang2 = atan(d2.y, d2.x);
    float ax2 = -1.5707963 + th2;
    float ad2 = abs(atan(sin(ang2 - ax2), cos(ang2 - ax2)));
    float b2 = (1.0 - smoothstep(0.0, 0.022, ad2)) * (1.0 - smoothstep(u_res.y * 0.72, u_res.y, uv.y));
    float discY2 = 0.09 * u_h;
    float discX2 = o2.x + tan(th2) * (o2.y - discY2);
    vec2 dd2 = vec2((uv.x - discX2) / 46.0, (uv.y - discY2) / 20.0);
    float pool2 = exp(-dot(dd2, dd2) * 1.8) * (0.25 + 0.75 * shape);
    col += beamCol * (b2 * 0.10 + pool2 * 0.16) * u_lit;
  }

  // a couple of faint stars high up, showing only through cloud gaps
  vec2 s1 = uv - vec2(0.18 * u_res.x, 0.055 * u_h);
  vec2 s2 = uv - vec2(0.68 * u_res.x, 0.035 * u_h);
  float st = exp(-dot(s1, s1) * 0.4) * 0.5 + exp(-dot(s2, s2) * 0.4) * 0.4;
  col += vec3(0.85, 0.90, 1.0) * st * (1.0 - shape) * 0.5;

  // aurora-style TOP scrim inside the shader (the band ends at 26%, above the 22% knee; the SVG
  // scrim underneath carries the bottom ramp)
  col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.22, py));
  return half4(col, 1.0);
}
`;

const effect = makeShaderEffect(SEARCHLIGHT_SKSL, 'SearchlightScene');

// Art-deco skyline: [xFrac where the step starts, height in px above the deck line]. Stepped
// setbacks with two tall premiere-district towers.
const CITY_STEPS: [number, number][] = [
  [0.0, 40], [0.06, 62], [0.10, 96], [0.135, 118], [0.16, 96], [0.19, 60],
  [0.24, 84], [0.30, 130], [0.325, 148], [0.35, 130], [0.40, 74],
  [0.47, 96], [0.52, 58], [0.60, 118], [0.625, 140], [0.65, 118], [0.71, 66],
  [0.78, 92], [0.84, 120], [0.87, 92], [0.93, 54], [1.0, 70],
];

function cityPath(w: number, deckY: number): string {
  let d = `M0 ${(deckY + 4).toFixed(1)} L0 ${(deckY - CITY_STEPS[0][1]).toFixed(1)}`;
  let prevH = CITY_STEPS[0][1];
  for (let i = 1; i < CITY_STEPS.length; i++) {
    const [fx, h] = CITY_STEPS[i];
    const x = (fx * w).toFixed(1);
    d += ` L${x} ${(deckY - prevH).toFixed(1)} L${x} ${(deckY - h).toFixed(1)}`;
    prevH = h;
  }
  return `${d} L${w} ${(deckY - prevH).toFixed(1)} L${w} ${(deckY + 4).toFixed(1)} Z`;
}

// Sparse amber tungsten windows: [xFrac, px above the deck line, opacity].
const WINDOWS: [number, number, number][] = [
  [0.045, 30, 0.4], [0.115, 62, 0.34], [0.145, 88, 0.45], [0.205, 44, 0.3],
  [0.26, 58, 0.4], [0.315, 112, 0.5], [0.335, 96, 0.32], [0.48, 70, 0.42],
  [0.545, 40, 0.3], [0.61, 92, 0.45], [0.635, 76, 0.3], [0.74, 68, 0.4],
  [0.80, 96, 0.35], [0.86, 78, 0.45], [0.90, 40, 0.3], [0.955, 48, 0.35],
];

const STARS: [number, number, number, number][] = [
  [0.12, 0.30, 1.1, 0.5], [0.46, 0.285, 0.9, 0.38], [0.83, 0.315, 1.0, 0.45],
];

export type SearchlightSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

export default function SearchlightScene({ skin, active, focused = true, anchorX, anchorY, measured = false }: SearchlightSceneProps) {
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();

  // DRIFT clock: cloud motion breathes lit or unlit (gated on focus + reduced motion only).
  const { clock: drift } = useGatedClock(focused && !reduce);
  // SWEEP clock: the shared contract t. Gated like the beam layer's, and zeroed on the real
  // unlit-to-lit edge below so all three layers sweep in lockstep.
  const { clock: sweep } = useGatedClock(active && focused && !reduce);
  const prevActive = useRef(active);
  useEffect(() => {
    const was = prevActive.current;
    prevActive.current = active;
    if (active && !was) sweep.value = 0;
  }, [active, sweep]);

  // Lit ramp: initialized to the end state so a mount while already lit shows the disc up.
  const lit = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    cancelAnimation(lit);
    if (reduce) { lit.value = active ? 1 : 0; return; }
    lit.value = withTiming(active ? 1 : 0, { duration: active ? 600 : 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce]);
  useEffect(() => () => { cancelAnimation(lit); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry, anchored to the measured structure box (ANCHOR SEMANTICS: anchorY is the lens
  // center, viewBox (50, 30); structureBottom = anchorY + (1 - origin) * 180 = anchorY + 126).
  const aX = measured && anchorX != null ? anchorX : W * 0.5;
  const structBottom = measured && anchorY != null ? anchorY + (1 - skin.origin) * 180 : H * 0.72;
  const lensY = structBottom - (1 - skin.origin) * 180; // = anchorY when measured
  const deckY = Math.min(Math.max(structBottom - DECK_BELOW_BOTTOM, H * 0.5), H * 0.88);
  const bandH = Math.round(H * CLOUD_FRAC);
  const parY = Math.max(deckY + 70, H * 0.88);
  const bulkX = W * 0.05;
  const bulkW = W * 0.17;
  const bulkY = deckY + 6;

  const uniforms = useDerivedValue(
    () => ({
      u_time: drift.value,
      u_sweep: sweep.value,
      u_lit: lit.value,
      u_res: [W, bandH],
      u_h: H,
      u_anchor: [aX, lensY],
      u_static: reduce ? 1 : 0,
    }),
    [W, H, bandH, aX, lensY, reduce]
  );

  // Arc spill on the rooftop while lit: cool edge strokes + one linear wash, opacity = lit.
  const spillProps = useAnimatedProps(() => ({ opacity: lit.value }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      <Svg pointerEvents="none" style={styles.fill} width={W} height={H}>
        <Defs>
          {/* charcoal-indigo night; the cloud shader mixes the SAME stops over page y, so the
              band's bottom edge never shows a seam */}
          <LinearGradient id="slSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#080A12" />
            <Stop offset="100%" stopColor="#191E33" />
          </LinearGradient>
          <LinearGradient id="slAmber" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#FF9E4A" stopOpacity={0} />
            <Stop offset="100%" stopColor="#FF9E4A" stopOpacity={0.09} />
          </LinearGradient>
          <LinearGradient id="slWash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#BFD9F2" stopOpacity={0.12} />
            <Stop offset="100%" stopColor="#BFD9F2" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="slScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.5} />
            <Stop offset="22%" stopColor="#000" stopOpacity={0} />
            <Stop offset="78%" stopColor="#000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0.58} />
          </LinearGradient>
        </Defs>

        {/* ===== NIGHT SKY + a few faint stars below the cloud band ===== */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#slSky)" />
        {STARS.map(([fx, fy, r, o], i) => (
          <Circle key={`st${i}`} cx={W * fx} cy={H * fy} r={r} fill="#FFFFFF" opacity={o} />
        ))}

        {/* ===== THE CITY: amber haze, stepped art-deco skyline, water tower, masts, windows ===== */}
        <Rect x={0} y={deckY - 96} width={W} height={96} fill="url(#slAmber)" />
        <Path d={cityPath(W, deckY)} fill="#10131D" />
        {/* water tower on the 0.40 block */}
        <G>
          <Line x1={W * 0.43 - 9} y1={deckY - 74} x2={W * 0.43 - 11} y2={deckY - 86} stroke="#0D1017" strokeWidth={2} />
          <Line x1={W * 0.43 + 9} y1={deckY - 74} x2={W * 0.43 + 11} y2={deckY - 86} stroke="#0D1017" strokeWidth={2} />
          <Rect x={W * 0.43 - 13} y={deckY - 106} width={26} height={21} rx={2} fill="#0D1017" />
          <Path d={`M${W * 0.43 - 14} ${deckY - 106} L${W * 0.43} ${deckY - 117} L${W * 0.43 + 14} ${deckY - 106} Z`} fill="#0D1017" />
        </G>
        {/* thin antenna masts on the two towers */}
        <Line x1={W * 0.337} y1={deckY - 148} x2={W * 0.337} y2={deckY - 176} stroke="#0D1017" strokeWidth={1.1} />
        <Circle cx={W * 0.337} cy={deckY - 177} r={0.9} fill="#1A2030" />
        <Line x1={W * 0.855} y1={deckY - 120} x2={W * 0.855} y2={deckY - 142} stroke="#0D1017" strokeWidth={1} />
        {WINDOWS.map(([fx, up, o], i) => (
          <Rect key={`wn${i}`} x={W * fx - 1.7} y={deckY - up} width={3.4} height={4.6} fill="#FFBE6E" opacity={o} />
        ))}

        {/* ===== THE ROOFTOP: deck under the structure's feet, bulkhead, cable, parapet ===== */}
        <Rect x={0} y={deckY} width={W} height={Math.max(0, H - deckY)} fill="#0B0D13" />
        <Line x1={0} y1={deckY + 18} x2={W} y2={deckY + 18} stroke="#070910" strokeWidth={1} opacity={0.6} />
        <Line x1={0} y1={deckY + 42} x2={W} y2={deckY + 42} stroke="#070910" strokeWidth={1} opacity={0.6} />
        {/* roof-access bulkhead, its cap silhouetted against the city */}
        <Path d={`M${bulkX - 6} ${bulkY} L${bulkX + bulkW * 0.55} ${bulkY - 14} L${bulkX + bulkW + 6} ${bulkY} Z`} fill="#12151F" />
        <Rect x={bulkX} y={bulkY} width={bulkW} height={52} fill="#0F121B" />
        <Rect x={bulkX + bulkW * 0.58} y={bulkY + 16} width={13} height={36} fill="#080A10" />
        {/* the searchlight's power cable continuing along the deck, off-frame right */}
        <Path
          d={`M${aX + 88} ${deckY + 7} C${aX + 130} ${deckY + 16} ${aX + 168} ${deckY + 9} ${W + 12} ${deckY + 24}`}
          stroke="#08090D"
          strokeWidth={3.4}
          strokeLinecap="round"
          fill="none"
        />
        {/* parapet ledge with coping stones spanning the bottom */}
        <Rect x={0} y={parY} width={W} height={Math.max(0, H - parY)} fill="#12151F" />
        {Array.from({ length: Math.ceil(W / 36) + 1 }, (_, i) => (
          <Rect key={`cp${i}`} x={i * 36 - 4} y={parY - 6.5} width={30} height={6.5} rx={1} fill={i % 2 ? '#1B2130' : '#1F2534'} />
        ))}
        <Line x1={0} y1={parY - 6.8} x2={W} y2={parY - 6.8} stroke="#2A3142" strokeWidth={0.7} opacity={0.5} />

        {/* ===== ARC SPILL while lit: cool blue-white edge light on the rooftop (no glow balls,
             one linear wash on the flat deck + edge strokes) ===== */}
        <AnimatedG animatedProps={spillProps}>
          <Rect x={aX - 120} y={deckY} width={240} height={80} fill="url(#slWash)" />
          <Line x1={aX - 96} y1={deckY + 0.6} x2={aX + 96} y2={deckY + 0.6} stroke="#BFD9F2" strokeWidth={1} opacity={0.22} />
          <Line x1={aX - 80} y1={parY - 6.8} x2={aX + 80} y2={parY - 6.8} stroke="#BFD9F2" strokeWidth={0.8} opacity={0.25} />
          <Line x1={bulkX + bulkW} y1={bulkY - 2} x2={bulkX + bulkW} y2={bulkY + 40} stroke="#BFD9F2" strokeWidth={0.7} opacity={0.2} />
        </AnimatedG>

        {/* Legibility scrim: bottom ramp here, the top ramp lives inside the cloud shader */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#slScrim)" />
      </Svg>

      {/* ===== THE CLOUD BAND (Skia): top 26% of the screen. Skipped entirely if the shader
           failed to compile: the SVG night above stands alone (no clouds, never blank). ===== */}
      {effect ? (
        <Canvas style={[styles.band, { width: W, height: bandH }]}>
          <Fill>
            <Shader source={effect} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
  band: { position: 'absolute', top: 0, left: 0 },
  // Opaque dark base so a not-yet-painted frame never flashes the page background through.
  base: { backgroundColor: '#05070C' },
});
