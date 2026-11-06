/**
 * Mulberry32. Scenes keep the 32-bit generator state inside their own state, so replay
 * from a checkpoint draws the same numbers as replay from the start.
 */
export function nextRandom(rng: number): { value: number; rng: number } {
  const next = (rng + 0x6d2b79f5) | 0;
  let z = Math.imul(next ^ (next >>> 15), next | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return { value: ((z ^ (z >>> 14)) >>> 0) / 4294967296, rng: next };
}
