// lib/fireSoundEngine.ts
// Imperative fire-audio engine (expo-audio createAudioPlayer, stable players we own/release, NOT
// the useAudioPlayer hook which recreates a player whenever the source id changes and was the cause
// of the skin-switch dropout + ignition-stops bugs).
//
// Crackle: TWO players reading the same per-skin crackle clip at random offsets, crossfaded into
// each other every few seconds. That gives a seamless loop (no boundary seam) that is "consistently
// new" (random window + random crossfade timing) from one long clip. Switching skins crossfades to
// the new clip instead of cutting out. Ignite: one stable player, source pre-loaded on skin change
// so taps fire instantly.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const CRACKLE_VOL = 0.32;
const IGNITE_VOL = 0.72;
const CRACKLE_DUR = 20.0; // synthesized crackle clip length (s), used to pick safe random offsets
const SEG_MIN = 4.0;
const SEG_MAX = 7.0; // a "segment" plays this long before crossfading to a fresh random offset
const XFADE_MS = 900; // crossfade length (seamless-loop segment blends)
const SWITCH_FADE_MS = 320; // skin-switch blend: the old skin must cut off quickly + consistently
const STEP_MS = 50; // volume-ramp tick
const TICK_MS = 160; // scheduler poll
const REPLACE_LOAD_MS = 170; // grace after replace() before seek/play on the freshly-loaded clip

type Src = number;

export class FireSoundEngine {
  private ignite: AudioPlayer;
  private cA: AudioPlayer;
  private cB: AudioPlayer;
  private active: AudioPlayer;
  private crackleSrc: Src;
  private igniteSrc: Src;
  /** What each crackle player ACTUALLY has loaded. The seamless crossfade design assumes both
   *  players hold the same clip; a skin switch landing mid-crossfade (or a failed replace) used to
   *  leave them holding DIFFERENT clips, and every natural crossfade then alternated between two
   *  skins' sounds forever. Tracking real sources lets every crossfade verify its target first. */
  private srcA: Src;
  private srcB: Src;
  /** 'seamless' = the dual-player random-window crossfade loop (fires, wind).
   *  'linear' = one player looping the clip start-to-end (the fireworks show: its 20s clip has
   *  booms authored at the exact times the burst shader fires, both clocks starting at the tap). */
  private loopMode: 'seamless' | 'linear' = 'seamless';
  /** Set when the loop mode changes while playing; the next setSources restarts instead of
   *  crossfading. Without this, switching OUT of a linear skin mid-play cleared the loop flag,
   *  left no segment scheduler running, and the old clip played to its end and went SILENT. */
  private modeDirty = false;
  /** Set by a skin switch while playing: the next crossfade starts on the next tick and fades in
   *  SWITCH_FADE_MS instead of XFADE_MS, so the old skin's sound cuts off consistently fast
   *  (aurora's drone used to linger ~1.7s through the leisurely musical crossfade). */
  private fastSwitch = false;
  private playing = false;
  private xfading = false;
  /** Per-skin volume trims (BeaconSkin.sound.crackleVol/igniteVol); 1 = engine defaults. */
  private crScale = 1;
  private igScale = 1;
  private segEndAt = 0; // active.currentTime threshold that triggers the next crossfade
  private tick: ReturnType<typeof setInterval> | null = null;
  private ramp: ReturnType<typeof setInterval> | null = null;
  private xfTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(crackle: Src, ignite: Src) {
    this.crackleSrc = crackle;
    this.igniteSrc = ignite;
    this.ignite = createAudioPlayer(ignite);
    this.cA = createAudioPlayer(crackle);
    this.cB = createAudioPlayer(crackle);
    this.srcA = crackle;
    this.srcB = crackle;
    this.active = this.cA;
    try {
      this.cA.volume = 0;
      this.cB.volume = 0;
    } catch {}
  }

  private idle() {
    return this.active === this.cA ? this.cB : this.cA;
  }
  private rnd(a: number, b: number) {
    return a + Math.random() * (b - a);
  }
  private safeOffset() {
    return this.rnd(0, Math.max(0.1, CRACKLE_DUR - SEG_MAX - XFADE_MS / 1000 - 0.3));
  }
  private clearRamp() {
    if (this.ramp) {
      clearInterval(this.ramp);
      this.ramp = null;
    }
  }
  private clearTick() {
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = null;
    }
  }
  private clearXfTimer() {
    if (this.xfTimer) {
      clearTimeout(this.xfTimer);
      this.xfTimer = null;
    }
  }
  private safeVol(p: AudioPlayer) {
    try {
      return p.volume;
    } catch {
      return 0;
    }
  }

  /** Per-skin volume trims. Applied to future starts/ignites and, if the crackle is running, eased
   *  in at the next crossfade (ticks read the scale live). */
  setVolumeScale(crackle: number, ignite: number) {
    this.crScale = crackle;
    this.igScale = ignite;
  }
  private crackleVol() {
    return CRACKLE_VOL * this.crScale;
  }
  private srcOf(p: AudioPlayer) {
    return p === this.cA ? this.srcA : this.srcB;
  }
  /** replace() a player's clip, recording the new source ONLY on success (a caught throw would
   *  otherwise make the tracking lie and re-open the alternating-clips bug). */
  private tryLoad(p: AudioPlayer, s: Src): boolean {
    try {
      p.replace(s);
      if (p === this.cA) this.srcA = s;
      else this.srcB = s;
      return true;
    } catch {
      return false;
    }
  }
  /** Ensure a player holds the CURRENT skin's crackle; returns true if a fresh load happened
   *  (caller should wait REPLACE_LOAD_MS before seek/play). */
  private ensureCurrent(p: AudioPlayer): boolean {
    if (this.srcOf(p) === this.crackleSrc) return false;
    return this.tryLoad(p, this.crackleSrc);
  }

  /** Per-skin loop behavior; set (with setVolumeScale) BEFORE setSources on a skin switch. */
  setLoopMode(mode: 'seamless' | 'linear') {
    if (mode === this.loopMode) return;
    this.loopMode = mode;
    if (this.playing) this.modeDirty = true;
    if (mode === 'seamless') {
      // A player left looping is harmless in seamless mode (windows never reach the clip end),
      // but clear the flags anyway so the modes stay honest.
      try {
        this.cA.loop = false;
      } catch {}
      try {
        this.cB.loop = false;
      } catch {}
    }
  }

  /** Repoint at a skin's clips. Ignite pre-loads now (instant taps); crackle morphs via crossfade
   *  while lit (no dropout) or swaps immediately while silent. */
  setSources(crackle: Src, ignite: Src) {
    if (ignite !== this.igniteSrc) {
      this.igniteSrc = ignite;
      try {
        this.ignite.replace(ignite);
      } catch {}
    }
    if (crackle !== this.crackleSrc) {
      this.crackleSrc = crackle;
      if (!this.playing) {
        // Silent swap: bring both players onto the new clip now (tracking records what stuck;
        // start() re-verifies, so a failed replace here self-heals later).
        this.tryLoad(this.cA, crackle);
        this.tryLoad(this.cB, crackle);
      } else if (this.loopMode === 'linear' || this.modeDirty) {
        // Restart, don't crossfade: linear shows are position-synced to their visuals from t=0,
        // and a mode CHANGE while playing (either direction) invalidates the running scheduler
        // (leaving a de-looped linear clip to die at its end, or no tick to ever crossfade).
        this.modeDirty = false;
        this.stop();
        this.start();
      } else {
        // Crossfade on the very next tick (<=160ms away) with the short switch fade: the old
        // skin's sound is gone within ~0.5s, every time. The crossfade itself verifies its
        // target player against crackleSrc, so no pending state.
        this.fastSwitch = true;
        this.segEndAt = 0;
      }
    }
  }

  /** One-shot ignition (source already loaded via setSources). */
  playIgnite(vol = IGNITE_VOL * this.igScale) {
    try {
      this.ignite.seekTo(0);
      this.ignite.volume = vol;
      this.ignite.play();
    } catch {}
  }

  /** Start the crackle: seamless = the dual-player random-window scheduler; linear = one looping
   *  player from t=0 (the fireworks show, synced to the burst shader's zeroed clock). */
  start(vol = this.crackleVol()) {
    if (this.playing) return;
    // Re-sync any player that drifted off the current skin's clip (skin switch while stopped,
    // interrupted crossfades, failed replaces): resume/relight must never play the old skin.
    const loadedA = this.ensureCurrent(this.cA);
    const loadedB = this.ensureCurrent(this.cB);
    this.playing = true;
    this.xfading = false;
    this.modeDirty = false;
    this.clearRamp();

    if (this.loopMode === 'linear') {
      const a = this.cA;
      this.active = a;
      try {
        a.loop = true;
      } catch {}
      const kick = (attempt: number) => {
        if (!this.playing) return;
        try {
          a.seekTo(0);
          a.volume = vol;
          a.play();
        } catch {}
        try {
          this.cB.volume = 0;
        } catch {}
        let playing = false;
        try {
          playing = a.playing;
        } catch {}
        if (!playing && attempt < 6) setTimeout(() => kick(attempt + 1), 200);
      };
      // Give a fresh replace() its load grace before the first play attempt.
      if (loadedA) setTimeout(() => kick(0), REPLACE_LOAD_MS);
      else kick(0);
      this.clearTick(); // no segment scheduler in linear mode
      return;
    }
    void loadedB;
    const a = this.active;
    try {
      a.loop = false;
    } catch {}
    const off = this.safeOffset();
    this.segEndAt = off + this.rnd(SEG_MIN, SEG_MAX);
    // On a COLD START the player may not have finished loading, so play() no-ops; retry a few times
    // until it actually plays (this is why "no sound on open, sound after a toggle" happened).
    const kick = (attempt: number) => {
      if (!this.playing) return;
      try {
        a.seekTo(off);
        a.volume = vol;
        a.play();
      } catch {}
      try {
        this.idle().volume = 0;
      } catch {}
      let playing = false;
      try {
        playing = a.playing;
      } catch {}
      if (!playing && attempt < 6) setTimeout(() => kick(attempt + 1), 200);
    };
    kick(0);
    this.clearTick();
    // Read the (possibly retrimmed) volume at tick time so a live skin switch eases the new skin's
    // trim in at the next crossfade instead of keeping the old level forever.
    this.tick = setInterval(() => this.onTick(this.crackleVol()), TICK_MS);
  }

  private onTick(vol: number) {
    if (!this.playing || this.xfading) return;
    let ct = 0;
    try {
      ct = this.active.currentTime;
    } catch {}
    if (ct >= this.segEndAt || ct >= CRACKLE_DUR - XFADE_MS / 1000 - 0.15) {
      this.crossfade(vol);
    }
  }

  private crossfade(vol: number) {
    if (this.xfading) return;
    this.xfading = true;
    const from = this.active;
    const to = this.idle();
    // ALWAYS verify the target holds the CURRENT skin's clip. This is the fix for the alternating
    // two-skins bug: any path that left the pair holding different clips (raced skin switches,
    // failed replaces) previously alternated forever, because this path assumed they matched.
    const replaced = this.ensureCurrent(to);
    const begin = () => {
      // stop() may have landed while we waited on the replace() grace timer; starting the fade-in
      // anyway would leave a player crackling at full volume with the engine stopped.
      if (!this.playing) {
        this.xfading = false;
        return;
      }
      const off = this.safeOffset();
      // Fade the outgoing player from its ACTUAL level: with per-skin trims, ramping it from the
      // incoming `vol` would snap it to the new skin's volume on the first step (audible pop when
      // the trims differ, e.g. tower 0.45 <-> default 1).
      const fromV0 = this.safeVol(from);
      try {
        to.seekTo(off);
        to.volume = 0;
        to.play();
      } catch {}
      const fadeMs = this.fastSwitch ? SWITCH_FADE_MS : XFADE_MS;
      this.fastSwitch = false;
      const steps = Math.max(1, Math.round(fadeMs / STEP_MS));
      let i = 0;
      this.clearRamp();
      this.ramp = setInterval(() => {
        i++;
        const k = Math.min(1, i / steps);
        try {
          to.volume = vol * k;
        } catch {}
        try {
          from.volume = fromV0 * (1 - k);
        } catch {}
        if (k >= 1) {
          this.clearRamp();
          try {
            from.pause();
          } catch {}
          this.active = to;
          this.segEndAt = off + this.rnd(SEG_MIN, SEG_MAX);
          this.xfading = false;
          // Bring the now-idle player onto the current skin too, so future crossfades stay on it
          // (and if this load fails, the next crossfade's ensureCurrent retries: never alternates).
          this.ensureCurrent(this.idle());
          // replace()'s load can outlast REPLACE_LOAD_MS and play() no-ops on a not-yet-loaded
          // player (same as start()'s cold-start bug). If `to` never started, its currentTime is
          // frozen below segEndAt and no further crossfade ever triggers: silent for the rest of
          // the lit session. Kick it like start() does; guards let stop()/a newer crossfade win.
          const kick = (attempt: number) => {
            if (!this.playing || this.xfading || this.active !== to) return;
            let isPlaying = false;
            try {
              isPlaying = to.playing;
            } catch {}
            if (isPlaying) return;
            try {
              to.seekTo(off);
              to.volume = vol;
              to.play();
            } catch {}
            if (attempt < 6) setTimeout(() => kick(attempt + 1), 200);
          };
          setTimeout(() => kick(0), 0);
        }
      }, STEP_MS);
    };
    if (replaced) {
      this.xfTimer = setTimeout(() => {
        this.xfTimer = null;
        begin();
      }, REPLACE_LOAD_MS);
    } else {
      begin();
    }
  }

  /** Fade out and stop the crackle (ignite is one-shot and left alone). */
  stop() {
    this.clearTick();
    this.clearRamp();
    this.clearXfTimer();
    if (!this.playing && !this.xfading) {
      try {
        this.cA.pause();
      } catch {}
      try {
        this.cB.pause();
      } catch {}
      return;
    }
    this.playing = false;
    this.xfading = false;
    const a = this.cA;
    const b = this.cB;
    const va0 = this.safeVol(a);
    const vb0 = this.safeVol(b);
    // A SHORT fade on extinguish (not the long crossfade length) so the sound stops promptly when the
    // user puts the beacon out, instead of lingering ~1s.
    const STOP_FADE_MS = 220;
    const steps = Math.max(1, Math.round(STOP_FADE_MS / STEP_MS));
    let i = 0;
    this.ramp = setInterval(() => {
      i++;
      const k = Math.min(1, i / steps);
      try {
        a.volume = va0 * (1 - k);
      } catch {}
      try {
        b.volume = vb0 * (1 - k);
      } catch {}
      if (k >= 1) {
        this.clearRamp();
        try {
          a.pause();
        } catch {}
        try {
          b.pause();
        } catch {}
      }
    }, STEP_MS);
  }

  /** Free native resources. */
  release() {
    this.clearTick();
    this.clearRamp();
    this.clearXfTimer();
    for (const p of [this.ignite, this.cA, this.cB]) {
      try {
        p.pause();
      } catch {}
      try {
        p.remove();
      } catch {}
    }
  }
}
