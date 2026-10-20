// The Itch: now and then the whole world itches, and everyone online works
// toward one target together. Everyone who chipped in shares the reward.
// Its kinds share QUEST_KINDS' names, so the same actions count toward both.
export const ITCH = {
  firstMs: 4 * 60_000,
  restMs: 8 * 60_000,     // between one itch ending and the next
  lastsMs: 12 * 60_000,
  kinds: {
    harvest: { perPlayer: 10, text: (n) => `Harvest ${n} characters together` },
    plant: { perPlayer: 12, text: (n) => `Plant ${n} seeds together` },
    uncommon: { perPlayer: 4, text: (n) => `Harvest ${n} Uncommon or rarer together` },
  },
  reward: { scraps: 30, xp: 60, boil: 1 },
};

// The target is set when the itch starts, from how many are online then.
export const itchTarget = (kind, players) => ITCH.kinds[kind].perPlayer * Math.max(1, players);
