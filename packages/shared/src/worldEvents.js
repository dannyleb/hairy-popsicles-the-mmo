// World events: one at a time, taking turns (The Boil first, then The Scab,
// The Gash and The Tick), a few minutes apart. Everyone nearby joins in.
export const WORLD_EVENT = {
  firstMs: 45_000,
  everyMs: 4 * 60_000,   // after one ends, before the next
  soonMs: 90_000,        // a Tick whose head stayed in comes back this soon
  names: { boil: 'The Boil', scab: 'The Scab', gash: 'The Gash', tick: 'The Tick' },
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
  reward: { scraps: 10, xp: 20, perPry: 2, max: 60 },
};
