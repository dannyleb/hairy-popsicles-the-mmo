import { dailyReward } from '@hptm/shared';

const DAY_MS = 86_400_000;
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);

// The first visit of a (UTC) day extends the streak if the last visit was
// yesterday, or starts it over. Returns the day's reward, or null if today's
// was already collected.
export function checkIn(daily, now) {
  const today = dayOf(now);
  if (daily.last === today) return null;
  daily.streak = daily.last === dayOf(now - DAY_MS) ? daily.streak + 1 : 1;
  daily.last = today;
  return { streak: daily.streak, reward: dailyReward(daily.streak) };
}
