// lib/beaconSkins.ts
// Data-driven beacon SKINS. Every per-skin knob is config here, so BeaconFire / BeaconSmoke /
// BeaconStructure / useFireSound just read a skin and render — adding/retuning a skin never touches
// engine code. All 6 skins have a dedicated structure (logs / brazier / bonfire / mountains-foreground
// / wisp-cairn / lantern-tower) and their OWN sound clips; nothing is shared. The lantern tower has
// no flame layer (home skips BeaconFire) and no smoke — its flame/ember/glow/flicker fields are inert.

export type BeaconStructureKind = 'logs' | 'brazier' | 'bonfire' | 'mountains' | 'wisp' | 'tower';

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
  /** Per-skin SFX — each skin owns its OWN ignition + crackle clips; nothing is shared. */
  sound: { ignite: number; crackle: number };
};

const OLD_GUARD: BeaconSkin = {
  id: 'oldguard',
  label: 'Old Guard',
  blurb: 'A forged iron brazier — a watchfire kept burning for you.',
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
  ignition: { damping: 12, stiffness: 165, shake: false, shockwave: false },
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0.32, plumes: 7, rise: 1.0, drift: 26 },
  sound: { ignite: require('../assets/sounds/oldguard-ignite.m4a'), crackle: require('../assets/sounds/oldguard-crackle.m4a') },
};

// --- Scaffolded skins (distinct palettes/feel; reuse the brazier structure for now) ---
const BONFIRE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'bonfire',
  label: 'Bonfire',
  blurb: 'A towering blaze — a big stacked-wood bonfire that lights with a boom.',
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
  ignition: { damping: 8, stiffness: 185, shake: true, shockwave: true },
  smoke: { tintLow: '#6B5E50', tintHigh: '#6A5F55', opacity: 0.4, plumes: 8, rise: 1.0, drift: 34 },
  sound: { ignite: require('../assets/sounds/bonfire-ignite.m4a'), crackle: require('../assets/sounds/bonfire-crackle.m4a') },
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
  ignition: { damping: 16, stiffness: 140, shake: false, shockwave: false },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0.18, plumes: 4, rise: 1.0, drift: 16 },
  sound: { ignite: require('../assets/sounds/beacons-ignite.m4a'), crackle: require('../assets/sounds/beacons-crackle.m4a') },
};

const WISP: BeaconSkin = {
  ...OLD_GUARD,
  id: 'wisp',
  label: "Will-o'-Wisp",
  blurb: 'An ethereal cyan soul-flame that floats and breathes.',
  structure: 'wisp',
  origin: 0.62,
  flameScale: 0.85,
  outer: ['#6FE3FF', '#2B8CCF'],
  mid: ['#9FF0FF', '#5FC8EE'],
  core: ['#FFFFFF', '#BFF4FF'],
  glow: { center: '#BFF4FF', edge: '#3FB8E8', cy: -64, rx: 52, ry: 84 },
  flicker: { sy: 0.08, sx: 0.05, rot: 3, period: 1.9 },
  ember: { color: '#BFF4FF', count: 3 },
  spark: { color: '#E6FEFF', count: 5 },
  ignition: { damping: 15, stiffness: 150, shake: false, shockwave: false },
  smoke: { tintLow: '#9FE6FF', tintHigh: '#5FC8EE', opacity: 0.24, plumes: 5, rise: 1.0, drift: 22 },
  sound: { ignite: require('../assets/sounds/wisp-ignite.m4a'), crackle: require('../assets/sounds/wisp-crackle.m4a') },
};

// Paul Revere "Two Lanterns" — a colonial signal steeple with two lanterns (its own animated light,
// not the flame engine). No flame layer / no smoke; the structure (BeaconTower) handles the glow.
const TOWER: BeaconSkin = {
  ...OLD_GUARD,
  id: 'tower',
  label: 'Two Lanterns',
  blurb: 'One if by land, two if by sea — a signal tower with two lanterns.',
  structure: 'tower',
  origin: 0.3,
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0, plumes: 0, rise: 1.0, drift: 12 },
  sound: { ignite: require('../assets/sounds/tower-ignite.m4a'), crackle: require('../assets/sounds/tower-crackle.m4a') },
};

// The original logs-and-flame beacon — the DEFAULT. Same warm ogee flame as Old Guard, but on the
// stacked-log teepee structure with the flame seated at the apex (origin 0.18) so it rises above the
// wood. Old Guard (iron brazier) and the rest are selectable options.
const CAMPFIRE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'campfire',
  label: 'Campfire',
  blurb: 'Stacked logs and a living flame — the classic.',
  structure: 'logs',
  origin: 0.18,
  sound: { ignite: require('../assets/sounds/campfire-ignite.m4a'), crackle: require('../assets/sounds/campfire-crackle.m4a') },
};

export const BEACON_SKINS: BeaconSkin[] = [CAMPFIRE, OLD_GUARD, BONFIRE, BEACONS, WISP, TOWER];
export const DEFAULT_SKIN_ID = 'campfire';

export function getSkin(id: string | null | undefined): BeaconSkin {
  return BEACON_SKINS.find((s) => s.id === id) ?? CAMPFIRE;
}
