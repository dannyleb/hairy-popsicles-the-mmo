// Who's been in the world lately, for "Who's around" (the title screen and the
// who's-here sheet), so friends can see if their pals are on or have been:
// everyone here now with how long since they last did anything, and who left
// in the last few days, newest first. Only what the world already shows of a
// player: their public id (what pals are kept by), name, level and character.
// Kept in memory, and refilled from the database after a restart.
import { recentSaves } from '../db.js';
import { publicIdOf, readToken } from './profile.js';

const SEEN_MS = 3 * 24 * 60 * 60_000;
const SEEN_SAVES = 500;  // read back from the database at startup
const MAX_KEPT = 2000;
const MAX_LISTED = 60;
// As with the database, only players who got somewhere: a flood of throwaway
// players can't push anyone's friends off the list.
const SEEN_FROM_LEVEL = 2;

const left = new Map();  // public id → { pid, name, level, avatar, at }, least recently noted first

export function noteLeft({ pid, name, level, avatar }, at = Date.now()) {
  if (!pid || level < SEEN_FROM_LEVEL || Date.now() - at > SEEN_MS) return;
  if ((left.get(pid)?.at ?? 0) > at) return;  // already know of a later visit
  left.delete(pid);
  left.set(pid, { pid, name: name || 'Someone', level, avatar, at });
  while (left.size > MAX_KEPT) left.delete(left.keys().next().value);
}

// After a restart: who'd been by, from their stored saves (newest first).
export async function loadSeen() {
  const saves = await recentSaves(Date.now() - SEEN_MS, SEEN_SAVES);
  for (const { token, at } of saves) {
    const save = readToken(token);
    if (save) noteLeft({ pid: publicIdOf(save.id), name: save.name, level: save.level, avatar: save.avatar }, at);
  }
}

// `players`: everyone in the world now (the room's players). Times are how long
// ago, in seconds, so a phone's clock being off doesn't matter.
export function seenReport(players, now = Date.now()) {
  const here = players.map((p) => ({
    pid: p.pid, name: p.name, level: p.level, avatar: p.avatar,
    idle: Math.max(0, Math.floor((now - p.activeAt) / 1000)),
    away: p.away,  // their phone dropped the connection; held for a minute or so
  })).sort((a, b) => Number(a.away) - Number(b.away) || a.idle - b.idle);
  const hereNow = new Set(here.map((p) => p.pid));
  const gone = [...left.values()]
    .filter((p) => !hereNow.has(p.pid) && now - p.at <= SEEN_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_LISTED)
    .map(({ pid, name, level, avatar, at }) => ({ pid, name, level, avatar, ago: Math.max(0, Math.floor((now - at) / 1000)) }));
  return { here, left: gone };
}
