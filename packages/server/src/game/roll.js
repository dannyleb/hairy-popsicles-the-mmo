import { BLOOD_MOON_BOOST, CHARACTERS, RARITY_ORDER } from '@hptm/shared';

const BY_RARITY = Object.fromEntries(RARITY_ORDER.map((r) => [r, CHARACTERS.filter((c) => c.rarity === r)]));

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export const randomCommon = () => pick(BY_RARITY.common);

export function rollCharacter(seed, bloodMoon) {
  const weights = RARITY_ORDER.map((r) => seed.weights[r] * (bloodMoon ? BLOOD_MOON_BOOST[r] ?? 1 : 1));
  let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < RARITY_ORDER.length; i++) {
    roll -= weights[i];
    if (roll < 0 && weights[i] > 0) return pick(BY_RARITY[RARITY_ORDER[i]]);
  }
  const last = RARITY_ORDER.findLast((r, i) => weights[i] > 0);
  return pick(BY_RARITY[last]);
}
