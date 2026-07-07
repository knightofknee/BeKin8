// components/BeaconScene.tsx
// Full-screen BACKDROP behind all tiles (first child of the home page, pointerEvents-none wrapper).
// Thin dispatcher: every skin has its own bespoke procedural scene component (components/scenes/*,
// pure SVG/Skia, no photos), each in its own art style. Scenes receive the measured flame anchor so
// their geometry (wall tops, ledges, horizons) can line up with the tappable structure. The
// Lighthouse keeps its animated Skia sea (BeaconSeaScene).
import React from 'react';
import BeaconSeaScene from './BeaconSeaScene';
import CampfireScene from './scenes/CampfireScene';
import OldGuardScene from './scenes/OldGuardScene';
import BonfireScene from './scenes/BonfireScene';
import BeaconsScene from './scenes/BeaconsScene';
import AuroraScene from './scenes/AuroraScene';
import TowerScene from './scenes/TowerScene';
import SmokeSignalScene from './scenes/SmokeSignalScene';
import FireworksScene from './scenes/FireworksScene';
import SkyLanternScene from './scenes/SkyLanternScene';
import SearchlightScene from './scenes/SearchlightScene';
import StormScene from './scenes/StormScene';
import type { BeaconSkin } from '../lib/beaconSkins';

export type BeaconSceneProps = {
  skin: BeaconSkin;
  active: boolean;
  focused?: boolean;
  /** Page-relative px of the flame seat inside the 180px structure box (see home's anchor). */
  anchorX?: number;
  anchorY?: number;
  measured?: boolean;
};

function BeaconScene(props: BeaconSceneProps) {
  switch (props.skin.structure) {
    case 'logs':
      return <CampfireScene {...props} />;
    case 'brazier':
      return <OldGuardScene {...props} />;
    case 'bonfire':
      return <BonfireScene {...props} />;
    case 'mountains':
      return <BeaconsScene {...props} />;
    case 'aurora':
      return <AuroraScene {...props} />;
    case 'tower':
      return <TowerScene {...props} />;
    case 'lighthouse':
      return <BeaconSeaScene active={props.active} focused={props.focused} />;
    case 'smokesignal':
      return <SmokeSignalScene {...props} />;
    case 'fireworks':
      return <FireworksScene {...props} />;
    case 'skylantern':
      return <SkyLanternScene {...props} />;
    case 'searchlight':
      return <SearchlightScene {...props} />;
    case 'storm':
      return <StormScene {...props} />;
    default:
      return null;
  }
}

// Memoized: home re-renders on every snapshot/keystroke/tour tick, and re-reconciling a 100+ node
// scene SVG each time is a real tax on low-end Android. All props are primitives except `skin`,
// which is a stable module-constant object from BEACON_SKINS, so shallow compare is correct.
export default React.memo(BeaconScene);
