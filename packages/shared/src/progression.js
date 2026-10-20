// Cumulative XP needed to reach each level (index 0 = level 1).
export const LEVEL_XP = [0, 40, 110, 220, 380, 600, 880, 1250, 1700, 2250, 2900, 3700, 4600, 5700, 7000];
export const MAX_LEVEL = LEVEL_XP.length;

export function levelFor(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level]) level++;
  return level;
}

// Progress through the current level, 0..1 (1 at max level).
export function levelProgress(xp) {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return 1;
  const from = LEVEL_XP[level - 1];
  return (xp - from) / (LEVEL_XP[level] - from);
}

// Holes open up as you level: the middle row first, then the cross, then the corners.
export const HOLE_ORDER = [4, 3, 5, 1, 7, 0, 2, 6, 8];
export const holesFor = (level) => Math.min(HOLE_ORDER.length, 2 + level);
export const holeOpen = (slot, level) => HOLE_ORDER.indexOf(slot) < holesFor(level);
export const levelForHole = (slot) => Math.max(1, HOLE_ORDER.indexOf(slot) - 1);

export const XP = {
  harvest: { common: 10, uncommon: 22, rare: 50, legendary: 120 },
  plant: 2,
  tend: 6,
  bossHit: 1,
};

// What you can plant. Better seeds unlock with level and shift the odds toward rarer characters.
// Boil seeds can't be bought: the world boss drops them.
export const SEEDS = [
  { id: 'pimple', name: 'Pimple Seed', cost: 5, level: 1, weights: { common: 55, uncommon: 28, rare: 13, legendary: 4 } },
  { id: 'pus', name: 'Pus Seed', cost: 15, level: 3, weights: { common: 20, uncommon: 50, rare: 24, legendary: 6 } },
  { id: 'bone', name: 'Bone Seed', cost: 40, level: 6, weights: { common: 0, uncommon: 35, rare: 50, legendary: 15 } },
  { id: 'boil', name: 'Boil Seed', cost: 0, level: 1, dropOnly: true, weights: { common: 0, uncommon: 0, rare: 70, legendary: 30 } },
];
export const SEED_BY_ID = Object.fromEntries(SEEDS.map((s) => [s.id, s]));

// During a Blood Moon the rare end of every seed's odds is multiplied.
export const BLOOD_MOON_BOOST = { rare: 2.5, legendary: 3 };
