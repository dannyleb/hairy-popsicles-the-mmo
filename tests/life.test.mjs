// Life in the world: strays wandering on their own (the day's featured one
// catchable once a day), players who are away napping by their plots, and the
// landmarks: plots kept free for them, and the statue of the top collector.
import { check, finish, sleep } from './lib.mjs';
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { CHARACTERS, LANDMARKS, SKY, STRAYS, WEATHER, daylight, isReservedPlot, strayPosition, weatherAt } = await import('@hptm/shared');
const URL = 'ws://localhost:2593';

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, saves: [], caught: [], announce: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.onMessage('caughtStray', (m) => p.caught.push(m));
  room.onMessage('announce', (m) => p.announce.push(m));
  room.send('sync');
  await sleep(400);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}
const lastSave = (p) => JSON.parse(Buffer.from(p.saves.at(-1).split('.')[0], 'base64url').toString());
const today = new Date().toISOString().slice(0, 10);
const veteran = (id, name, { collection = { pimples: 1, shiv: 1 }, plot = null, key = null } = {}) => saveToken({
  profileId: id, name, avatar: 'shiv', xp: 400, currency: 200, collection, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, plot, key);
const album = (n) => Object.fromEntries(CHARACTERS.slice(0, n).map((c) => [c.id, 1]));
// Walk right up to a stray and wait to arrive (it keeps strolling meanwhile).
async function walkTo(p, stray) {
  const at = strayPosition(stray, p.state.serverNow + 200);
  p.room.send('move', { x: at.x + 20, y: at.y + 10 });
  await sleep(1600);
}

// ---- the sky, from the clock alone (so every screen agrees)
const day = Math.floor(Date.now() / SKY.dayMs) * SKY.dayMs;
check('midday is light and midnight is dark', daylight(day) === 1 && daylight(day + SKY.dayMs / 2) === 0 && daylight(day + SKY.dayMs / 4) > 0 && daylight(day + SKY.dayMs / 4) < 1);
const firstWindow = Math.floor(Date.now() / SKY.weatherMs) * SKY.weatherMs;
const windows = Array.from({ length: 600 }, (_, i) => weatherAt(firstWindow + i * SKY.weatherMs + SKY.weatherMs / 2));
const kinds = Object.fromEntries(Object.keys(WEATHER).map((k) => [k, windows.filter((w) => w.kind === k).length / windows.length]));
check('the weather comes in every kind, about as often as meant', Object.entries(WEATHER).every(([k, { share }]) => Math.abs(kinds[k] - share) < 0.08), JSON.stringify(kinds));
const wet = windows.findIndex((w) => w.kind !== 'clear');
const start = firstWindow + wet * SKY.weatherMs;
const asked = [weatherAt(start + 1000), weatherAt(start + 1000)].map((w) => JSON.stringify(w));  // (worked out, not rolled)
check('weather is the same whenever it is asked for', asked[0] === asked[1]);
check('and fades in and out at the edges of its window', weatherAt(start + 1).strength < 0.01 && weatherAt(start + SKY.weatherMs / 2).strength === 1 && weatherAt(start + SKY.weatherMs - 1).strength < 0.01);

// ---- strays wander
const a = await join({ profile: veteran(`life-a-${Date.now()}`, 'Catcher') });
const strays = a.state.strays;
const featured = strays.filter((s) => s.featured);
check('the world has its strays', strays.length === STRAYS.count, `${strays.length}`);
check("one of them is the day's featured character", featured.length === 1 && featured[0].characterId === a.state.featured);
check('the rest are other characters, no two alike', new Set(strays.map((s) => s.characterId)).size === strays.length);
const legs = new Map(strays.map((s) => [s.id, s.t0]));
let wandered = false;
for (let i = 0; i < 30 && !wandered; i++) {
  await sleep(500);
  wandered = a.state.strays.some((s) => legs.has(s.id) && s.t0 !== legs.get(s.id));
}
check('they wander off on their own', wandered);
const one = a.state.strays.find((s) => s.t1 > s.t0);
check('a leg is a stroll, inside the world', one && Math.hypot(one.x1 - one.x0, one.y1 - one.y0) <= STRAYS.leg[1] + 1
  && [one.x1, one.y1].every((v) => v >= STRAYS.margin && v <= 2880 - STRAYS.margin));

// ---- catching
const target = () => a.state.strays.find((s) => s.featured);
a.room.send('catchStray', { id: target().id });
await sleep(300);
check("the featured stray can't be caught from across the world", a.caught.length === 0);
const other = a.state.strays.find((s) => !s.featured);
await walkTo(a, other);
a.room.send('catchStray', { id: other.id });
await sleep(300);
check('only the featured one can be caught', a.caught.length === 0);
const copies = a.me.collection[target().characterId] ?? 0;
await walkTo(a, target());
a.room.send('catchStray', { id: target().id });
await sleep(400);
const caught = a.caught[0];
check('walk up to it and it joins your album', caught?.characterId === target().characterId && a.me.collection[caught.characterId] === copies + 1, JSON.stringify(caught));
check('it says whether it was new to you', caught?.isNew === (copies === 0));
check('it counts toward the Dogcatcher title', a.me.stats.strays === 1);
check('and the player is told they have had today\'s (so it stops glowing for them)', a.me.strayDay === today);
check('everyone hears about it', a.announce.some((m) => m.text.includes("caught today's stray")));
await walkTo(a, target());
a.room.send('catchStray', { id: target().id });
await sleep(400);
check('once a day', a.caught.length === 1 && a.me.collection[caught.characterId] === copies + 1);
await sleep(2200);  // saves go out at most every 2s
check('the catch is in their save', lastSave(a).strayDay === today);
const token = a.saves.at(-1);
await a.room.leave(true);
await sleep(300);
const back = await join({ profile: token });
await walkTo(back, back.state.strays.find((s) => s.featured));
back.room.send('catchStray', { id: back.state.strays.find((s) => s.featured).id });
await sleep(400);
check('coming back the same day is no second catch', back.caught.length === 0);
await back.room.leave(true);

// ---- sleeping owners
const sleeperId = `life-sleeper-${Date.now()}`;
const sleeper = await join({ profile: veteran(sleeperId, 'Napper') });
sleeper.room.send('claimPlot', { plotX: 2, plotY: 2 });
await sleep(300);
sleeper.room.send('plant', { plotKey: '2,2', slot: 4, seed: 'pimple' });
await sleep(300);
const pid = sleeper.pub().pid;
const watcher = await join({ name: 'Watcher' });
await sleeper.room.leave(true);
await sleep(500);
const held = watcher.state.plots['2,2'];
check("an away player's plot says who's napping by it", held?.away && held.ownerAvatar === 'shiv' && held.ownerPid === pid, JSON.stringify(held && { away: held.away, ownerAvatar: held.ownerAvatar, ownerPid: held.ownerPid }));
const woke = await join({ profile: veteran(sleeperId, 'Napper') });
await sleep(300);
const mine = watcher.state.plots['2,2'];
check('and stops when they wake up', mine && !mine.away && mine.ownerAvatar === undefined && mine.ownerPid === undefined && mine.ownerId === woke.room.sessionId);

// ---- landmarks
const [nx, ny] = LANDMARKS.navel.plots;
watcher.room.send('claimPlot', { plotX: nx, plotY: ny });
await sleep(300);
check("nobody can farm where a landmark stands", !watcher.state.plots[`${nx},${ny}`]);
const growing = { characterId: 'pimples', seed: 'pimple', plantedAt: Date.now(), readyAt: Date.now() + 3600_000, shiny: false, tendedBy: [] };
const oldPlot = { candles: 0, slots: Array.from({ length: 9 }, (_, i) => (i === 4 ? growing : null)) };
const settler = await join({ profile: veteran(`life-settler-${Date.now()}`, 'Settler', { plot: oldPlot, key: `${nx + 1},${ny + 1}` }) });
const moved = Object.entries(settler.state.plots).find(([, plot]) => plot.ownerId === settler.room.sessionId);
check('a plot saved where a landmark now stands comes back next to it', moved && !isReservedPlot(moved[0]) && moved[1].slots[4]?.characterId === 'pimples'
  && Math.abs(Number(moved[0].split(',')[0]) - nx) <= 2 && Math.abs(Number(moved[0].split(',')[1]) - ny) <= 2, moved?.[0]);

await sleep(2300);  // everyone's first save has gone out
const first = watcher.state.statue;
check("there's a statue of the top collector so far", first?.album >= 2 && Boolean(first.name && first.avatar), JSON.stringify(first));
const collector = await join({ profile: veteran(`life-collector-${Date.now()}`, 'Hoarder', { collection: album(12) }) });
await sleep(2300);
check('someone with more takes it over', watcher.state.statue?.name === 'Hoarder' && watcher.state.statue.album === 12 && watcher.state.statue.pid === collector.pub().pid, JSON.stringify(watcher.state.statue));
const lesser = await join({ profile: veteran(`life-lesser-${Date.now()}`, 'Lesser', { collection: album(5) }) });
await sleep(2300);
check('and someone with fewer does not', watcher.state.statue?.name === 'Hoarder');
await Promise.all([settler, collector, lesser].map((p) => p.room.leave(true)));

await woke.room.leave(true);
await watcher.room.leave(true);
finish();
