import { BLOOD_MOON_BOOST, CHARACTERS, CHARACTER_BY_ID, FEATURED_BOOST, RARITY_ORDER } from '@hptm/shared';

const BY_RARITY = Object.fromEntries(RARITY_ORDER.map((r) => [r, CHARACTERS.filter((c) => c.rarity === r)]));

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export const randomCommon = () => pick(BY_RARITY.common);

// One of a rarity, with the day's featured character (if it's this rarity) more likely.
function pickOf(rarity, featured) {
  if (CHARACTER_BY_ID[featured]?.rarity !== rarity) return pick(BY_RARITY[rarity]);
  const others = BY_RARITY[rarity].length - 1;
  if (Math.random() < FEATURED_BOOST / (FEATURED_BOOST + others)) return CHARACTER_BY_ID[featured];
  return pick(BY_RARITY[rarity].filter((c) => c.id !== featured));
}

export function rollCharacter(seed, bloodMoon, featured = null) {
  const weights = RARITY_ORDER.map((r) => seed.weights[r] * (bloodMoon ? BLOOD_MOON_BOOST[r] ?? 1 : 1));
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < RARITY_ORDER.length; i++) {
    roll -= weights[i];
    if (roll < 0 && weights[i] > 0) return pickOf(RARITY_ORDER[i], featured);
  }
  const last = RARITY_ORDER.findLast((r, i) => weights[i] > 0);
  return pickOf(last, featured);
}
