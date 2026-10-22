import { slotCenter } from './constants.js';

// World events: one at a time, taking turns, a few minutes apart. The Boil
// comes round every third turn; the rest in between. Everyone nearby joins in.
export const WORLD_EVENT = {
  firstMs: 45_000,
  everyMs: 3 * 60_000,   // after one ends, before the next
  soonMs: 90_000,        // a Tick whose head stayed in comes back this soon
  order: ['boil', 'scab', 'gash', 'boil', 'tick', 'ingrown', 'boil', 'blackheads', 'lint'],
  names: {
    boil: 'The Boil', scab: 'The Scab', gash: 'The Gash', tick: 'The Tick',
    ingrown: 'Ingrown Hair', blackheads: 'Blackheads', lint: 'Navel Lint',
  },
};

// The Scab crusts over and dries. Hold a finger on it to peel a piece; one
// peeled before it's dry tears, pays less and bleeds globs for anyone to grab.
// Whoever peels the last piece finds a character underneath.
export const SCAB = {
  pieces: 10,            // must match SCAB_PIECES in tools/world.py
  holdMs: 700,           // how long a finger has to stay on it to peel a piece
  ripeMs: 40_000,
  lastsMs: 150_000,
  ripe: { scraps: 5, xp: 4 },
  torn: { scraps: 1, xp: 2, globs: 3 },
  done: { scraps: 8, xp: 15 },   // to everyone who peeled, when it's all off
  prize: { common: 0, uncommon: 60, rare: 32, legendary: 8 },
};

// The Gash opens with crumbs of crust along it. Tap one to pick it out; a deep
// one needs a second player's tap while the first has it loose.
export const GASH = {
  length: 520,           // px
  crumbs: { base: 10, perPlayer: 4, max: 26 },
  deepEvery: 5,          // every fifth crumb is deep, when there's more than one player around
  looseMs: 2500,
  lastsMs: 150_000,
  crumb: { scraps: 3, xp: 3 },
  deep: { scraps: 8, xp: 6 },    // to both hands
  done: { scraps: 10, xp: 20 },  // to everyone who picked, when it's clean
};

// The Tick latches on by the busiest plot, and the crops near it stop growing
// while it feeds. Tap to pry: each pry counts once for every player who has
// pried in the last moment, so a crowd gets it off far faster than anyone alone.
export const TICK = {
  reach: 260,            // px: crops this close are fed on
  pry: { base: 30, perPlayer: 15 },
  crowdMs: 2500,
  lastsMs: 120_000,
  // Paid by pries (`each`), up to `max` scraps and `maxXp`; the most a seed from `seedAt`.
  reward: { scraps: 10, xp: 20, each: 2, max: 60, maxXp: 70, seedAt: 5 },
};

// The crops The Tick (at `at`) feeds on: those of players who are here, within
// its reach and still growing as of `since`. Server and client both work it
// out, so they agree on it: [{ crop, owner, x, y }].
export function tickFeedsOn(plots, players, at, since) {
  const crops = [];
  for (const [key, plot] of Object.entries(plots)) {
    const owner = players[plot.ownerId];
    if (!owner || owner.away) continue;
    plot.slots.forEach((crop, slot) => {
      if (!crop || crop.readyAt <= since) return;
      const { x, y } = slotCenter(key, slot);
      if (Math.hypot(x - at.x, y - at.y) <= TICK.reach) crops.push({ crop, owner, x, y });
    });
  }
  return crops;
}

// An Ingrown Hair bulges up in the Scalp. It throbs to a beat: a tug on the
// beat draws the hair out a little; one off the beat lets it slip back. Every
// player can tug once a beat, so a crowd in time pulls it out fast.
export const INGROWN = {
  beatMs: 900,
  window: 170,           // ms either side of a beat that still counts as on it
  tugs: { base: 12, perPlayer: 6 },
  lastsMs: 120_000,
  reward: { scraps: 8, xp: 15, each: 2, max: 50, maxXp: 60, seedAt: 6 },  // by tugs, as TICK's by pries
};

// A patch of Blackheads in the Armpit. Hold a finger on one to squeeze it out
// (each one only once, so it's a race); the gunk makes fertilizer.
export const BLACKHEADS = {
  holdMs: 900,
  count: { base: 8, perPlayer: 3, max: 20 },
  spread: 150,           // px around the patch's middle
  lastsMs: 120_000,
  squeeze: { scraps: 2, xp: 3 },
  fertilizerEvery: 2,    // a dose of fertilizer for every this many squeezed (at least one)
};

// The Navel coughs up lint, a few times over, all over its plaza: grab it.
// One ball in each cough has something in it.
export const LINT = {
  coughs: 3,
  coughEveryMs: 6000,
  perCough: { base: 8, perPlayer: 3, max: 18 },
  radius: 260,           // px from the Navel
  lifeMs: 25_000,        // a ball lies there this long
  scraps: 2,
  prizes: [              // what's in the special one: [chance, prize]
    [0.15, { boil: 1 }],
    [0.35, { fertilizer: 2 }],
    [0.5, { scraps: 15 }],
  ],
};
