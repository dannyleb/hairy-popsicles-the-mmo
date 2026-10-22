import { INVITE } from '@hptm/shared';

// Invite links, as far as the server needs to remember them. In memory, so a
// restart forgets names and rewards waiting on an inviter who's away. (What
// the inviter's save keeps is who they've been paid for, so none pays twice.)
const MAX_KEPT = 10_000;
const OWED_MS = 7 * 24 * 60 * 60_000;
const names = new Map();   // public id → name, so a link can say who it's from
const owed = new Map();    // public id → friends whose reward waits for the inviter to come back
const earned = new Map();  // public id → { day, count } of rewards earned that day

// Oldest first in a Map: drop from the front when it's too big.
function keep(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_KEPT) map.delete(map.keys().next().value);
}

export const noteName = (pid, name) => keep(names, pid, name);
export const nameOf = (pid) => names.get(pid) ?? null;

// Counts one reward toward this inviter's day; false if they've had enough today.
export function earnToday(pid, day) {
  const entry = earned.get(pid)?.day === day ? earned.get(pid) : { day, count: 0 };
  if (entry.count >= INVITE.perDay) return false;
  entry.count += 1;
  keep(earned, pid, entry);
  return true;
}

// A friend ({ name, pid }) reached the level while the inviter was away: paid
// when they're back.
export function owe(pid, friend) {
  const now = Date.now();
  const waiting = (owed.get(pid) ?? []).filter((o) => now - o.at <= OWED_MS);
  keep(owed, pid, [...waiting, { ...friend, at: now }]);
}

export function collectOwed(pid) {
  const waiting = owed.get(pid) ?? [];
  owed.delete(pid);
  return waiting.filter((o) => Date.now() - o.at <= OWED_MS);
}
