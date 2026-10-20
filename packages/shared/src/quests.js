// Quest kinds the server deals out, three at a time per player. `needsOthers`
// quests are only dealt while someone else in the world could make them possible.
export const QUEST_KINDS = {
  harvest: { counts: [3, 5, 8], text: (n) => `Harvest ${n} characters`, scraps: 5, xp: 10 },
  uncommon: { counts: [1, 2, 3], text: (n) => `Harvest ${n} Uncommon or rarer`, scraps: 10, xp: 18 },
  rare: { counts: [1], minLevel: 3, text: () => 'Harvest a Rare or rarer', scraps: 30, xp: 60 },
  plant: { counts: [4, 6, 10], text: (n) => `Plant ${n} seeds`, scraps: 3, xp: 6 },
  discover: { counts: [1, 2], text: (n) => (n === 1 ? 'Grow a character you never had' : `Grow ${n} characters you never had`), scraps: 12, xp: 25 },
  tend: { counts: [1, 3], needsOthers: true, text: (n) => (n === 1 ? "Squeeze a neighbor's crop" : `Squeeze ${n} of your neighbors' crops`), scraps: 6, xp: 12 },
  chat: { counts: [1], text: () => 'Say something in chat', scraps: 5, xp: 10 },
  emote: { counts: [2, 3], text: (n) => `Emote ${n} times`, scraps: 2, xp: 5 },
  boss: { counts: [5, 12], text: (n) => `Hit The Boil ${n} times`, scraps: 2, xp: 4 },
  grab: { counts: [5, 10], text: (n) => `Grab ${n} globs in a Pus Rain`, scraps: 2, xp: 3 },
  wear: { counts: [1], text: () => 'Play as a different character', scraps: 5, xp: 10 },
};

// One bigger quest a day (UTC), on top of the three above. Its kinds share
// QUEST_KINDS' wording; only the counts and the reward are bigger.
export const DAILY_QUEST = {
  reward: { scraps: 60, xp: 120, boil: 1 },
  counts: {
    harvest: [12, 20],
    uncommon: [4, 6],
    plant: [15, 25],
    discover: [2, 3],
    boss: [25],
  },
};
