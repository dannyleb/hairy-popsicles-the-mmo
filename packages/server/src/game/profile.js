import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CHARACTER_BY_ID, NAME_COLORS, NAME_MAX, PLOT_SIZE, RARITY_ORDER, SEED_BY_ID, SHOP, STAT_NAMES, TEND_MAX, TITLE_BY_ID, levelFor,
} from '@hptm/shared';
import { hasBlocked } from './filter.js';

// Saves live on the player's device, signed by the server so they can't be
// edited: no database needed, and progress survives the free host restarting.
// PROFILE_SECRET must stay the same across restarts (render.yaml generates one);
// without it, saves only last until the next restart.
const FORMAT = 1;
const MAX_TOKEN = 16_384;

let secret = process.env.PROFILE_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('hex');
  console.warn('PROFILE_SECRET is not set: saved progress will not survive a server restart.');
}

const sign = (body) => createHmac('sha256', secret).update(body).digest('base64url');
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const time = (t) => (Number.isFinite(t) && t > 0 ? t : 0);

export const newProfileId = () => randomUUID();

// A display name, or '' if it's empty or crosses the line (the player becomes a Guest).
export function cleanName(name) {
  if (typeof name !== 'string') return '';
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return hasBlocked(clean) ? '' : clean;
}

// Everything about a player worth keeping, except where they're standing.
export function saveToken(player, plot, plotKey) {
  const profile = {
    format: FORMAT,
    id: player.profileId,
    name: player.name,
    avatar: player.avatar,
    xp: player.xp,
    currency: player.currency,
    collection: player.collection,
    shinies: player.shinies,
    inventory: player.inventory,
    quests: player.quests.map(({ kind, target, progress }) => ({ kind, target, progress })),
    daily: player.daily,
    dailyQuest: player.dailyQuest,
    stats: player.stats,
    titles: player.titles,
    title: player.title,
    rows: player.rows,
    colors: player.colors,
    nameColor: player.nameColor,
    plot: plot && {
      key: plotKey,
      candles: plot.candles ?? 0,
      slots: plot.slots.map((s) => s && {
        characterId: s.characterId, seed: s.seed, plantedAt: s.plantedAt, readyAt: s.readyAt, shiny: s.shiny, tendedBy: s.tendedBy,
      }),
    },
    savedAt: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(profile)).toString('base64url');
  return `${body}.${sign(body)}`;
}

// A save the client sent back, checked and cleaned up; null if it's missing,
// tampered with, or from another server secret. Characters, seeds and the like
// that no longer exist are dropped rather than failing the whole save.
export function readToken(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (p?.format !== FORMAT || typeof p.id !== 'string') return null;

  const collection = {};
  for (const [id, n] of Object.entries(p.collection ?? {})) {
    if (Object.hasOwn(CHARACTER_BY_ID, id) && count(n)) collection[id] = count(n);
  }
  // Older saves have no shinies.
  const shinies = {};
  for (const [id, n] of Object.entries(p.shinies ?? {})) {
    if (Object.hasOwn(collection, id) && count(n)) shinies[id] = Math.min(count(n), collection[id]);
  }
  const slots = Array.from({ length: PLOT_SIZE * PLOT_SIZE }, (_, i) => {
    const s = p.plot?.slots?.[i];
    if (!s || !Object.hasOwn(CHARACTER_BY_ID, s.characterId) || !Object.hasOwn(SEED_BY_ID, s.seed)) return null;
    if (!time(s.plantedAt) || !time(s.readyAt)) return null;
    // Squeezers are public ids; older saves recorded save ids, which are converted
    // here so they aren't sent to everyone and still count as already squeezed.
    const tendedBy = Array.isArray(s.tendedBy)
      ? s.tendedBy.filter((id) => typeof id === 'string').slice(0, TEND_MAX).map((id) => (id.length === PUBLIC_ID_LENGTH ? id : publicIdOf(id)))
      : [];
    return { characterId: s.characterId, seed: s.seed, plantedAt: s.plantedAt, readyAt: s.readyAt, shiny: s.shiny === true, tendedBy };
  });
  const xp = count(p.xp);
  return {
    id: p.id.slice(0, 64),
    name: cleanName(p.name),
    avatar: Object.hasOwn(collection, p.avatar) ? p.avatar : Object.keys(collection)[0] ?? null,
    xp,
    level: levelFor(xp),
    currency: count(p.currency),
    collection,
    shinies,
    inventory: { boil: count(p.inventory?.boil), fertilizer: count(p.inventory?.fertilizer), teeth: count(p.inventory?.teeth) },
    quests: Array.isArray(p.quests) ? p.quests : [],
    daily: { last: typeof p.daily?.last === 'string' ? p.daily.last.slice(0, 10) : null, streak: count(p.daily?.streak) },
    dailyQuest: p.dailyQuest ?? null,  // checked against today by restoreDaily
    stats: Object.fromEntries(STAT_NAMES.map((name) => [name, count(p.stats?.[name])])),
    titles: Array.isArray(p.titles) ? p.titles.filter((id) => Object.hasOwn(TITLE_BY_ID, id)) : [],
    title: Object.hasOwn(TITLE_BY_ID, p.title) && p.titles?.includes(p.title) ? p.title : null,
    rows: Array.isArray(p.rows) ? [...new Set(p.rows.filter((r) => RARITY_ORDER.includes(r)))] : [],
    colors: Array.isArray(p.colors) ? p.colors.filter((c) => Object.hasOwn(NAME_COLORS, c)) : [],
    nameColor: Object.hasOwn(NAME_COLORS, p.nameColor) && p.colors?.includes(p.nameColor) ? p.nameColor : null,
    plot: typeof p.plot?.key === 'string' ? { key: p.plot.key, slots, candles: Math.min(count(p.plot.candles), SHOP.candle.max) } : null,
    savedAt: time(p.savedAt),
  };
}

// A stable public handle for a save, so others can recognise a player across
// visits (pals) without seeing the save's own id.
const PUBLIC_ID_LENGTH = 12;
export const publicIdOf = (profileId) => createHash('sha256').update(`pal:${profileId}`).digest('base64url').slice(0, PUBLIC_ID_LENGTH);
