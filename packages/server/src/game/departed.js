// The latest save of everyone who left recently, kept by the server. Someone
// coming back gets this rather than the save their device sends, which can be
// older: the last update before leaving may not have arrived, or a player may
// keep an old copy to replay (say, to give the same character away twice).
// Kept in memory, so a server restart forgets it and the device's save is used.
const KEEP_MS = 3 * 24 * 60 * 60_000;
// Players who got somewhere, and those who haven't yet, kept apart: a flood of
// throwaway players can only push out each other, never anyone with progress.
const pools = {
  players: { kept: new Map(), max: 10_000 },
  newcomers: { kept: new Map(), max: Number(process.env.NEWCOMERS_KEPT) || 2000 },
};

export function rememberDeparture(profileId, token, progressed) {
  forget(profileId);
  const pool = progressed ? pools.players : pools.newcomers;
  pool.kept.set(profileId, { token, at: Date.now() });
  // Oldest first in a Map: drop from the front when it's too big.
  while (pool.kept.size > pool.max) pool.kept.delete(pool.kept.keys().next().value);
}

function forget(profileId) {
  for (const pool of Object.values(pools)) pool.kept.delete(profileId);
}

// Everyone who left in the last few days, newest first, for the admin page.
export function listDepartures() {
  const now = Date.now();
  return Object.values(pools)
    .flatMap((pool) => [...pool.kept.entries()])
    .filter(([, entry]) => now - entry.at <= KEEP_MS)
    .sort(([, a], [, b]) => b.at - a.at)
    .map(([profileId, entry]) => ({ profileId, token: entry.token, at: entry.at }));
}

// The server's own latest save for this player, if it has one; taken back out,
// since the player is live again.
export function takeDeparture(profileId) {
  const entry = pools.players.kept.get(profileId) ?? pools.newcomers.kept.get(profileId);
  forget(profileId);
  if (!entry || Date.now() - entry.at > KEEP_MS) return null;
  return entry.token;
}
