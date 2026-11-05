import { loadModeration as loadStored, recentFlags, storeFlag, storeModeration } from '../db.js';

// Chat safety: three strikes and you're out. A line of hate, sexual talk or
// harassment (game/filter.js) isn't sent: it's a strike against the save that
// said it, with a warning. The third bans the save: it's sent off and can't
// join again. So that a fresh save isn't an easy way back, the phone keeps a
// note of the ban and shows it when joining, and for a day no new save can
// join from the same network (anyone who was already playing from there
// still can). Every flagged line, swearing included, is kept for the admin
// page, where a strike or ban can be pardoned. With a database, strikes, bans
// and flagged lines outlive a restart; without one they're in memory only.
export const MAX_STRIKES = 3;
const NETWORK_BAN_MS = Number(process.env.NETWORK_BAN_MS) || 24 * 3600_000;
const FLAGS_KEPT = 300;  // in memory, for the admin page

const records = new Map();   // profile id → { profileId, pid, name, strikes, bannedAt, network }
const byPid = new Map();     // public id → profile id
const networkBans = new Map();  // network → { at, until }
let flags = [];              // newest last: { at, profileId, pid, name, text, category, strike }

function remember(record) {
  records.set(record.profileId, record);
  byPid.set(record.pid, record.profileId);
  if (record.bannedAt && record.network && Date.now() - record.bannedAt < NETWORK_BAN_MS) {
    networkBans.set(record.network, { at: record.bannedAt, until: record.bannedAt + NETWORK_BAN_MS });
  }
}

// At startup: strikes, bans and recent flagged lines from before the restart.
export async function loadModeration() {
  for (const record of await loadStored()) remember(record);
  flags = await recentFlags(FLAGS_KEPT);
}

// A flagged line from this player. With `strike` (hate, sexual, harassment) it
// counts against them; the third bans their save, and new saves from their
// network for a day. Swearing is only noted. Returns { strikes, banned }.
export function flagChat(player, text, category, strike) {
  const now = Date.now();
  const record = records.get(player.profileId) ?? { profileId: player.profileId, pid: player.pid, name: player.name, strikes: 0, bannedAt: null, network: null };
  record.name = player.name;
  if (strike) {
    record.strikes += 1;
    if (record.strikes >= MAX_STRIKES && !record.bannedAt) {
      record.bannedAt = now;
      record.network = player.network ?? null;
    }
    remember(record);
    storeModeration(record);
  }
  const flag = { at: now, profileId: player.profileId, pid: player.pid, name: player.name, text, category, strike: strike ? record.strikes : 0 };
  flags.push(flag);
  if (flags.length > FLAGS_KEPT) flags.shift();
  storeFlag(flag);
  console.log(`flagged ${category}${strike ? ` (strike ${record.strikes})` : ''}: ${player.name}`);
  return { strikes: record.strikes, banned: Boolean(record.bannedAt) };
}

export const strikesOf = (profileId) => records.get(profileId)?.strikes ?? 0;
// Banned saves stay out of everything rebuilt from stored saves after a
// restart: Who's around, held plots, the statue.
export const bannedProfile = (profileId) => Boolean(records.get(profileId)?.bannedAt);
export const bannedPid = (pid) => bannedProfile(byPid.get(pid));

// Why this join is turned away, or null. `save` is the one it brings (if any),
// `bannedAs` the public id the phone remembers being banned as.
export function refusal({ save, bannedAs, network }) {
  if (save && records.get(save.id)?.bannedAt) return 'This save was banned for abusive chat.';
  const marked = typeof bannedAs === 'string' && records.get(byPid.get(bannedAs));
  if (marked?.bannedAt) return 'You were banned for abusive chat.';
  const ban = networkBans.get(network);
  if (ban && Date.now() < ban.until) {
    // Anyone already playing from here before the ban is fine (saves from
    // before the game noted when they started are older than any ban).
    if (!save || (save.startedAt ?? 0) >= ban.at) return 'Someone on your network was just banned for abusive chat, so new players can’t join from it for a day. Players who were already playing still can.';
  } else if (ban) {
    networkBans.delete(network);
  }
  return null;
}

// From the admin page: strikes back to none, and any ban (and its network ban) lifted.
export function pardon(profileId) {
  const record = records.get(profileId);
  if (!record) return false;
  if (record.network) networkBans.delete(record.network);
  Object.assign(record, { strikes: 0, bannedAt: null, network: null });
  storeModeration(record);
  console.log(`pardoned ${record.name}`);
  return true;
}

// For the admin page.
export function moderationReport() {
  const players = [...records.values()].filter((r) => r.strikes > 0 || r.bannedAt)
    .map(({ profileId, pid, name, strikes, bannedAt }) => ({ profileId, pid, name, strikes, bannedAt }))
    .sort((a, b) => (b.bannedAt ?? 0) - (a.bannedAt ?? 0) || b.strikes - a.strikes);
  return { maxStrikes: MAX_STRIKES, players, flags: flags.slice(-200).reverse(), networkBans: networkBans.size };
}
