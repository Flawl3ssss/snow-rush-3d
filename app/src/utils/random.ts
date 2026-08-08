/**
 * Seeded RNG (mulberry32). Единственный источник случайности в игре.
 * Math.random() ЗАПРЕЩЁН везде (game-feel determinism).
 */

export type RandomFn = () => number;

export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRandom(seed: number | string): RandomFn {
  let a = hashSeed(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next: RandomFn;
  range: (min: number, max: number) => number;
  int: (min: number, max: number) => number; // inclusive
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
  sign: () => number;
}

export function createRng(seed: number | string): Rng {
  const next = createSeededRandom(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}
