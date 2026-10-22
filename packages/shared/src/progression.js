import { CHARACTERS, CHARACTER_BY_ID } from './characters.js';

// Cumulative XP needed to reach each level (index 0 = level 1).
const LEVEL_XP = [0, 40, 110, 220, 380, 600, 880, 1250, 1700, 2250, 2900, 3700, 4600, 5700, 7000];
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

// Once every hole is open (level 7), each further level makes crops grow a bit faster.
const GREEN_THUMB_FROM = HOLE_ORDER.length - 2;
const GREEN_THUMB_STEP = 0.03;
export const greenThumb = (level) => Math.max(0, level - GREEN_THUMB_FROM) * GREEN_THUMB_STEP;

export const XP = {
  harvest: { common: 10, uncommon: 22, rare: 50, legendary: 120 },
  plant: 2,
  tend: 6,
  bossHit: 1,
  grab: 1,
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

// Now and then a crop comes up shiny: the same character with a gold sheen,
// worth more scraps and announced to everyone. Twice as likely under a Blood Moon.
export const SHINY_CHANCE = 1 / 40;
export const SHINY_SCRAPS = 3;  // a shiny pays this many times the usual scraps

// Growing more copies of a character earns it stars (shown in the album and
// over your head while you play as it).
export const STAR_COPIES = [3, 10, 25];

// Growing every character of a rarity completes that row of the album, for a one-time reward.
export const ALBUM_ROWS = {
  common: { scraps: 40, xp: 80, boil: 0 },
  uncommon: { scraps: 100, xp: 180, boil: 1 },
  rare: { scraps: 250, xp: 350, boil: 2 },
  legendary: { scraps: 600, xp: 700, boil: 3 },
};
// Each (UTC) day one character is featured: it sprouts this many times as often
// as the others of its rarity. Picked from the date, so it's the same everywhere.
export const FEATURED_BOOST = 4;
export function featuredFor(day) {
  let hash = 0x811c9dc5;
  for (const ch of day) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return CHARACTERS[(hash >>> 0) % CHARACTERS.length].id;
}

export const rowComplete = (rarity, collection) => CHARACTERS.every((c) => c.rarity !== rarity || collection[c.id]);
export const starsFor = (copies) => STAR_COPIES.filter((n) => copies >= n).length;

// Playing as a character pays off: rarer characters boost your farming, and
// every star adds a little more. `grow` shortens grow times, `shiny` multiplies
// the shiny odds of what you plant.
const WEAR_BONUS = {
  common: { scraps: 0, grow: 0, shiny: 1 },
  uncommon: { scraps: 0.1, grow: 0, shiny: 1 },
  rare: { scraps: 0.1, grow: 0.1, shiny: 1 },
  legendary: { scraps: 0.2, grow: 0.15, shiny: 2 },
};
const STAR_SCRAPS = 0.05;

export function wearBonus(characterId, copies) {
  const base = WEAR_BONUS[CHARACTER_BY_ID[characterId]?.rarity] ?? WEAR_BONUS.common;
  return { ...base, scraps: base.scraps + STAR_SCRAPS * starsFor(copies) };
}

export function describeBonus({ scraps, grow, shiny }) {
  const parts = [];
  if (scraps) parts.push(`+${Math.round(scraps * 100)}% scraps`);
  if (grow) parts.push(`grows ${Math.round(grow * 100)}% faster`);
  if (shiny > 1) parts.push(`${shiny}× shiny luck`);
  return parts.join(' · ');
}
