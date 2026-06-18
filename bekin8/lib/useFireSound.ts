// lib/useFireSound.ts
// Beacon fire SFX via expo-audio. EACH SKIN owns its own ignite + crackle clips (see beaconSkins
// `sound`); this hook re-points its two players at the current skin's clips whenever the skin
// changes — nothing is shared between skins. A one-shot "ignite" + a looping "crackle" play ONLY
// WHILE LIT (home drives both off the lit edge, so it also covers the flameless lantern tower).
// Respects the silent switch. NOTE: expo-audio is native — audible only in a build, not OTA-only.
import { useCallback, useEffect, useRef } from "react";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { BeaconSkin } from "./beaconSkins";

const CRACKLE_VOL = 0.3;
const IGNITE_VOL = 0.7;
const FADE_MS = 500;
const FADE_STEP_MS = 50;

export function useFireSound(enabled: boolean, skin: BeaconSkin) {
  const ignite = useAudioPlayer(skin.sound.ignite);
  const crackle = useAudioPlayer(skin.sound.crackle);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearFade = () => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false }).catch(() => {}); // respect the mute switch
    try {
      crackle.loop = true;
    } catch {}
    return () => {
      clearFade();
      try {
        crackle.pause();
      } catch {}
      try {
        ignite.pause();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap both players to the CURRENT skin's clips on skin change; keep the loop alive across a live
  // skin switch if it was already crackling.
  useEffect(() => {
    let wasPlaying = false;
    try {
      wasPlaying = crackle.playing;
    } catch {}
    try {
      ignite.replace(skin.sound.ignite);
    } catch {}
    try {
      crackle.replace(skin.sound.crackle);
      crackle.loop = true;
      if (wasPlaying && enabledRef.current) {
        crackle.volume = CRACKLE_VOL;
        crackle.play();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.id]);

  /** One-shot on the lighting edge (called from home). */
  const playIgnite = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      ignite.seekTo(0);
      ignite.volume = IGNITE_VOL;
      ignite.play();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start/stop the crackle loop with the lit state (fades out, then hard-pauses, on stop). */
  const setLit = useCallback((lit: boolean) => {
    clearFade();
    try {
      if (lit && enabledRef.current) {
        crackle.volume = CRACKLE_VOL;
        crackle.seekTo(0);
        crackle.play();
      } else {
        let v = CRACKLE_VOL;
        const dec = CRACKLE_VOL / (FADE_MS / FADE_STEP_MS);
        fadeRef.current = setInterval(() => {
          v -= dec;
          if (v <= 0) {
            clearFade();
            try {
              crackle.pause();
              crackle.seekTo(0);
              crackle.volume = CRACKLE_VOL;
            } catch {}
          } else {
            try {
              crackle.volume = v;
            } catch {}
          }
        }, FADE_STEP_MS);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { playIgnite, setLit };
}
