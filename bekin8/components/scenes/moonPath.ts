// components/scenes/moonPath.ts
// Single-path crescent moon for the scene backdrops. The standard two-arc construction: the outer
// limb arc of radius r, plus an inner terminator arc from a slightly smaller circle offset toward
// the dark side. The unlit part of the moon simply is not drawn, like real life where earthshine
// is barely visible. (The old approach, a dark disc laid over a bright disc, read as an eclipse
// against the glow halo: a ball sitting on top of a moon.)
//
// litAngleDeg: direction from the moon center toward the middle of the lit limb, in SCREEN degrees
//   (0 = lit limb faces right, 90 = down, 180 = left, -90 = up).
// inner: terminator-circle radius as a fraction of r (default 0.95).
// offset: terminator-circle center distance from the moon center as a fraction of r (default 0.35).
//   Larger = fatter crescent; the crescent's widest span is roughly (1 - inner + offset) * r.
export function crescentMoonPath(
  cx: number,
  cy: number,
  r: number,
  litAngleDeg: number,
  inner = 0.95,
  offset = 0.35
): string {
  const ri = inner * r;
  // Keep the two circles intersecting so this is always a true crescent, never a disc with a hole.
  const d = Math.max(offset * r, (r - ri) * 1.05);
  // Local frame with the lit limb toward +x; the terminator circle center sits at (-d, 0).
  const x0 = (ri * ri - r * r - d * d) / (2 * d); // cusp x (always negative)
  const y0 = Math.sqrt(Math.max(0, r * r - x0 * x0)); // cusp +/- y
  const a = (litAngleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const px = (x: number, y: number) =>
    `${(cx + x * cos - y * sin).toFixed(2)} ${(cy + x * sin + y * cos).toFixed(2)}`;
  // Lower cusp, out along the lit limb (always the major arc of the outer circle), to the upper
  // cusp, then back along the terminator, which bows toward the lit side.
  const innerLarge = x0 + d < 0 ? 1 : 0;
  return (
    `M${px(x0, y0)} ` +
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${px(x0, -y0)} ` +
    `A${ri.toFixed(2)} ${ri.toFixed(2)} 0 ${innerLarge} 1 ${px(x0, y0)} Z`
  );
}
