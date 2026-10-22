// The day's featured character: the same all day, and it sprouts more often.
import { check, finish } from './lib.mjs';
const { CHARACTERS, CHARACTER_BY_ID, FEATURED_BOOST, SEED_BY_ID, featuredFor } = await import('@hptm/shared');
const { rollCharacter } = await import('../packages/server/src/game/roll.js');

const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const asked = [featuredFor(days[0]), featuredFor(days[0])];  // (it's worked out, not rolled)
check('the same day always features the same character', asked[0] === asked[1]);
check('every pick is a real character', days.every((d) => Object.hasOwn(CHARACTER_BY_ID, featuredFor(d))));
const distinct = new Set(days.map(featuredFor)).size;
check('it moves around over two months', distinct >= 15, `${distinct} different`);

// Pimple seeds, a common featured: within commons it should come up
// FEATURED_BOOST times as often as each of the others.
const commons = CHARACTERS.filter((c) => c.rarity === 'common');
const featured = commons[3].id;
const counts = {};
let total = 0;
for (let i = 0; i < 40_000; i++) {
  const c = rollCharacter(SEED_BY_ID.pimple, false, featured);
  if (c.rarity !== 'common') continue;
  counts[c.id] = (counts[c.id] ?? 0) + 1;
  total++;
}
const expected = FEATURED_BOOST / (FEATURED_BOOST + commons.length - 1);
const share = counts[featured] / total;
check('the featured character sprouts more often', Math.abs(share - expected) < 0.03, `${(share * 100).toFixed(1)}% of commons, expected ${(expected * 100).toFixed(1)}%`);
check('the rest of its rarity still turn up', commons.every((c) => counts[c.id] > 0));
const rares = [];
for (let i = 0; i < 4000; i++) rares.push(rollCharacter(SEED_BY_ID.boil, false, featured));
check('other rarities are untouched', rares.every((c) => c.rarity === 'rare' || c.rarity === 'legendary'));

finish();
