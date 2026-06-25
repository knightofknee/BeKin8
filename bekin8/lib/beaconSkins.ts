// lib/beaconSkins.ts
// Data-driven beacon SKINS. Every per-skin knob is config here, so BeaconFire / BeaconSmoke /
// BeaconStructure / useFireSound just read a skin and render, adding/retuning a skin never touches
// engine code. All 6 skins have a dedicated structure (logs / brazier / bonfire / mountains-foreground
// / wisp-cairn / lantern-tower) and their OWN sound clips; nothing is shared. The lantern tower has
// no flame layer (home skips BeaconFire) and no smoke, its flame/ember/glow/flicker fields are inert.

export type BeaconStructureKind = 'logs' | 'brazier' | 'bonfire' | 'mountains' | 'wisp' | 'tower' | 'lighthouse' | 'smokesignal';

export type BeaconSkin = {
  id: string;
  label: string;
  blurb: string;
  structure: BeaconStructureKind;
  /** Where the flame BASE sits within the structure box (0 = top, 1 = bottom). */
  origin: number;
  /** Overall flame scale in screen px (the base flame paths are ~152px tall). */
  flameScale: number;
  /** Flame gradient stops [bottom (hot), top (cool)]. */
  outer: [string, string];
  mid: [string, string];
  core: [string, string];
  /** Warm glow halo behind the flame. */
  glow: { center: string; edge: string; cy: number; rx: number; ry: number };
  /** Idle flicker amplitudes (loopNoise-driven) + speed (smaller period = faster). */
  flicker: { sy: number; sx: number; rot: number; period: number };
  ember: { color: string; count: number };
  spark: { color: string; count: number };
  /** Ignition spring + dramatic extras (screen shake + an expanding shockwave ring). */
  ignition: { damping: number; stiffness: number; shake: boolean; shockwave: boolean };
  smoke: {
    tintLow: string; // warm, near the fire
    tintHigh: string; // cool, up high
    opacity: number;
    plumes: number;
    /** Fraction of screen height the smoke climbs. */
    rise: number;
    /** Lateral drift amplitude (px). */
    drift: number;
  };
  /** Per-skin SFX, each skin owns its OWN ignition + crackle clips; nothing is shared. */
  sound: { ignite: number; crackle: number };
  /** Tappable-hint copy + a contrast color for the "Tap the {noun} to light your Beacon" prompt,
   *  which sits over THIS skin's photographic backdrop. */
  tap: { noun: string; tint: string };
};

const OLD_GUARD: BeaconSkin = {
  id: 'oldguard',
  label: 'Old Guard',
  blurb: 'A forged iron brazier, a watchfire kept burning for you.',
  structure: 'brazier',
  origin: 0.34, // top of the brazier bowl
  flameScale: 0.95,
  outer: ['#FF8A1F', '#D8431A'],
  mid: ['#FFC24A', '#FF7A1A'],
  core: ['#FFF7D6', '#FFCE3E'],
  glow: { center: '#FFD89A', edge: '#FF8A2A', cy: -64, rx: 52, ry: 80 },
  flicker: { sy: 0.1, sx: 0.05, rot: 3, period: 1.5 },
  ember: { color: '#FFCF7A', count: 3 },
  spark: { color: '#FFE0A0', count: 8 },
  ignition: { damping: 15, stiffness: 135, shake: false, shockwave: false }, // dignified, steady, low overshoot
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0.32, plumes: 7, rise: 1.0, drift: 26 },
  sound: { ignite: require('../assets/sounds/oldguard-ignite.m4a'), crackle: require('../assets/sounds/oldguard-crackle.m4a') },
  tap: { noun: 'brazier', tint: '#F1E6CE' },
};

// Bonfire, a PHOTO-BEACON: a real teepee PYRE you light. BeaconScene crossfades the unlit (dark,
// charred) pyre into the SAME pyre blazing on lit. No drawn structure / no app flame (those fields are
// inert; BeaconStructure renders a tap spacer, home skips BeaconFire). KEEPS heavy rising smoke (toward
// a smoke-signal feel) and the deep "boom" ignite. Real big-fire crackle.
const BONFIRE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'bonfire',
  label: 'Bonfire',
  blurb: 'A towering blaze: a big stacked-wood bonfire that lights with a boom.',
  structure: 'bonfire',
  origin: 0.42,
  flameScale: 1.32,
  outer: ['#FF7A14', '#C81E0E'],
  mid: ['#FFB347', '#FF6A14'],
  core: ['#FFF4D0', '#FFC23D'],
  glow: { center: '#FFD89A', edge: '#FF6A1A', cy: -78, rx: 72, ry: 100 },
  flicker: { sy: 0.18, sx: 0.08, rot: 4, period: 1.0 },
  ember: { color: '#FFB24A', count: 5 },
  spark: { color: '#FFE0A0', count: 20 },
  ignition: { damping: 7, stiffness: 195, shake: true, shockwave: true }, // explosive, big overshoot + shake + shockwave
  smoke: { tintLow: '#8A8078', tintHigh: '#9AA0A8', opacity: 0.62, plumes: 11, rise: 1.0, drift: 30 }, // heavy, pale, signal-like
  sound: { ignite: require('../assets/sounds/bonfire-ignite.m4a'), crackle: require('../assets/sounds/bonfire-crackle.m4a') },
  tap: { noun: 'bonfire', tint: '#FBE3C0' },
};

const BEACONS: BeaconSkin = {
  ...OLD_GUARD,
  id: 'beacons',
  label: 'The Beacons',
  blurb: 'A calm LOTR signal chain across the mountains.',
  structure: 'mountains',
  origin: 0.18, // flame seated at the apex of the small real-wood ridge stack (matches Campfire logs)
  flameScale: 0.78,
  outer: ['#FFC56B', '#FF9A3C'],
  mid: ['#FFE0A0', '#FFB347'],
  core: ['#FFF7D6', '#FFD98C'],
  glow: { center: '#FFD89A', edge: '#FF9A3C', cy: -56, rx: 46, ry: 72 },
  flicker: { sy: 0.06, sx: 0.03, rot: 2, period: 2.2 },
  ember: { color: '#FFD98C', count: 2 },
  spark: { color: '#FFE6B0', count: 4 },
  ignition: { damping: 18, stiffness: 125, shake: false, shockwave: false }, // calm gentle swell, no overshoot
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0.18, plumes: 4, rise: 1.0, drift: 16 },
  sound: { ignite: require('../assets/sounds/beacons-ignite.m4a'), crackle: require('../assets/sounds/beacons-crackle.m4a') },
  tap: { noun: 'logs', tint: '#E9EEFA' },
};

const WISP: BeaconSkin = {
  ...OLD_GUARD,
  id: 'wisp',
  label: "Will-o'-Wisp",
  blurb: 'An ethereal cyan soul-flame that floats and breathes.',
  structure: 'wisp',
  origin: 0.5, // mid, lifts the soul-flame OFF the swamp water onto the trees so it reads + stands out
  flameScale: 1.15, // bigger so it's clearly visible against the dark swamp
  outer: ['#6FE3FF', '#2B8CCF'],
  mid: ['#9FF0FF', '#5FC8EE'],
  core: ['#FFFFFF', '#BFF4FF'],
  glow: { center: '#BFF4FF', edge: '#3FB8E8', cy: -64, rx: 52, ry: 84 },
  flicker: { sy: 0.08, sx: 0.05, rot: 3, period: 1.9 },
  ember: { color: '#BFF4FF', count: 3 },
  spark: { color: '#E6FEFF', count: 5 },
  ignition: { damping: 16, stiffness: 140, shake: false, shockwave: false }, // soft ethereal pulse
  smoke: { tintLow: '#9FE6FF', tintHigh: '#5FC8EE', opacity: 0.24, plumes: 5, rise: 1.0, drift: 22 },
  sound: { ignite: require('../assets/sounds/wisp-ignite.m4a'), crackle: require('../assets/sounds/wisp-crackle.m4a') },
  tap: { noun: 'wisp', tint: '#DDFBFF' },
};

// Paul Revere "Two Lanterns", a PHOTO-BEACON: the backdrop is a real lit steeple (BeaconScene), which
// brightens and kindles two lantern glows when lit. No drawn structure, no flame, no smoke, the
// flame/ember/glow/flicker/ignition fields below are inert (BeaconStructure renders a tap spacer; home
// skips BeaconFire). The lit sound is a soft colonial piano ("Chester", Billings 1770).
const TOWER: BeaconSkin = {
  ...OLD_GUARD,
  id: 'tower',
  label: 'Two Lanterns',
  blurb: 'One if by land, two if by sea. A signal tower with two lanterns.',
  structure: 'tower',
  origin: 0.3,
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  sound: { ignite: require('../assets/sounds/tower-ignite.m4a'), crackle: require('../assets/sounds/tower-crackle.m4a') },
  tap: { noun: 'lanterns', tint: '#EFEAF7' },
};

// Lighthouse, a coastal tower whose lantern sends two beams SWEEPING around the night (the rotating
// beam is a full-screen Skia layer, BeaconLighthouseBeam, anchored at the lantern; home renders it in
// place of BeaconFire). No flame, no smoke. Scene = a moonlit animated sea on a rocky shore. The
// lit sound is a real CC0 ocean-waves recording. `glow.center` is the warm beam/lantern color.
const LIGHTHOUSE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'lighthouse',
  label: 'Lighthouse',
  blurb: 'A coastal lighthouse. Its beam sweeps the night over a moonlit sea.',
  structure: 'lighthouse',
  origin: 0.22, // the lantern glass (~22% down the tower), the beam emanates from here
  glow: { center: '#FFF6D8', edge: '#FFE39A', cy: -64, rx: 52, ry: 80 },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  sound: { ignite: require('../assets/sounds/lighthouse-ignite.m4a'), crackle: require('../assets/sounds/lighthouse-crackle.m4a') },
  tap: { noun: 'lighthouse', tint: '#EAF1FF' },
};

// The original logs-and-flame beacon, the DEFAULT. Same warm ogee flame as Old Guard, but on the
// stacked-log teepee structure with the flame seated at the apex (origin 0.18) so it rises above the
// wood. Old Guard (iron brazier) and the rest are selectable options.
// Campfire (DEFAULT), a bespoke Stardew-style PIXEL-ART scene: a real pixel campfire (animated WebP)
// in a stone firepit, in a forest clearing under a crescent moon, with calm fireflies. It owns its fire
// (a self-lit pixel structure, like the lighthouse/tower), so there's no SVG/Skia flame and no Skia
// smoke (it would clash with the pixel art). Most flame fields below are inert.
const CAMPFIRE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'campfire',
  label: 'Campfire',
  blurb: 'A cozy pixel campfire in a moonlit forest clearing.',
  structure: 'logs',
  origin: 0.5,
  ignition: { damping: 11, stiffness: 178, shake: false, shockwave: false },
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0, plumes: 0, rise: 1.0, drift: 0 }, // no Skia smoke
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
  tap: { noun: 'campfire', tint: '#FFE7B0' },
};

// Smoke Signal, the SMOKE is the hero. A small hot fire on a ridgeline throws a thick, near-white
// column that rises in discrete puffs (a dedicated Skia layer, BeaconSmokeSignal, rendered in place of
// BeaconFire, like the lighthouse beam). No drawn structure (BeaconStructure renders a tap spacer,
// home skips BeaconFire). The generic Skia smoke is disabled here (smoke.plumes:0); BeaconSmokeSignal
// reads smoke.opacity for column density. Scene = a golden-hour ridge photo (open sky for the column).
const SMOKE_SIGNAL: BeaconSkin = {
  ...OLD_GUARD,
  id: 'smokesignal',
  label: 'Smoke Signal',
  blurb: 'A small ridgetop fire sends a tall column of white smoke rising in puffs.',
  structure: 'smokesignal',
  origin: 0.5, // the small fire sits on the rocks; the smoke column rises from here
  smoke: { tintLow: '#E8EBF0', tintHigh: '#F2F4F8', opacity: 0.5, plumes: 0, rise: 1.0, drift: 14 },
  sound: { ignite: require('../assets/sounds/beacons-ignite.m4a'), crackle: require('../assets/sounds/beacons-crackle.m4a') },
  tap: { noun: 'fire', tint: '#F3ECDC' },
};

export const BEACON_SKINS: BeaconSkin[] = [CAMPFIRE, OLD_GUARD, BONFIRE, BEACONS, WISP, TOWER, LIGHTHOUSE, SMOKE_SIGNAL];
export const DEFAULT_SKIN_ID = 'campfire';

export function getSkin(id: string | null | undefined): BeaconSkin {
  return BEACON_SKINS.find((s) => s.id === id) ?? CAMPFIRE;
}
