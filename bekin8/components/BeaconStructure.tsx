// components/BeaconStructure.tsx
// Picks the right wood/structure for the active skin — the tappable foreground the fire sits on.
// (The Beacons' grand mountain backdrop is a separate full-screen layer, BeaconScene; here it just
// uses a brazier as its near-ridge watchfire.)
import React from 'react';
import BeaconBrazier from './BeaconBrazier';
import BeaconPyre from './BeaconPyre';
import BeaconWispBase from './BeaconWispBase';
import type { BeaconSkin } from '../lib/beaconSkins';

type Props = { skin: BeaconSkin; size?: number };

export default function BeaconStructure({ skin, size = 180 }: Props) {
  switch (skin.structure) {
    case 'pyre':
      return <BeaconPyre size={size} />;
    case 'wisp':
      return <BeaconWispBase size={size} />;
    case 'brazier':
    case 'mountains':
    default:
      return <BeaconBrazier size={size} />;
  }
}
