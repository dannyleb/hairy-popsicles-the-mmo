// The latest save of everyone who left recently, kept by the server. Someone
// coming back gets this rather than the save their device sends, which can be
// older: the last update before leaving may not have arrived, or a player may
// keep an old copy to replay (say, to give the same character away twice).
// Kept in memory, so a server restart forgets it and the device's save is used.
const KEEP_MS = 3 * 24 * 60 * 60_000;
const MAX_KEPT = 10_000;
const departed = new Map();

export function rememberDeparture(profileId, token) {
  departed.delete(profileId);
  departed.set(profileId, { token, at: Date.now() });
  // Oldest first in a Map: drop from the front when it's too big.
  while (departed.size > MAX_KEPT) departed.delete(departed.keys().next().value);
}

// Everyone who left in the last few days, newest first, for the admin page.
export function listDepartures() {
  const now = Date.now();
  return [...departed.entries()]
    .filter(([, entry]) => now - entry.at <= KEEP_MS)
    .map(([profileId, entry]) => ({ profileId, token: entry.token, at: entry.at }))
    .reverse();
}

// The server's own latest save for this player, if it has one; taken back out,
// since the player is live again.
export function takeDeparture(profileId) {
  const entry = departed.get(profileId);
  departed.delete(profileId);
  if (!entry || Date.now() - entry.at > KEEP_MS) return null;
  return entry.token;
}
