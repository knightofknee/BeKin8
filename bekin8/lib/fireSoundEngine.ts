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
const XFADE_MS = 900; // crossfade length
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
  private pendingCrackle: Src | null = null;
  private playing = false;
  private xfading = false;
  private segEndAt = 0; // active.currentTime threshold that triggers the next crossfade
  private tick: ReturnType<typeof setInterval> | null = null;
  private ramp: ReturnType<typeof setInterval> | null = null;

  constructor(crackle: Src, ignite: Src) {
    this.crackleSrc = crackle;
    this.igniteSrc = ignite;
    this.ignite = createAudioPlayer(ignite);
    this.cA = createAudioPlayer(crackle);
    this.cB = createAudioPlayer(crackle);
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
  private safeVol(p: AudioPlayer) {
    try {
      return p.volume;
    } catch {
      return 0;
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
      if (this.playing) {
        this.pendingCrackle = crackle;
        // Force a crossfade soon so the skin switch is heard within ~1s, without a gap.
        try {
          this.segEndAt = Math.min(this.segEndAt, this.active.currentTime + 0.8);
        } catch {}
      } else {
        try {
          this.cA.replace(crackle);
        } catch {}
        try {
          this.cB.replace(crackle);
        } catch {}
      }
    }
  }

  /** One-shot ignition (source already loaded via setSources). */
  playIgnite(vol = IGNITE_VOL) {
    try {
      this.ignite.seekTo(0);
      this.ignite.volume = vol;
      this.ignite.play();
    } catch {}
  }

  /** Start the crackle scheduler. */
  start(vol = CRACKLE_VOL) {
    if (this.playing) return;
    this.playing = true;
    this.xfading = false;
    this.clearRamp();
    const a = this.active;
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
    this.tick = setInterval(() => this.onTick(vol), TICK_MS);
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
    const replaced = this.pendingCrackle != null;
    if (replaced) {
      try {
        to.replace(this.pendingCrackle as number);
      } catch {}
    }
    const begin = () => {
      const off = this.safeOffset();
      try {
        to.seekTo(off);
        to.volume = 0;
        to.play();
      } catch {}
      const steps = Math.max(1, Math.round(XFADE_MS / STEP_MS));
      let i = 0;
      this.clearRamp();
      this.ramp = setInterval(() => {
        i++;
        const k = Math.min(1, i / steps);
        try {
          to.volume = vol * k;
        } catch {}
        try {
          from.volume = vol * (1 - k);
        } catch {}
        if (k >= 1) {
          this.clearRamp();
          try {
            from.pause();
          } catch {}
          this.active = to;
          this.segEndAt = off + this.rnd(SEG_MIN, SEG_MAX);
          this.xfading = false;
          // Bring the now-idle player onto the new skin too, so future crossfades stay on it.
          if (this.pendingCrackle != null) {
            try {
              this.idle().replace(this.pendingCrackle as number);
            } catch {}
            this.pendingCrackle = null;
          }
        }
      }, STEP_MS);
    };
    if (replaced) setTimeout(begin, REPLACE_LOAD_MS);
    else begin();
  }

  /** Fade out and stop the crackle (ignite is one-shot and left alone). */
  stop() {
    this.clearTick();
    this.clearRamp();
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
