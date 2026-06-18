// lib/beaconSkins.ts
// Data-driven beacon SKINS. Every per-skin knob is config here, so BeaconFire / BeaconSmoke /
// BeaconStructure just read a skin and render — adding/retuning a skin never touches engine code.
// This turn ships "Old Guard" (iron-brazier) fully; the other three are scaffolded with distinct
// palettes/feel but reuse the brazier structure until their own structures land.

export type BeaconStructureKind = 'brazier' | 'pyre' | 'mountains' | 'wisp';

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
  smoke: { tintLow: '#C7A98A', tintHigh: '#9AA3B2', opacity: 0.16, plumes: 6, rise: 1.0, drift: 26 },
};

// --- Scaffolded skins (distinct palettes/feel; reuse the brazier structure for now) ---
const WILDFIRE: BeaconSkin = {
  ...OLD_GUARD,
  id: 'wildfire',
  label: 'Wildfire',
  blurb: 'An aggressive blast — bigger, hotter, with a boom and a shake.',
  structure: 'pyre',
  origin: 0.46,
  flameScale: 1.32,
  outer: ['#FF7A14', '#C81E0E'],
  mid: ['#FFB347', '#FF6A14'],
  core: ['#FFF4D0', '#FFC23D'],
  glow: { center: '#FFD89A', edge: '#FF6A1A', cy: -78, rx: 72, ry: 100 },
  flicker: { sy: 0.18, sx: 0.08, rot: 4, period: 1.0 },
  ember: { color: '#FFB24A', count: 5 },
  spark: { color: '#FFE0A0', count: 20 },
  ignition: { damping: 8, stiffness: 185, shake: true, shockwave: true },
  smoke: { tintLow: '#6B5E50', tintHigh: '#5A5048', opacity: 0.22, plumes: 7, rise: 1.0, drift: 34 },
};

const BEACONS: BeaconSkin = {
  ...OLD_GUARD,
  id: 'beacons',
  label: 'The Beacons',
  blurb: 'A calm LOTR signal chain across the mountains.',
  structure: 'mountains',
  origin: 0.5,
  flameScale: 0.78,
  outer: ['#FFC56B', '#FF9A3C'],
  mid: ['#FFE0A0', '#FFB347'],
  core: ['#FFF7D6', '#FFD98C'],
  glow: { center: '#FFD89A', edge: '#FF9A3C', cy: -56, rx: 46, ry: 72 },
  flicker: { sy: 0.06, sx: 0.03, rot: 2, period: 2.2 },
  ember: { color: '#FFD98C', count: 2 },
  spark: { color: '#FFE6B0', count: 4 },
  ignition: { damping: 16, stiffness: 140, shake: false, shockwave: false },
  smoke: { tintLow: '#AEB6C4', tintHigh: '#AEB6C4', opacity: 0.1, plumes: 3, rise: 1.0, drift: 16 },
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
  smoke: { tintLow: '#9FE6FF', tintHigh: '#5FC8EE', opacity: 0.12, plumes: 4, rise: 1.0, drift: 22 },
};

export const BEACON_SKINS: BeaconSkin[] = [OLD_GUARD, WILDFIRE, BEACONS, WISP];
export const DEFAULT_SKIN_ID = 'oldguard';

export function getSkin(id: string | null | undefined): BeaconSkin {
  return BEACON_SKINS.find((s) => s.id === id) ?? OLD_GUARD;
}
