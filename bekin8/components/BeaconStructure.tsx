// components/BeaconStructure.tsx
// Picks the tappable foreground structure for the active skin: THE press target the user taps to
// light their beacon, so every one of these must read instantly against its dark scene (strong
// silhouette + a breathing ember/glimmer hint while unlit). Skins whose light IS the structure
// (lanterns, rune stone, lighthouse) receive `lit` and kindle themselves; the flame skins leave the
// fire to the full-screen Skia flame anchored at skin.origin.
import React from 'react';
import CampfireLogs from './structures/CampfireLogs';
import GuardBrazier from './structures/GuardBrazier';
import BonfirePyre from './structures/BonfirePyre';
import BeaconPyre from './structures/BeaconPyre';
import AuroraStone from './structures/AuroraStone';
import SignalLanterns from './structures/SignalLanterns';
import SignalFireRing from './structures/SignalFireRing';
import FireworkRocket from './structures/FireworkRocket';
import LanternStand from './structures/LanternStand';
import RooftopSearchlight from './structures/RooftopSearchlight';
import StormRod from './structures/StormRod';
import BeaconLighthouse from './BeaconLighthouse';
import type { BeaconSkin } from '../lib/beaconSkins';

type Props = { skin: BeaconSkin; size?: number; lit?: boolean; focused?: boolean };

function BeaconStructure({ skin, size = 180, lit = false, focused = true }: Props) {
  switch (skin.structure) {
    case 'logs':
      return <CampfireLogs size={size} lit={lit} focused={focused} />;
    case 'brazier':
      return <GuardBrazier size={size} lit={lit} focused={focused} />;
    case 'bonfire':
      return <BonfirePyre size={size} lit={lit} focused={focused} />;
    case 'mountains':
      return <BeaconPyre size={size} lit={lit} focused={focused} />;
    case 'aurora':
      return <AuroraStone size={size} lit={lit} focused={focused} />;
    case 'tower':
      return <SignalLanterns size={size} lit={lit} focused={focused} />;
    case 'lighthouse':
      return <BeaconLighthouse lit={lit} size={size} focused={focused} />;
    case 'fireworks':
      return <FireworkRocket size={size} lit={lit} focused={focused} />;
    case 'skylantern':
      return <LanternStand size={size} lit={lit} focused={focused} />;
    case 'searchlight':
      return <RooftopSearchlight size={size} lit={lit} focused={focused} />;
    case 'storm':
      return <StormRod size={size} lit={lit} focused={focused} />;
    case 'smokesignal':
    default:
      return <SignalFireRing size={size} lit={lit} focused={focused} />;
  }
}

// Memoized like BeaconScene: home re-renders constantly and the structures are dense static SVGs.
// `skin` is a stable module-constant object, everything else is a primitive.
export default React.memo(BeaconStructure);
