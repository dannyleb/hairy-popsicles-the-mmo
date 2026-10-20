// A few numbers about who's playing, for GET /stats. Kept in memory, so they
// reset when the server restarts (which, on Render's free tier, it does).
const startedAt = Date.now();
const day = () => new Date().toISOString().slice(0, 10);

const stats = { day: day(), joins: 0, players: new Set(), peak: 0, online: 0 };

function rollOver() {
  if (stats.day === day()) return;
  Object.assign(stats, { day: day(), joins: 0, players: new Set(), peak: stats.online });
}

export function recordJoin(profileId, online) {
  rollOver();
  stats.joins += 1;
  stats.players.add(profileId);
  stats.online = online;
  stats.peak = Math.max(stats.peak, online);
}

export function recordOnline(online) {
  rollOver();
  stats.online = online;
}

export function statsReport() {
  rollOver();
  return {
    online: stats.online,
    today: { day: stats.day, players: stats.players.size, joins: stats.joins, peakOnline: stats.peak },
    upSinceMinutes: Math.round((Date.now() - startedAt) / 60_000),
  };
}
