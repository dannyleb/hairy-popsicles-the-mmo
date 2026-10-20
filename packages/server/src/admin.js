import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CHARACTERS, RARITY_ORDER, TITLE_BY_ID, levelFor } from '@hptm/shared';
import { listDepartures } from './game/departed.js';
import { readToken } from './game/profile.js';
import { clientAddress, createLimiter } from './net.js';
import { getWorld } from './rooms/WorldRoom.js';
import { statsReport } from './stats.js';

// The admin page: who's playing and what they've got. GET /admin is the page
// (no data in it); GET /admin/data is the data, for whoever holds ADMIN_KEY.
// Without ADMIN_KEY set, none of it exists.
const KEY = process.env.ADMIN_KEY ?? '';
const PAGE = readFileSync(new URL('./admin.html', import.meta.url), 'utf8');
// Wrong keys allowed per address, per 10 minutes.
const failures = createLimiter({ limit: 10, windowMs: 10 * 60_000, maxAddresses: 1000 });

const digest = (text) => createHash('sha256').update(text).digest();
const keyDigest = digest(KEY);

// The page may run only its own script and style (and talk only to this server),
// so nothing injected into it could run or send the key anywhere.
const inline = (tag) => createHash('sha256').update(PAGE.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1]).digest('base64');
const POLICY = [
  "default-src 'none'",
  `script-src 'sha256-${inline('script')}'`,
  `style-src 'sha256-${inline('style')}'`,
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': POLICY,
  });
  res.end(body);
}

function authorized(req) {
  const header = String(req.headers.authorization ?? '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return given.length > 0 && timingSafeEqual(digest(given), keyDigest);
}

// Players seen in the last few days but not here now, from the server's copy of
// their last save. (Saves live on players' devices: anyone not seen since the
// server last started isn't known here.)
function departedPlayers(liveIds) {
  const players = [];
  for (const { profileId, token, at } of listDepartures()) {
    if (liveIds.has(profileId)) continue;
    const save = readToken(token);
    if (!save) continue;
    players.push({
      profileId,
      name: save.name,
      status: 'offline',
      since: at,
      level: levelFor(save.xp),
      xp: save.xp,
      scraps: save.currency,
      avatar: save.avatar,
      collection: save.collection,
      shinies: save.shinies,
      inventory: save.inventory,
      stats: save.stats,
      titles: save.titles,
      title: save.title,
      nameColor: save.nameColor,
      rows: save.rows,
      streak: save.daily.streak,
      quests: save.quests,
      dailyQuest: save.dailyQuest,
      plot: save.plot && { key: save.plot.key, crops: save.plot.slots.filter(Boolean).length },
    });
  }
  return players;
}

function report(you) {
  const world = getWorld()?.adminView() ?? { players: [], heldPlots: [], events: null, chat: [] };
  const liveIds = new Set(world.players.map((p) => p.profileId));
  return {
    at: Date.now(),
    you,  // the address this server sees for you, and where it got it: the lockout goes by it
    stats: statsReport(),
    players: [...world.players, ...departedPlayers(liveIds)],
    heldPlots: world.heldPlots,
    events: world.events,
    chat: world.chat,
    characters: CHARACTERS.map(({ id, name, rarity }) => ({ id, name, rarity })),
    rarities: RARITY_ORDER,
    titles: Object.fromEntries(Object.entries(TITLE_BY_ID).map(([id, t]) => [id, t.name])),
  };
}

// True if this request was the admin page's to answer.
export function handleAdmin(req, res) {
  const path = String(req.url ?? '').split('?')[0];
  if (path !== '/admin' && path !== '/admin/data') return false;
  if (!KEY) {
    send(res, 404, 'text/plain', 'not found');
    return true;
  }
  if (path === '/admin') {
    send(res, 200, 'text/html; charset=utf-8', PAGE);
    return true;
  }
  const you = clientAddress(req);
  if (failures.blocked(you.address)) {
    send(res, 429, 'application/json', JSON.stringify({ error: 'Too many wrong keys. Try again in a few minutes.' }));
    return true;
  }
  if (!authorized(req)) {
    failures.take(you.address);
    send(res, 401, 'application/json', JSON.stringify({ error: 'Wrong key.' }));
    return true;
  }
  failures.clear(you.address);
  send(res, 200, 'application/json', JSON.stringify(report(you)));
  return true;
}
