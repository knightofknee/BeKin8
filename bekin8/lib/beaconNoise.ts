// lib/beaconNoise.ts
// Seamless, randomized looping noise for the beacon fire + smoke. The trick (BIT-101 looping noise):
// linear time never loops, so we sample value-noise along a CIRCLE in noise-space, at t=0 and
// t=period the sampled point is identical, so any quantity driven by loopNoise(t, seed) is perfectly
// PERIODIC (no visible seam) yet irregular. Give every animated quantity its OWN seed with an
// incommensurate period and the many loops almost never re-align within a session → it reads as
// never-repeating fire while remaining mathematically loopable. Everything here is a worklet (runs
// on the UI thread inside useAnimatedProps).

export type NoiseSeed = { cx: number; cy: number; r: number; period: number };

/** Build a seed. period is in the SAME units as the clock you feed loopNoise (we use seconds). */
export function makeSeed(cx: number, cy: number, r: number, period: number): NoiseSeed {
  return { cx, cy, r, period };
}

function hash2(x: number, y: number): number {
  'worklet';
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  'worklet';
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf); // smoothstep
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** Periodic (period = seed.period) multi-octave noise in ~[0,1]. */
export function loopNoise(t: number, seed: NoiseSeed): number {
  'worklet';
  const ang = (t / seed.period) * Math.PI * 2;
  const x = seed.cx + Math.cos(ang) * seed.r;
  const y = seed.cy + Math.sin(ang) * seed.r;
  // 3 octaves (FBM-ish), each a faster orbit of the same point so the sum is still periodic.
  return (
    0.6 * valueNoise(x, y) +
    0.3 * valueNoise(x * 2.1 + 5.2, y * 2.1 + 1.3) +
    0.1 * valueNoise(x * 4.3 + 9.1, y * 4.3 + 7.7)
  );
}

/** loopNoise centered on 0, range [-amp, amp]. */
export function loopNoiseSigned(t: number, seed: NoiseSeed, amp: number): number {
  'worklet';
  return (loopNoise(t, seed) - 0.5) * 2 * amp;
}
