// components/BeaconStructure.tsx
// Picks the right wood/structure for the active skin, the tappable foreground the fire sits on.
// Two Lanterns draws the colonial steeple (BeaconTower) whose two lanterns kindle on lit. Bonfire is the
// one "photo-beacon" (its backdrop photo IS the beacon), so it renders only a transparent tap spacer.
import React from 'react';
import { View } from 'react-native';
import UnlitLogs from './UnlitLogs';
import BeaconBrazier from './BeaconBrazier';
import BeaconWispBase from './BeaconWispBase';
import BeaconTower from './BeaconTower';
import BeaconLighthouse from './BeaconLighthouse';
import BeaconCampfirePit from './BeaconCampfirePit';
import type { BeaconSkin } from '../lib/beaconSkins';

type Props = { skin: BeaconSkin; size?: number; lit?: boolean };

export default function BeaconStructure({ skin, size = 180, lit = false }: Props) {
  switch (skin.structure) {
    case 'bonfire':
      // Photo-beacon: the backdrop photo is the beacon; keep only the tap footprint.
      return <View style={{ width: size, height: size }} />;
    case 'smokesignal':
      // The smoke column (BeaconSmokeSignal) is rendered in the fire slot; the small fire is drawn in
      // that shader. Here we keep only the tap footprint over the ridge photo.
      return <View style={{ width: size, height: size }} />;
    case 'tower':
      // Colonial signal steeple; the two lanterns glow (staggered) on lit.
      return <BeaconTower lit={lit} size={size} />;
    case 'wisp':
      return <BeaconWispBase size={size} />;
    case 'brazier':
      return <BeaconBrazier size={size} />;
    case 'lighthouse':
      // The lighthouse lantern glows with the lit state; the sweeping beam is a separate layer.
      return <BeaconLighthouse lit={lit} size={size} />;
    case 'logs':
      // Campfire (default): a pixel-art stone firepit that lights into an animated campfire.
      return <BeaconCampfirePit lit={lit} size={size} />;
    // The Beacons' near-ridge watchfire is a small REAL-wood stack (its own look, not the campfire).
    case 'mountains':
    default:
      return <UnlitLogs size={size} />;
  }
}
