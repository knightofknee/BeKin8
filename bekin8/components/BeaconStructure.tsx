// components/BeaconStructure.tsx
// Picks the right wood/structure for the active skin — the tappable foreground the fire sits on.
// (The Beacons' grand mountain backdrop is a separate full-screen layer, BeaconScene; here it just
// uses a brazier as its near-ridge watchfire.)
import React from 'react';
import UnlitLogs from './UnlitLogs';
import BeaconBrazier from './BeaconBrazier';
import BeaconBonfire from './BeaconBonfire';
import BeaconWispBase from './BeaconWispBase';
import BeaconTower from './BeaconTower';
import type { BeaconSkin } from '../lib/beaconSkins';

type Props = { skin: BeaconSkin; size?: number; lit?: boolean };

export default function BeaconStructure({ skin, size = 180, lit = false }: Props) {
  switch (skin.structure) {
    case 'bonfire':
      return <BeaconBonfire size={size} />;
    case 'wisp':
      return <BeaconWispBase size={size} />;
    case 'brazier':
      return <BeaconBrazier size={size} />;
    case 'tower':
      // The tower owns its own light (two lanterns), so it needs the lit state.
      return <BeaconTower lit={lit} size={size} />;
    // The Beacons' near-ridge watchfire is a small REAL-wood stack (not the brazier).
    case 'mountains':
    case 'logs':
    default:
      return <UnlitLogs size={size} />;
  }
}
