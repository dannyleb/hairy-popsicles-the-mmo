// What each day of a login streak pays. After day 7 the rewards start over
// (the streak itself keeps counting). Days roll over at midnight UTC.
export const DAILY_REWARDS = [
  { scraps: 15 },
  { scraps: 25 },
  { scraps: 20, boil: 1 },
  { scraps: 40 },
  { scraps: 60 },
  { scraps: 40, boil: 1 },
  { scraps: 100, boil: 2 },
];

export const dailyReward = (streak) => DAILY_REWARDS[(streak - 1) % DAILY_REWARDS.length];
