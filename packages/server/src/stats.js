// A few numbers about who's playing, for GET /stats. Kept in memory, so they
// reset when the server restarts (which, on Render's free tier, it does).
const startedAt = Date.now();
const DAY_MS = 86_400_000;
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const day = () => dayOf(Date.now());

// How far today's new players got, in order: the admin page's funnel.
export const STAGES = ['plot', 'plant', 'harvest', 'level2', 'level3', 'level5'];
const MAX_SESSIONS = 1000;

const fresh = () => ({
  joins: 0, players: new Set(), peak: 0,
  newPlayers: new Set(), invited: new Set(), stages: Object.fromEntries(STAGES.map((s) => [s, new Set()])),
  returning: new Set(), fromYesterday: new Set(), sessions: [],
});
const stats = { day: day(), online: 0, yesterdayNew: null, ...fresh() };

function rollOver() {
  if (stats.day === day()) return;
  // Yesterday's new players, to see who comes back today (only if the server was up for it).
  const yesterdayNew = stats.day === dayOf(Date.now() - DAY_MS) ? stats.newPlayers : null;
  Object.assign(stats, { day: day(), yesterdayNew, ...fresh(), peak: stats.online });
}

// Someone joined: brand new (no save), or back with a save from an earlier day.
// `startedAt` is when their save was first made, where the save knows it.
export function recordArrival(profileId, { isNew, invited, savedAt, startedAt }) {
  rollOver();
  if (isNew) {
    stats.newPlayers.add(profileId);
    if (invited) stats.invited.add(profileId);
    return;
  }
  if (!savedAt || dayOf(savedAt) === stats.day) return;
  stats.returning.add(profileId);
  const startedYesterday = startedAt && dayOf(startedAt) === dayOf(Date.now() - DAY_MS);
  if (startedYesterday || stats.yesterdayNew?.has(profileId)) stats.fromYesterday.add(profileId);
}

// A new player got this far today.
export function recordStage(profileId, stage) {
  rollOver();
  if (stats.newPlayers.has(profileId)) stats.stages[stage]?.add(profileId);
}

export function recordSession(ms) {
  rollOver();
  stats.sessions.push(ms / 60_000);
  if (stats.sessions.length > MAX_SESSIONS) stats.sessions.shift();
}

// For the admin page only.
export function funnelReport() {
  rollOver();
  const minutes = [...stats.sessions].sort((a, b) => a - b);
  const median = minutes.length ? minutes[Math.floor(minutes.length / 2)] : 0;
  const mean = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0;
  return {
    newPlayers: stats.newPlayers.size,
    invited: stats.invited.size,
    stages: Object.fromEntries(STAGES.map((s) => [s, stats.stages[s].size])),
    returning: stats.returning.size,
    fromYesterday: stats.fromYesterday.size,
    yesterdayNew: stats.yesterdayNew?.size ?? null,
    sessions: { count: minutes.length, medianMinutes: Math.round(median * 10) / 10, meanMinutes: Math.round(mean * 10) / 10 },
  };
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
