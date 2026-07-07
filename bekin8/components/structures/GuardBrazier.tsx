// components/structures/GuardBrazier.tsx
// The "Old Guard" tap target: a big FORGED-IRON CRESSET (fire basket) on a hewn stone plinth, a
// castle-wall watchfire. Wide open rib basket (rim = flame seat at y=38, rim ribs span x 23.5..76.5)
// over a riveted rim band, a rough MOUND of pitch-pine billets piled inside the cage with its crest
// rising above the rim, a shallow ash-catch pan under the lattice bottom, a forged stem with a
// collar, and a cold stone plinth with chisel lines.
// Unlit: a pure static silhouette with warm edge lighting (nothing pulses, no glow); the fuel mound
// reads as dark cold wood waiting to burn. Lit: the WHOLE MOUND goes incandescent, a vertical
// white-gold -> orange -> deep ember gradient shaped by the mound + rib openings (never a radial
// ball), with the dark ribs silhouetted over it, thin hot inner-edge rims on the ribs, tiny static
// flame licks poking through the side openings, and a warm glow through the lattice bottom onto the
// ash pan + a faint linear wash down the plinth cap. The BIG flame itself is the full-screen Skia
// layer, anchored at this skin's registry origin 0.38 (seat line y=38 here); the mound crest peaks
// ~4 units above the seat so the Skia flame rises OUT of the burning fuel. Authored 0..100; 180x180.
import React, { useEffect, useState } from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Ellipse, Line, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);

// Forged iron
const IRON = '#444B5A';
const IRON_HI = '#5A6478';
const IRON_DK = '#2B3242';
const IRON_STEM = '#3A4152';
// Cold stone
const STONE = '#2A3346';
const STONE_SH = '#1E2636';
const STONE_LINE = '#1A2231';
const STONE_HI = '#3E4A63';
// Warm accents (rim light + lit edge glow)
const WARM_EDGE = '#D8B488';
const EMBER = '#FF9A3C';
const EMBER_HI = '#FFB35C';
// Pitch-pine fuel mound (cold)
const FUEL = '#33241A';
const FUEL_DK = '#221710';
const FUEL_HI = '#4A3422';
const FUEL_EDGE = '#1F150E';
// Incandescent fuel (lit gradient stops)
const INCAND_HI = '#FFF2C8';
const INCAND_MID = '#FF8A2A';
const INCAND_LO = '#C2340F';

// The five basket ribs, rim (y=40.8) down to the boss (y~62). Reused for the lit inner-edge glow.
const RIB_OUT_L = 'M23.5 40.8 C26 51 33.5 59 44 61.6';
const RIB_MID_L = 'M36.5 40.8 C38 51.5 42.5 59.5 47.5 61.8';
const RIB_CENTER = 'M50 40.8 L50 62';
const RIB_MID_R = 'M63.5 40.8 C62 51.5 57.5 59.5 52.5 61.8';
const RIB_OUT_R = 'M76.5 40.8 C74 51 66.5 59 56 61.6';
const RIBS_L = [RIB_OUT_L, RIB_MID_L];
const RIBS_R = [RIB_MID_R, RIB_OUT_R];
const RIBS_ALL = [RIB_OUT_L, RIB_MID_L, RIB_CENTER, RIB_MID_R, RIB_OUT_R];

// The fuel mound: a lumpy crest of piled billets rising above the rim (peak ~y 33.5, ~4 units above
// the y=38 flame seat), then following the outer rib curves down to the lattice bottom at y~61.6.
// One shared path: cold wood fill when unlit, incandescent gradient fill when lit, so the glow is
// always shaped by the cage geometry.
const MOUND =
  'M23.8 40.9 ' +
  'C25.2 39.1 27.3 38 29.8 37.4 ' +
  'C30.9 35.7 33.4 34.8 35.8 35.6 ' +
  'C37.1 33.8 40.1 33.1 42.3 34.2 ' +
  'C43.9 32.9 47.5 32.5 49.6 34 ' +
  'C51.7 33 54.7 33.4 56.3 34.7 ' +
  'C58.7 33.9 61.3 34.6 62.7 36.1 ' +
  'C65.3 35.5 67.7 36.4 69.3 37.7 ' +
  'C71.8 38.2 74.5 39.2 76.2 40.9 ' +
  'C74 51 66.5 59 56 61.6 L44 61.6 C33.5 59 26 51 23.8 40.9 Z';

export default function GuardBrazier({ lit = false, size = 180, focused = true }: { lit?: boolean; size?: number; focused?: boolean }) {
  const reduce = useReducedMotion();
  const glow = useSharedValue(lit ? 1 : 0); // lit warmth: incandescent mound + rib rims + washes
  // Mount the lit-warmth layers ONLY while lit (+ a fade tail) so unlit is unambiguously cold iron.
  const [glowing, setGlowing] = useState(lit);
  useEffect(() => {
    if (lit) {
      setGlowing(true);
      return;
    }
    const t = setTimeout(() => setGlowing(false), 480);
    return () => clearTimeout(t);
  }, [lit]);

  useEffect(() => {
    // Blur acts like reduced motion: skip the crossfade and pin static values while covered.
    const still = reduce || !focused;
    cancelAnimation(glow);
    if (lit) {
      glow.value = still ? 1 : withTiming(1, { duration: 480 });
    } else {
      glow.value = still ? 0 : withTiming(0, { duration: 420 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, reduce, focused]);

  useEffect(() => () => { cancelAnimation(glow); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Two layers ride the same ramp: the incandescent mound sits UNDER the ribs (fuel glowing through
  // a cage); the hot edge details sit OVER the ironwork.
  const litCoreProps = useAnimatedProps(() => ({ opacity: glow.value }));
  const litEdgeProps = useAnimatedProps(() => ({ opacity: glow.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* Incandescent fuel: white-gold at the crest (where the Skia flame base sits) down to deep
            ember red at the lattice bottom. Pinned in user space so the ramp tracks the geometry. */}
        <LinearGradient id="gbzIncand" x1="50" y1="33.5" x2="50" y2="62.5" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={INCAND_HI} />
          <Stop offset="0.42" stopColor={INCAND_MID} />
          <Stop offset="1" stopColor={INCAND_LO} />
        </LinearGradient>
        <LinearGradient id="gbzPlinthWash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={EMBER_HI} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={EMBER_HI} stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* Ground shadow */}
      <Ellipse cx="50" cy="96.6" rx="31" ry="2" fill="#060910" opacity={0.5} />

      {/* ===== STONE PLINTH (y 72..96) ===== */}
      {/* base course */}
      <Rect x="24" y="90" width="52" height="6.5" rx="1" fill="#232C3D" />
      <Rect x="60" y="90" width="16" height="6.5" rx="1" fill="#1B2331" />
      <Line x1="25" y1="90.5" x2="75" y2="90.5" stroke={STONE_HI} strokeWidth="0.5" opacity={0.7} />
      {/* main block */}
      <Rect x="31" y="78" width="38" height="12" fill={STONE} />
      <Rect x="60" y="78" width="9" height="12" fill={STONE_SH} />
      <Line x1="50" y1="78" x2="50" y2="90" stroke={STONE_LINE} strokeWidth="0.6" opacity={0.8} />
      {/* chisel-line details */}
      <Path d="M35 81.5 l4.5 -1.5" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.8} />
      <Path d="M40 86.5 l5 -1.8" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.8} />
      <Path d="M54 82.5 l4.5 -1.6" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.8} />
      <Path d="M57 87.5 l4 -1.4" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.7} />
      <Line x1="31.6" y1="78.5" x2="31.6" y2="89.5" stroke={STONE_HI} strokeWidth="0.5" opacity={0.55} />
      {/* capstone */}
      <Rect x="27" y="72" width="46" height="6" rx="1" fill={STONE} />
      <Rect x="58" y="72" width="15" height="6" rx="1" fill={STONE_SH} />
      <Path d="M33 76 l5 -1.6" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.8} />
      <Path d="M62 75.5 l4.5 -1.5" stroke={STONE_LINE} strokeWidth="0.5" opacity={0.7} />
      {/* warm edge lighting: the watchfire scene keys warm even before it burns */}
      <Line x1="28" y1="72.6" x2="72" y2="72.6" stroke={WARM_EDGE} strokeWidth="0.7" opacity={0.4} />
      <Line x1="27.6" y1="73" x2="27.6" y2="77.5" stroke={WARM_EDGE} strokeWidth="0.6" opacity={0.3} />
      <Line x1="25" y1="90.4" x2="75" y2="90.4" stroke={WARM_EDGE} strokeWidth="0.5" opacity={0.2} />

      {/* ===== FORGED STEM + ASH PAN + COLLAR (y 62..72) ===== */}
      <Path d="M46.4 62.5 L45.8 72 L54.2 72 L53.6 62.5 Z" fill={IRON_STEM} />
      <Path d="M50 62.5 L50 72 L54.2 72 L53.6 62.5 Z" fill="#2F3646" />
      <Line x1="47.1" y1="63" x2="46.7" y2="71.5" stroke={IRON_HI} strokeWidth="0.6" opacity={0.8} />
      {/* shallow ash-catch pan: a thin dark dish under the lattice bottom, above the collar */}
      <Path d="M38.5 63.4 C41.5 66 58.5 66 61.5 63.4 L60.2 65.6 C56 67.2 44 67.2 39.8 65.6 Z" fill={IRON_DK} />
      <Path d="M38.5 63.4 C41.5 66 58.5 66 61.5 63.4" stroke={IRON_HI} strokeWidth="0.4" fill="none" opacity={0.5} />
      <Rect x="44.5" y="66" width="11" height="3" rx="1.2" fill={IRON} />
      <Line x1="45.4" y1="66.6" x2="54.6" y2="66.6" stroke={IRON_HI} strokeWidth="0.5" opacity={0.9} />
      <Circle cx="46.8" cy="67.5" r="0.6" fill={IRON_DK} />
      <Circle cx="53.2" cy="67.5" r="0.6" fill={IRON_DK} />

      {/* ===== FIRE BASKET + FUEL MOUND (rim/seat y=38, crest ~y34, lattice bottom y~62) ===== */}
      {/* cold fuel mound: pitch-pine billets and chunks piled inside the cage, crest above the rim */}
      <Path d={MOUND} fill={FUEL} />
      {/* depth shading toward the lattice bottom */}
      <Ellipse cx="50" cy="58.5" rx="14.5" ry="4.2" fill={FUEL_DK} opacity={0.6} />
      {/* billet ends on the crest (rough sawn faces with growth rings) */}
      <Ellipse cx="36.8" cy="36.4" rx="2" ry="1.7" fill={FUEL} stroke={FUEL_EDGE} strokeWidth="0.5" />
      <Circle cx="36.8" cy="36.4" r="0.9" fill="none" stroke={FUEL_HI} strokeWidth="0.45" />
      <Ellipse cx="49.4" cy="34.9" rx="2.3" ry="2" fill={FUEL} stroke={FUEL_EDGE} strokeWidth="0.5" />
      <Circle cx="49.4" cy="34.9" r="1.1" fill="none" stroke={FUEL_HI} strokeWidth="0.45" />
      <Line x1="49.4" y1="33.5" x2="49.4" y2="36.3" stroke={FUEL_EDGE} strokeWidth="0.4" />
      <Ellipse cx="61.6" cy="36.3" rx="1.9" ry="1.6" fill={FUEL} stroke={FUEL_EDGE} strokeWidth="0.5" />
      <Circle cx="61.6" cy="36.3" r="0.85" fill="none" stroke={FUEL_HI} strokeWidth="0.45" />
      {/* angled billet edges across the pile */}
      <Path d="M27.8 39.4 L33.6 37" stroke={FUEL_EDGE} strokeWidth="0.55" opacity={0.85} />
      <Path d="M40.2 35.7 L45.2 34" stroke={FUEL_EDGE} strokeWidth="0.55" opacity={0.85} />
      <Path d="M53.6 34.5 L59 35.8" stroke={FUEL_EDGE} strokeWidth="0.55" opacity={0.85} />
      <Path d="M65.8 37 L71.4 39.1" stroke={FUEL_EDGE} strokeWidth="0.55" opacity={0.8} />
      {/* warm edge lighting on the crest (static, matches the plinth's rim light; no glow) */}
      <Path d="M30.2 37.2 C33.5 35.1 38.5 33.7 43 33.9" stroke={WARM_EDGE} strokeWidth="0.5" fill="none" opacity={0.28} />
      {/* dark chunks read through the side openings between the ribs */}
      <Path d="M27.5 43.5 L31.5 42.6 L33 45.4 L29 46.6 Z" fill={FUEL_DK} stroke={FUEL_HI} strokeWidth="0.35" strokeOpacity={0.5} />
      <Path d="M41 47.5 L45.6 46.6 L47 50 L42.2 51 Z" fill={FUEL_DK} stroke={FUEL_HI} strokeWidth="0.35" strokeOpacity={0.5} />
      <Path d="M55 46.8 L59.4 47.6 L58.2 50.8 L54 49.8 Z" fill={FUEL_DK} stroke={FUEL_HI} strokeWidth="0.35" strokeOpacity={0.5} />
      <Path d="M66.4 43.2 L70.4 44.2 L69 47 L65.4 45.8 Z" fill={FUEL_DK} stroke={FUEL_HI} strokeWidth="0.35" strokeOpacity={0.5} />

      {/* lit: the whole mound goes incandescent UNDER the ironwork, so the ribs and rim band
          silhouette against glowing fuel (shaped by the cage, never a floating radial ball) */}
      {glowing && (
        <AnimatedG animatedProps={litCoreProps}>
          <Path d={MOUND} fill="url(#gbzIncand)" />
        </AnimatedG>
      )}

      {/* curved iron ribs + forged highlights, drawn OVER the fuel */}
      {RIBS_ALL.map((d, i) => (
        <Path key={`rib${i}`} d={d} stroke={IRON} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      ))}
      <G transform="translate(-0.7, 0)" opacity={0.85}>
        {RIBS_ALL.map((d, i) => (
          <Path key={`ribHi${i}`} d={d} stroke={IRON_HI} strokeWidth="0.8" strokeLinecap="round" fill="none" />
        ))}
      </G>
      {/* latticework bottom: crossed straps just above the boss */}
      <Path d="M43.5 58.6 L56.5 61.3" stroke={IRON} strokeWidth="0.9" opacity={0.95} />
      <Path d="M56.5 58.6 L43.5 61.3" stroke={IRON} strokeWidth="0.9" opacity={0.95} />
      {/* boss where the ribs are forged into the stem */}
      <Ellipse cx="50" cy="62.2" rx="8.5" ry="2.4" fill={IRON_STEM} />
      <Path d="M42.5 61.8 Q50 59.9 57.5 61.8" stroke={IRON_HI} strokeWidth="0.6" fill="none" opacity={0.8} />

      {/* heavy riveted rim band (top edge = the flame seat, y=38 at its middle line) */}
      <Rect x="20.5" y="37" width="59" height="4" rx="1.6" fill={IRON} />
      <Line x1="22" y1="37.8" x2="78" y2="37.8" stroke={IRON_HI} strokeWidth="0.9" opacity={0.95} />
      <Line x1="22" y1="40.4" x2="78" y2="40.4" stroke={IRON_DK} strokeWidth="0.6" />
      {/* warm rim light along the band so the silhouette pops off the dark wall */}
      <Line x1="22.5" y1="37.2" x2="77.5" y2="37.2" stroke={WARM_EDGE} strokeWidth="0.6" opacity={0.5} />
      {/* rivets at each rib attachment */}
      {[23.5, 36.5, 50, 63.5, 76.5].map((x) => (
        <Circle key={`riv${x}`} cx={x} cy={39} r="0.75" fill={IRON_DK} stroke={IRON_HI} strokeWidth="0.3" />
      ))}

      {/* lit: hot details OVER the ironwork: rib inner-edge rims, tiny flame licks through the side
          openings, glow through the lattice bottom onto the ash pan, linear wash down the plinth */}
      {glowing && (
        <AnimatedG animatedProps={litEdgeProps}>
          <G transform="translate(1, 0)">
            {RIBS_L.map((d, i) => (
              <Path key={`glowL${i}`} d={d} stroke={EMBER} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity={0.85} />
            ))}
          </G>
          <G transform="translate(-1, 0)">
            {RIBS_R.map((d, i) => (
              <Path key={`glowR${i}`} d={d} stroke={EMBER} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity={0.85} />
            ))}
          </G>
          <Path d={RIB_CENTER} stroke={EMBER} strokeWidth="0.7" strokeLinecap="round" fill="none" opacity={0.7} />
          <Line x1="24" y1="41.2" x2="76" y2="41.2" stroke={EMBER_HI} strokeWidth="0.8" opacity={0.8} />
          {/* tiny static flame licks poking through the side openings just below the rim */}
          <Path d="M29.2 46 C28 43.9 28.5 42.2 29.9 40.9 C31.2 42.3 31.6 44.2 30.6 46 Z" fill={INCAND_MID} opacity={0.95} />
          <Path d="M29.6 45.3 C29 44.1 29.3 43 30 42.2 C30.7 43 30.9 44.2 30.3 45.3 Z" fill={INCAND_HI} opacity={0.9} />
          <Path d="M68.4 45.6 C67.4 43.8 67.9 42.3 69.1 41.2 C70.2 42.4 70.5 44 69.6 45.6 Z" fill={INCAND_MID} opacity={0.95} />
          <Path d="M68.8 45 C68.3 44 68.6 43.1 69.2 42.4 C69.8 43.1 70 44.1 69.4 45 Z" fill={INCAND_HI} opacity={0.9} />
          <Path d="M57.4 47.2 C56.7 45.8 57.1 44.6 58 43.8 C58.9 44.7 59.1 45.9 58.4 47.2 Z" fill={INCAND_MID} opacity={0.9} />
          {/* embers glowing through the lattice bottom, onto the ash pan */}
          <Circle cx="46.6" cy="60.7" r="0.6" fill={INCAND_HI} opacity={0.9} />
          <Circle cx="53.8" cy="61.1" r="0.55" fill={INCAND_HI} opacity={0.85} />
          <Path d="M42.5 62.6 Q50 64.7 57.5 62.6" stroke={EMBER} strokeWidth="0.8" fill="none" opacity={0.6} />
          <Path d="M40.5 63.9 C44 65.7 56 65.7 59.5 63.9" stroke={EMBER} strokeWidth="0.6" fill="none" opacity={0.5} />
          <Line x1="47.1" y1="63" x2="46.7" y2="71.5" stroke={EMBER_HI} strokeWidth="0.5" opacity={0.5} />
          <Rect x="27" y="72" width="46" height="6" rx="1" fill="url(#gbzPlinthWash)" />
        </AnimatedG>
      )}
    </Svg>
  );
}
