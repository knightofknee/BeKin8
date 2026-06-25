// lib/useFireSound.ts
// React wrapper over FireSoundEngine. EACH SKIN owns its own ignite + crackle clips (see beaconSkins
// `sound`); the engine re-points to the current skin's clips on change WITHOUT a dropout, crossfades
// the crackle so it loops seamlessly and never repeats, and fires the ignition reliably. Plays
// through the silent switch (alarm-like); the in-app fire-sound toggle is the control.
// NOTE: expo-audio is native, audible only in a build, not OTA-only.
import { useCallback, useEffect, useRef } from 'react';
import { setAudioModeAsync } from 'expo-audio';
import type { BeaconSkin } from './beaconSkins';
import { FireSoundEngine } from './fireSoundEngine';

export function useFireSound(enabled: boolean, skin: BeaconSkin) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const engineRef = useRef<FireSoundEngine | null>(null);

  // Create the engine once; release native players on unmount.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    const eng = new FireSoundEngine(skin.sound.crackle, skin.sound.ignite);
    engineRef.current = eng;
    return () => {
      eng.release();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Point at the current skin's clips on skin change (crossfades while lit; instant ignite preload).
  useEffect(() => {
    engineRef.current?.setSources(skin.sound.crackle, skin.sound.ignite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.id]);

  /** One-shot on the lighting edge (called from home). Gated on the in-app toggle. */
  const playIgnite = useCallback(() => {
    if (!enabledRef.current) return;
    engineRef.current?.playIgnite();
  }, []);

  /** Start/stop the seamless crackle with the lit state. */
  const setLit = useCallback((lit: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (lit && enabledRef.current) eng.start();
    else eng.stop();
  }, []);

  return { playIgnite, setLit };
}
