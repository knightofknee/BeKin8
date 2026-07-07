// lib/useFireSound.ts
// React wrapper over FireSoundEngine. EACH SKIN owns its own ignite + crackle clips (see beaconSkins
// `sound`); the engine re-points to the current skin's clips on change WITHOUT a dropout, crossfades
// the crackle so it loops seamlessly and never repeats, and fires the ignition reliably. Plays
// through the silent switch (alarm-like); the in-app fire-sound toggle is the control.
// NOTE: expo-audio is native, audible only in a build, not OTA-only.
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import type { BeaconSkin } from './beaconSkins';
import { FireSoundEngine } from './fireSoundEngine';

export function useFireSound(enabled: boolean, skin: BeaconSkin) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const engineRef = useRef<FireSoundEngine | null>(null);
  const litRef = useRef(false);

  // Create the engine once; release native players on unmount.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    const eng = new FireSoundEngine(skin.sound.crackle, skin.sound.ignite);
    eng.setVolumeScale(skin.sound.crackleVol ?? 1, skin.sound.igniteVol ?? 1);
    eng.setLoopMode(skin.sound.loopMode ?? 'seamless');
    engineRef.current = eng;
    return () => {
      eng.release();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Point at the current skin's clips on skin change (crossfades while lit; instant ignite preload).
  // Volume trims ride along: the running crackle eases to the new trim at its next crossfade.
  useEffect(() => {
    engineRef.current?.setVolumeScale(skin.sound.crackleVol ?? 1, skin.sound.igniteVol ?? 1);
    engineRef.current?.setLoopMode(skin.sound.loopMode ?? 'seamless');
    engineRef.current?.setSources(skin.sound.crackle, skin.sound.ignite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.id]);

  // We have NO background-audio entitlement (App Review 2.5.4: no feature needs it), so the OS pauses
  // the players when the app is backgrounded while the engine still thinks it's playing; its tick
  // then never advances and the crackle would stay silent forever after returning. Stop on background
  // (syncs engine state) and re-kick on the next active if the beacon is still lit.
  useEffect(() => {
    let wasBackgrounded = false;
    const sub = AppState.addEventListener('change', (state) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (state === 'background') {
        wasBackgrounded = true;
        eng.stop();
      } else if (state === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        if (litRef.current && enabledRef.current) eng.start();
      }
    });
    return () => sub.remove();
  }, []);

  /** One-shot on the lighting edge (called from home). Gated on the in-app toggle. */
  const playIgnite = useCallback(() => {
    if (!enabledRef.current) return;
    engineRef.current?.playIgnite();
  }, []);

  /** Start/stop the seamless crackle with the lit state. */
  const setLit = useCallback((lit: boolean) => {
    litRef.current = lit;
    const eng = engineRef.current;
    if (!eng) return;
    if (lit && enabledRef.current) eng.start();
    else eng.stop();
  }, []);

  return { playIgnite, setLit };
}
