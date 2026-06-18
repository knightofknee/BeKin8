// lib/useFireSound.ts
// Beacon fire SFX via expo-audio: a one-shot "ignite" whoosh ON THE LIGHTING EDGE + a soft "crackle"
// loop ONLY WHILE LIT (never when off). Two variants of each clip, randomly chosen per light, so it
// doesn't sound mechanically identical. Gated by the device-local "Fire sounds" pref. Respects the
// silent switch. NOTE: expo-audio is a NATIVE module — only audible in a fresh build, not an OTA reload.
import { useCallback, useEffect, useRef } from "react";
import { useAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const CRACKLE_VOL = 0.3;
const IGNITE_VOL = 0.7;
const FADE_MS = 500;
const FADE_STEP_MS = 50;

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length) % arr.length];

export function useFireSound(enabled: boolean) {
  const ignite0 = useAudioPlayer(require("../assets/sounds/fire-ignite-1.m4a"));
  const ignite1 = useAudioPlayer(require("../assets/sounds/fire-ignite-2.m4a"));
  const crackle0 = useAudioPlayer(require("../assets/sounds/fire-crackle-1.m4a"));
  const crackle1 = useAudioPlayer(require("../assets/sounds/fire-crackle-2.m4a"));
  const ignites = [ignite0, ignite1];
  const crackles = [crackle0, crackle1];

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const activeCrackle = useRef<AudioPlayer | null>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearFade = () => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false }).catch(() => {}); // respect the mute switch
    crackles.forEach((c) => {
      try {
        c.loop = true;
      } catch {}
    });
    return () => {
      clearFade();
      crackles.forEach((c) => {
        try {
          c.pause();
        } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One-shot on the lighting edge (call from BeaconFire's onIgnited). */
  const playIgnite = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      const p = pick(ignites);
      p.seekTo(0);
      p.volume = IGNITE_VOL;
      p.play();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start/stop the crackle loop with the lit state (idempotent; fades out on stop). */
  const setLit = useCallback((lit: boolean) => {
    clearFade();
    try {
      if (lit && enabledRef.current) {
        const c = pick(crackles);
        activeCrackle.current = c;
        c.volume = CRACKLE_VOL;
        c.play();
      } else {
        const c = activeCrackle.current;
        if (c && c.playing) {
          let v = c.volume || CRACKLE_VOL;
          const dec = CRACKLE_VOL / (FADE_MS / FADE_STEP_MS);
          fadeRef.current = setInterval(() => {
            v -= dec;
            if (v <= 0) {
              clearFade();
              try {
                c.pause();
                c.seekTo(0);
                c.volume = CRACKLE_VOL;
              } catch {}
            } else {
              try {
                c.volume = v;
              } catch {}
            }
          }, FADE_STEP_MS);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { playIgnite, setLit };
}
