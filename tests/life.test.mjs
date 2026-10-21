// Life in the world: strays wandering on their own (the day's featured one
// catchable once a day), and players who are away napping by their plots.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { STRAYS, strayPosition } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
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
const veteran = (id, name) => saveToken({
  profileId: id, name, avatar: 'shiv', xp: 400, currency: 200, collection: { pimples: 1, shiv: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);
// Walk right up to a stray and wait to arrive (it keeps strolling meanwhile).
async function walkTo(p, stray) {
  const at = strayPosition(stray, p.state.serverNow + 200);
  p.room.send('move', { x: at.x + 20, y: at.y + 10 });
  await sleep(1600);
}

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

await woke.room.leave(true);
await watcher.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
