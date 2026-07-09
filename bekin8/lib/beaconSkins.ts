// lib/beaconSkins.ts
// Data-driven beacon SKINS. Every per-skin knob is config here, so the scene / structure / fire /
// smoke / sound layers just read a skin and render; adding or retuning a skin never touches engine
// code. Each skin is a full bespoke procedural scene (SVG + Skia, no photos) in its own art style:
//   campfire    - storybook night clearing (DEFAULT)
//   oldguard    - castle battlement watchfire
//   bonfire     - dusk festival blaze (explosive ignition)
//   beacons     - LOTR signal chain across a mountain range
//   aurora      - arctic rune stone that lights the northern sky (replaces the old wisp)
//   tower       - Paul Revere's two lanterns, close up
//   lighthouse  - coastal tower + sweeping beam over an animated sea
//   smokesignal - golden-hour mesa fire speaking in discrete white puffs
//   fireworks   - festival rocket over a harbor night; launches + bursts while lit
//   skylanterns - Yi Peng riverside: light a khom loi, release it, the sky answers in lanterns
//   searchlight - 1930s premiere carbon-arc on a city rooftop; its shaft signs the cloud deck
//   storm       - a weathered sky-altar that calls down a real lightning strike
// The `fire` / `smokeKind` fields are AUTHORITATIVE for which overlay layers home renders; nothing
// is hardcoded per structure anymore.

export type BeaconStructureKind =
  | 'logs'
  | 'brazier'
  | 'bonfire'
  | 'mountains'
  | 'aurora'
  | 'tower'
  | 'lighthouse'
  | 'smokesignal'
  | 'fireworks'
  | 'skylantern'
  | 'searchlight'
  | 'storm';

/** Which full-screen overlay renders in home's FIRE slot (topmost, pointerEvents none). 'beam'
 *  routes by structure (lighthouse sweep vs the premiere searchlight's shaft); 'bolt' is the storm
 *  skin's ignition lightning strike (a short-lived front layer, not a persistent fire). */
export type BeaconFireKind = 'flame' | 'beam' | 'bolt' | 'none';
/** Which full-screen overlay renders in home's SMOKE slot. Despite the name this is really the
 *  "behind-the-friend-tiles effect" slot: the smoke-signal puffs, the fireworks launches/bursts,
 *  and the sky-lantern field render here too, so tiles (priority info) always read over them. */
export type BeaconSmokeKind = 'ambient' | 'signal' | 'fireworks' | 'lanterns' | 'none';

export type BeaconSkin = {
  id: string;
  label: string;
  blurb: string;
  structure: BeaconStructureKind;
  /** Overlay dispatch: what home renders in the fire slot / smoke slot for this skin. */
  fire: BeaconFireKind;
  smokeKind: BeaconSmokeKind;
  /** Where the flame BASE sits within the 180px structure box (0 = top, 1 = bottom). MUST match the
   *  seat line documented in the structure component (0..100 viewBox y / 100). */
  origin: number;
  /** Overall flame scale: Skia flame height = 170 * flameScale px. */
  flameScale: number;
  /** Skia flame CHARACTER, so each skin's fire moves differently (not just recolored):
   *  width = half-width as a fraction of flame height (base shader used 0.42),
   *  turb  = sway/turbulence multiplier (1 = base), speed = vertical noise scroll (base 2.4). */
  flameShape: { width: number; turb: number; speed: number };
  /** Flame gradient stops [bottom (hot), top (cool)]. Skia fire reads core[0]/mid[0]/outer[1]. */
  outer: [string, string];
  mid: [string, string];
  core: [string, string];
  /** Warm glow halo behind the flame (glow.center also colors the lighthouse beam). */
  glow: { center: string; edge: string; cy: number; rx: number; ry: number };
  /** Idle flicker amplitudes + speed (SVG fallback flame only). */
  flicker: { sy: number; sx: number; rot: number; period: number };
  ember: { color: string; count: number };
  spark: { color: string; count: number };
  /** Ignition spring + dramatic extras (screen shake + expanding shockwave ring). */
  ignition: { damping: number; stiffness: number; shake: boolean; shockwave: boolean };
  smoke: {
    tintLow: string; // warm, near the fire (SVG fallback smoke only; Skia smoke is neutral)
    tintHigh: string; // cool, up high
    opacity: number; // ambient density (Skia: clamp(opacity*2, .35, 1)); signal column density too
    plumes: number; // ambient smoke on/off gate + SVG plume count
    rise: number;
    drift: number;
  };
  /** Per-skin SFX + optional volume trims (1 = engine default). The lantern tower's piano needs to
   *  sit further back than a crackle does. loopMode 'linear' plays the crackle clip start-to-end
   *  on loop from the lit edge (the fireworks show clip is authored to the burst shader's exact
   *  20s schedule); default 'seamless' is the random-window crossfade loop. */
  sound: { ignite: number; crackle: number; igniteVol?: number; crackleVol?: number; loopMode?: 'seamless' | 'linear' };
  /** Tappable-hint copy + a contrast color for the "Tap the {noun}" prompt over THIS skin's scene. */
  tap: { noun: string; tint: string };
};

// Campfire (DEFAULT): a STORYBOOK night clearing. Soft-painted pines, moon, fireflies; the tap target
// is a big readable log teepee on a stone ring with a breathing ember hint while unlit. Real Skia
// flame + ambient smoke when lit (the old pixel-art WebP pit is gone).
const CAMPFIRE: BeaconSkin = {
  id: 'campfire',
  label: 'Campfire',
  blurb: 'A cozy campfire in a moonlit forest clearing.',
  structure: 'logs',
  fire: 'flame',
  smokeKind: 'ambient',
  // CONE-FROM-WOOD rule (user): the flame base must match the wood's width where it emerges, so the
  // seat sits INSIDE the stack (the wood above the seat burns inside the flame), never perched on a
  // narrow tip with a wider flame floating over it.
  origin: 0.62, // seat inside the teepee, where the log spread is ~61px wide
  flameScale: 0.9,
  flameShape: { width: 0.23, turb: 1.0, speed: 2.4 }, // base ~61px = teepee width at the seat
  outer: ['#FF8A1F', '#D8431A'],
  mid: ['#FFC24A', '#FF7A1A'],
  core: ['#FFF7D6', '#FFCE3E'],
  glow: { center: '#FFD89A', edge: '#FF8A2A', cy: -64, rx: 52, ry: 80 },
  flicker: { sy: 0.1, sx: 0.05, rot: 3, period: 1.5 },
  ember: { color: '#FFCF7A', count: 3 },
  spark: { color: '#FFE0A0', count: 8 },
  ignition: { damping: 12, stiffness: 170, shake: false, shockwave: false }, // quick cozy kindle
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0.3, plumes: 5, rise: 1.0, drift: 24 },
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
  tap: { noun: 'campfire', tint: '#FFE7B0' },
};

// Old Guard: a WATCHFIRE ON THE CASTLE WALL. Battlement parapet spans the bottom, the beacon is a
// forged-iron fire basket on a stone plinth; lighting it washes the stonework warm.
const OLD_GUARD: BeaconSkin = {
  ...CAMPFIRE,
  id: 'oldguard',
  label: 'Old Guard',
  blurb: 'A watchfire basket burning on the castle wall.',
  structure: 'brazier',
  origin: 0.38, // basket rim seat line (y=38); the flame emerges at exactly the rim's width
  flameScale: 1.0,
  flameShape: { width: 0.32, turb: 0.9, speed: 2.2 }, // base ~95px = the rib basket's rim span
  ignition: { damping: 15, stiffness: 135, shake: false, shockwave: false }, // dignified, steady
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0.32, plumes: 7, rise: 1.0, drift: 26 },
  sound: { ignite: require('../assets/sounds/oldguard-ignite.m4a'), crackle: require('../assets/sounds/oldguard-crackle.m4a') },
  tap: { noun: 'watchfire', tint: '#F1E6CE' },
};

// Bonfire: a DUSK FESTIVAL blaze. Bright warm dusk even while unlit (never a dark screen); a big
// stacked teepee pyre that goes up with a boom: spring overshoot + screen shake + shockwave ring.
const BONFIRE: BeaconSkin = {
  ...CAMPFIRE,
  id: 'bonfire',
  label: 'Bonfire',
  blurb: 'A towering festival blaze that lights with a boom.',
  structure: 'bonfire',
  origin: 0.66, // seat deep in the stack: a real bonfire's flames engulf most of the pyre
  flameScale: 1.35,
  flameShape: { width: 0.23, turb: 1.35, speed: 3.2 }, // base ~90px = pole spread at the seat; wild + fast
  outer: ['#FF7A14', '#C81E0E'],
  mid: ['#FFB347', '#FF6A14'],
  core: ['#FFF4D0', '#FFC23D'],
  glow: { center: '#FFD89A', edge: '#FF6A1A', cy: -78, rx: 72, ry: 100 },
  flicker: { sy: 0.18, sx: 0.08, rot: 4, period: 1.0 },
  ember: { color: '#FFB24A', count: 5 },
  spark: { color: '#FFE0A0', count: 20 },
  ignition: { damping: 7, stiffness: 195, shake: true, shockwave: true }, // explosive
  smoke: { tintLow: '#8A8078', tintHigh: '#9AA0A8', opacity: 0.55, plumes: 10, rise: 1.0, drift: 30 },
  sound: { ignite: require('../assets/sounds/bonfire-ignite.m4a'), crackle: require('../assets/sounds/bonfire-crackle.m4a') },
  tap: { noun: 'bonfire', tint: '#FFE3C0' },
};

// The Beacons: the LOTR SIGNAL CHAIN. Cold pre-dawn ridgelines receding into haze; lighting your
// foreground pyre kindles a chain of distant beacons one after another, deep into the range.
const BEACONS: BeaconSkin = {
  ...CAMPFIRE,
  id: 'beacons',
  label: 'The Beacons',
  blurb: 'Light yours, and watch the mountains answer.',
  structure: 'mountains',
  origin: 0.54, // seat at the upper course, so the crown burns inside the flame
  flameScale: 0.8,
  flameShape: { width: 0.27, turb: 0.7, speed: 1.8 }, // base ~63px = the upper log's span; calm column
  outer: ['#FFC56B', '#FF9A3C'],
  mid: ['#FFE0A0', '#FFB347'],
  core: ['#FFF7D6', '#FFD98C'],
  glow: { center: '#FFD89A', edge: '#FF9A3C', cy: -56, rx: 46, ry: 72 },
  flicker: { sy: 0.06, sx: 0.03, rot: 2, period: 2.2 },
  ember: { color: '#FFD98C', count: 2 },
  spark: { color: '#FFE6B0', count: 4 },
  ignition: { damping: 18, stiffness: 125, shake: false, shockwave: false }, // calm swell
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0.2, plumes: 4, rise: 1.0, drift: 16 },
  sound: { ignite: require('../assets/sounds/beacons-ignite.m4a'), crackle: require('../assets/sounds/beacons-crackle.m4a') },
  tap: { noun: 'pyre', tint: '#E9EEFA' },
};

// Aurora (replaces Will-o'-Wisp): an ARCTIC VIGIL. A carved rune stone on a snowfield; lighting it
// ignites the rune and unfurls aurora ribbons across the whole sky (Skia shader in the scene layer,
// behind the friend tiles). No flame, no smoke; the sky is the fire. Ethereal wisp sounds fit it.
const AURORA: BeaconSkin = {
  ...CAMPFIRE,
  id: 'aurora',
  label: 'Aurora',
  blurb: 'A rune stone that sets the northern sky alight.',
  structure: 'aurora',
  fire: 'none',
  smokeKind: 'none',
  origin: 0.5,
  outer: ['#37FFB4', '#2FD4FF'],
  mid: ['#9FF0E0', '#5FC8EE'],
  core: ['#FFFFFF', '#BFF4FF'],
  glow: { center: '#BFF4FF', edge: '#3FB8E8', cy: -64, rx: 52, ry: 84 },
  ignition: { damping: 16, stiffness: 140, shake: false, shockwave: false },
  smoke: { tintLow: '#9FE6FF', tintHigh: '#5FC8EE', opacity: 0, plumes: 0, rise: 1.0, drift: 22 },
  // Calm arctic night: deep soft wind + sparse crystalline shimmer (the old wisp clips had insect-y
  // flutters that fought the still-Iceland-sky mood).
  sound: { ignite: require('../assets/sounds/aurora-ignite.m4a'), crackle: require('../assets/sounds/aurora-crackle.m4a') },
  tap: { noun: 'stone', tint: '#D8FBEF' },
};

// Two Lanterns: PAUL REVERE, CLOSE UP. The scene frames the belfry arch (rooftops + harbor + moon
// beyond); the structure is the two big brass lanterns themselves, kindling staggered. The lit sound
// is a soft colonial piano ("Chester", Billings 1770), trimmed quieter than a crackle.
const TOWER: BeaconSkin = {
  ...CAMPFIRE,
  id: 'tower',
  label: 'Two Lanterns',
  blurb: 'One if by land, two if by sea.',
  structure: 'tower',
  fire: 'none',
  smokeKind: 'none',
  origin: 0.5,
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  sound: {
    ignite: require('../assets/sounds/tower-ignite.m4a'),
    crackle: require('../assets/sounds/tower-crackle.m4a'),
    igniteVol: 0.8,
    crackleVol: 0.45, // the piano was landing way too loud/aggressive at crackle level
  },
  tap: { noun: 'lanterns', tint: '#EFEAF7' },
};

// Lighthouse: kept (the strongest of the old set). Coastal tower over the animated Skia sea, with the
// full-screen sweeping beam in the fire slot. `glow.center` is the beam/lantern color.
const LIGHTHOUSE: BeaconSkin = {
  ...CAMPFIRE,
  id: 'lighthouse',
  label: 'Lighthouse',
  blurb: 'A coastal lighthouse. Its beam sweeps the night over a moonlit sea.',
  structure: 'lighthouse',
  fire: 'beam',
  smokeKind: 'none',
  origin: 0.22, // the lantern glass; the beam emanates from here
  glow: { center: '#FFF6D8', edge: '#FFE39A', cy: -64, rx: 52, ry: 80 },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  sound: { ignite: require('../assets/sounds/lighthouse-ignite.m4a'), crackle: require('../assets/sounds/lighthouse-crackle.m4a') },
  tap: { noun: 'lighthouse', tint: '#EAF1FF' },
};

// Smoke Signal: a GOLDEN-HOUR MESA. Visible stone fire ring + folded signal blanket; a small hot
// flame, and the hero: discrete white puffs released on a cover-and-lift rhythm (BeaconSmokeSignal).
// NOTE for the sound pass: still reuses the beacons clips; wants its own (drier, high-desert) pair.
const SMOKE_SIGNAL: BeaconSkin = {
  ...CAMPFIRE,
  id: 'smokesignal',
  label: 'Smoke Signal',
  blurb: 'A ridge fire speaking in slow white puffs.',
  structure: 'smokesignal',
  fire: 'flame',
  smokeKind: 'signal',
  origin: 0.63, // seat inside the fire lay (the crossed tips burn within the flame)
  flameScale: 0.5,
  flameShape: { width: 0.24, turb: 0.85, speed: 2.2 }, // base ~36px = the small lay's spread
  outer: ['#FF8A1F', '#D8431A'],
  mid: ['#FFC24A', '#FF7A1A'],
  core: ['#FFF7D6', '#FFCE3E'],
  glow: { center: '#FFD89A', edge: '#FF8A2A', cy: -40, rx: 36, ry: 52 },
  ignition: { damping: 14, stiffness: 150, shake: false, shockwave: false },
  smoke: { tintLow: '#E8EBF0', tintHigh: '#F2F4F8', opacity: 0.5, plumes: 0, rise: 1.0, drift: 14 },
  // Its own dry high-desert fire now (was borrowing the beacons wind clips, which faded to near
  // silence): crisp dry crackle + a soft blanket-lift whoosh that matches the puff releases.
  sound: { ignite: require('../assets/sounds/smokesignal-ignite.m4a'), crackle: require('../assets/sounds/smokesignal-crackle.m4a') },
  tap: { noun: 'fire', tint: '#FFE9C4' },
};

// Fireworks: A BACKYARD ON A SUMMER NIGHT, set up like real life (researched: consumer shells fire
// from an HDPE mortar tube in a wooden rack flat on the lawn; the visco fuse burns ~2-3s before the
// lift charge). Tap = the long fuse visibly burns down (~1.8s, structure one-shot), the mortar
// thumps, a streak climbs from the MUZZLE and the opener breaks into a VOLLEY of bursts; the show
// keeps going while lit (BeaconFireworks, behind-tiles slot). While lit the launch scorches a patch
// of grass that burns as a real flame (the Skia fire, small, anchored at the GROUND: skin.origin is
// the patch, and the shader derives the muzzle 86px above it): that burning patch is what you tap
// to extinguish.
const FIREWORKS: BeaconSkin = {
  ...CAMPFIRE,
  id: 'fireworks',
  label: 'Fireworks',
  blurb: 'Light the fuse. The night answers in color.',
  structure: 'fireworks',
  fire: 'none', // the lit fire is the structure's own sputtering fuse SPARKLER, not a flame layer
  smokeKind: 'fireworks',
  origin: 0.78, // the GROUND at the rack's base (muzzle = y 30 in viewBox; shader derives it)
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0.5, plumes: 0, rise: 1.0, drift: 0 }, // opacity = show intensity
  // LINEAR loop: the 20s show clip has launch thumps + booms at the burst shader's exact cycle
  // times (volley 2.75/3.03/3.30, singles 7.0/10.8/14.4/18.0); both clocks start at the tap.
  // WAV on purpose: AAC adds priming samples on every loop pass (~50-100ms slip per cycle) and the
  // audio audibly fell behind the visuals after a few minutes; PCM loops sample-accurately.
  sound: {
    ignite: require('../assets/sounds/fireworks-ignite.m4a'),
    crackle: require('../assets/sounds/fireworks-crackle.wav'),
    loopMode: 'linear',
  },
  tap: { noun: 'firework', tint: '#FFD9A0' },
};

// Sky Lanterns: YI PENG ON THE PING RIVER. The only skin whose ignition physically LAUNCHES the
// beacon: the khom loi on its bamboo stand catches, swells taut, tugs, and RELEASES (structure
// one-shot, 3.2s), handing off at t=3.0 to a hero lantern rising in the behind-tiles layer while a
// cell-hashed field of hundreds drifts up the sky (BeaconSkyLanterns; smoke.opacity = field
// density). Water glints + krathong floats live in the scene. fire 'none': the stand's little clay
// fuel pot is the lit cue and extinguish target.
const SKY_LANTERNS: BeaconSkin = {
  ...CAMPFIRE,
  id: 'skylanterns',
  label: 'Sky Lanterns',
  blurb: 'A paper lantern released to join a thousand wishes.',
  structure: 'skylantern',
  fire: 'none',
  smokeKind: 'lanterns',
  origin: 0.4, // the lantern body's center at viewBox (50,40); the hero rises from exactly here
  glow: { center: '#FFD89A', edge: '#FF9A3C', cy: -64, rx: 52, ry: 80 },
  ignition: { damping: 16, stiffness: 140, shake: false, shockwave: false },
  smoke: { tintLow: '#FFD9A0', tintHigh: '#FFC97E', opacity: 0.5, plumes: 0, rise: 1.0, drift: 12 },
  // HIDDEN: point at the already-shipped campfire clips so the bespoke skylantern m4a drops out of
  // the bundle while this skin is withdrawn. Restore the skylantern-*.m4a requires when it is revived.
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
  tap: { noun: 'lantern', tint: '#FFE9C4' },
};

// Searchlight: A 1930s HOLLYWOOD PREMIERE from a city rooftop. Throw the contactor lever, the
// carbon arc strikes with a sputter, and a tight blue-white shaft sweeps the sky in lockstep with
// the rotating barrel, terminating in a bright disc on the cloud deck where the BeKin emblem reads
// as a DARK shadow inside the light (real bat-signal physics: the cutout blocks the beam, the
// cloud lights up around it). glow.center is the arc/beam color, lighthouse-style.
const SEARCHLIGHT: BeaconSkin = {
  ...CAMPFIRE,
  id: 'searchlight',
  label: 'Searchlight',
  blurb: 'Throw the lever. Put your sign on the clouds.',
  structure: 'searchlight',
  fire: 'beam',
  smokeKind: 'none',
  origin: 0.3, // the lens center at viewBox (50,30); the shaft leaves from exactly here
  glow: { center: '#EAF4FF', edge: '#9FC8F0', cy: -64, rx: 52, ry: 80 },
  ignition: { damping: 15, stiffness: 140, shake: false, shockwave: false },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  // HIDDEN: point at the already-shipped campfire clips so the bespoke searchlight m4a drops out of
  // the bundle while this skin is withdrawn. Restore the searchlight-*.m4a requires when it is revived.
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
  tap: { noun: 'searchlight', tint: '#E7F1FF' },
};

// Storm Caller: a weathered SKY-ALTAR on a dark moor calls down a REAL lightning strike (research
// anatomy: St. Elmo's corona at the rod tip, a stepped leader descending in discrete steps, the
// rod's upward streamer, a blinding return stroke + full-screen flash, strobing restrikes). fire
// 'bolt' is that short-lived front layer; the lit idle is sheet lightning rolling INSIDE the
// scene's clouds plus rain, and the rod's corona is the extinguish target.
const STORM: BeaconSkin = {
  ...CAMPFIRE,
  id: 'storm',
  label: 'Storm Caller',
  blurb: 'Call the sky down to the rod.',
  structure: 'storm',
  fire: 'bolt',
  smokeKind: 'none',
  origin: 0.14, // the air terminal's TIP at viewBox (50,14); the bolt attaches exactly here
  glow: { center: '#CFC4FF', edge: '#8F7BFF', cy: -64, rx: 52, ry: 80 },
  ignition: { damping: 14, stiffness: 150, shake: false, shockwave: false },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  // HIDDEN: point at the already-shipped campfire clips so the bespoke storm m4a drops out of the
  // bundle while this skin is withdrawn. Restore the storm-*.m4a requires when it is revived.
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
  tap: { noun: 'storm rod', tint: '#DCE4F7' },
};

// HIDDEN / WORK IN PROGRESS (Round 50, 2026-07-06): Sky Lanterns, Searchlight, and Storm Caller are
// built end to end (registry entries here + their scene/structure/effect components + dispatch cases
// in BeaconScene/BeaconStructure/home + sounds) but WITHDRAWN from users pending rework, so they are
// NOT in BEACON_SKINS and never appear in the picker. getSkin() falls back to campfire for their ids,
// so a persisted selection self-heals. Re-enable by moving one back into BEACON_SKINS. User feedback
// that must be addressed first:
//   Sky Lanterns  - the "field" reads as a bunch of random light dots, not actual lantern shapes; the
//                   sound is bad.
//   Searchlight   - the emblem looks random and does not project across the whole cloud deck; the
//                   sound is bad.
//   Storm Caller  - the rain/storm ambience is good, but the LIT state reads as random: nothing looks
//                   actually lit when you light it.
// Kept referenced here (not merged into BEACON_SKINS) so they stay live, type-checked code.
export const HIDDEN_BEACON_SKINS: BeaconSkin[] = [SKY_LANTERNS, SEARCHLIGHT, STORM];

export const BEACON_SKINS: BeaconSkin[] = [CAMPFIRE, OLD_GUARD, BONFIRE, BEACONS, AURORA, TOWER, LIGHTHOUSE, SMOKE_SIGNAL, FIREWORKS];
export const DEFAULT_SKIN_ID = 'campfire';

export function getSkin(id: string | null | undefined): BeaconSkin {
  // Unknown ids (including the retired 'wisp') fall back to the default campfire.
  return BEACON_SKINS.find((s) => s.id === id) ?? CAMPFIRE;
}
