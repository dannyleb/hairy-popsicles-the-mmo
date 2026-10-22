// Limited-time seasons: teeth from harvests, a name color only sold for teeth,
// and nothing of it outside the season.
import { check, finish, sleep } from './lib.mjs';
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { SEASONS, TITLE_BY_ID } = await import('@hptm/shared');
const ROT = SEASONS.find((s) => s.id === 'rot');
const today = new Date().toISOString().slice(0, 10);

async function join(url, profile) {
  const room = await new Client(url).joinOrCreate('world', { profile });
  const p = { room, harvested: [], titles: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('harvested', (h) => p.harvested.push(h));
  room.onMessage('titleEarned', (t) => p.titles.push(t.id));
  room.send('sync');
  await sleep(300);
  return p;
}

const farmer = (id, teeth, statTeeth) => saveToken({
  profileId: `${id}-${Date.now()}`, name: id, avatar: 'pimples', xp: 2900, currency: 5000,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0, teeth }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: { teeth: statTeeth }, titles: [], title: null,
}, null, null);

// Harvest bone-seed crops (Uncommon or better) until `rounds` have come in.
async function farm(p, key, rounds) {
  const deadline = Date.now() + 30_000;
  while (p.harvested.length < rounds && Date.now() < deadline) {
    (p.state.plots[key]?.slots ?? []).forEach((crop, slot) => {
      if (!crop) p.room.send('plant', { plotKey: key, slot, seed: 'bone' });
      else if (crop.readyAt <= Date.now()) p.room.send('harvest', { plotKey: key, slot });
    });
    await sleep(200);
  }
}

// ---- in season (the server pretends it's a day inside it)
const a = await join('ws://localhost:2580', farmer('Ghoul', 10, 30));
check('the season is in the world state', a.state.season?.id === 'rot' && a.state.season.ends === ROT.ends);
a.room.send('buy', { item: 'color', color: ROT.color.id });
await sleep(250);
check("its color can't be bought with scraps", !a.me.colors.includes(ROT.color.id) && a.me.currency === 5000);
a.room.send('buy', { item: 'seasonColor' });
await sleep(250);
check("or without enough teeth", !a.me.colors.includes(ROT.color.id) && a.me.inventory.teeth === 10);

a.room.send('claimPlot', { plotX: 3, plotY: 3 });
await farm(a, '3,3', 20);
const dropped = a.harvested.reduce((n, h) => n + (h.teeth ?? 0), 0);
check('harvests drop teeth', dropped > 0 && a.me.inventory.teeth === 10 + dropped, `${dropped} from ${a.harvested.length} harvests`);
check('teeth count toward the season title', a.me.stats.teeth === 30 + dropped && a.titles.includes(ROT.title) && Boolean(TITLE_BY_ID[ROT.title]));

if (a.me.inventory.teeth < ROT.color.cost) await farm(a, '3,3', 60);
const before = a.me.inventory.teeth;
a.room.send('buy', { item: 'seasonColor' });
await sleep(250);
check('the season color costs teeth', a.me.colors.includes(ROT.color.id) && a.me.nameColor === ROT.color.id && a.me.inventory.teeth === before - ROT.color.cost);
check('and shows on your name', a.state.players[a.room.sessionId].color !== null);
a.room.send('buy', { item: 'seasonColor' });
await sleep(250);
check('only once', a.me.inventory.teeth === before - ROT.color.cost);
await sleep(2200);
await a.room.leave(true);

// ---- out of season
const b = await join('ws://localhost:2581', farmer('Mortal', 50, 0));
check('no season in the world state', b.state.season === null);
b.room.send('buy', { item: 'seasonColor' });
await sleep(250);
check("its color isn't sold out of season", !b.me.colors.includes(ROT.color.id) && b.me.inventory.teeth === 50);
b.room.send('claimPlot', { plotX: 3, plotY: 3 });
await farm(b, '3,3', 12);
check('harvests drop nothing out of season', b.harvested.length >= 12 && b.harvested.every((h) => !h.teeth) && b.me.inventory.teeth === 50);
await b.room.leave(true);

finish();
