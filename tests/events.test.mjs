// World events beyond The Boil, taking turns: The Scab (hold to peel; too
// soon and it tears and bleeds; the last piece hides a character), The Gash
// (pick the crumbs of crust; deep ones need two hands) and The Tick (crops near
// it stop growing; a crowd pries it off faster; alone, the head stays in).
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { createTick } = await import('../packages/server/src/game/tick.js');
const { Client } = await import('colyseus.js');
const { GASH, REACH, SCAB, TICK } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

// ---- The Tick's head, without a server: pried alone with others around, it's back soon
function tickWorld(players) {
  const room = { players: {}, plots: {}, said: [], over: [], announce(t) { this.said.push(t); }, markDirty() {}, finishTick(r) { this.over.push(r); } };
  for (const id of players) room.players[id] = { id, x: 0, y: 0 };
  let ended = null;
  const tick = createTick(room, 1, (now, opts) => { ended = opts ?? {}; });
  let now = Date.now();
  tick.start(now);
  const at = tick.position();
  for (const p of Object.values(room.players)) Object.assign(p, { x: at.x, y: at.y });
  return { room, tick, pry: (ids) => { for (const id of ids) tick.pry(room.players[id], (now += 300)); }, ended: () => ended };
}
let world = tickWorld(['a', 'b']);
for (let i = 0; i < 200 && !world.ended(); i++) world.pry(['a']);
check('a Tick pried off by one player, with another here, leaves its head in: it comes back soon', world.ended()?.again === 'tick' && world.room.said.some((t) => t.includes('head')));
world = tickWorld(['a', 'b']);
let rounds = 0;
for (; rounds < 200 && !world.ended(); rounds++) world.pry(['a', 'b']);
check('pried off together, it comes off cleanly, and much faster', world.ended() && !world.ended().again && rounds < (TICK.pry.base + TICK.pry.perPlayer * 2) / 3, `${rounds} rounds`);
world = tickWorld(['a']);
for (let i = 0; i < 200 && !world.ended(); i++) world.pry(['a']);
check('alone in the world, prying it off alone is fine', world.ended() && !world.ended().again);

// ---- on a server: The Scab, then The Gash, then The Tick
const URL = 'ws://localhost:2594';
const EVENTS = ['peeled', 'eventPrize', 'eventReward', 'eventOver', 'crumbPicked', 'announce'];
async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, ev: Object.fromEntries(EVENTS.map((e) => [e, []])) };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('me', (m) => { p.me = m; });
  for (const e of EVENTS) room.onMessage(e, (m) => p.ev[e].push(m));
  room.send('sync');
  await sleep(400);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}
const today = new Date().toISOString().slice(0, 10);
const veteran = (id, name) => saveToken({
  profileId: id, name, avatar: 'pimples', xp: 2000, currency: 300, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);
const waitFor = async (test, ms) => { for (let t = 0; t < ms && !test(); t += 100) await sleep(100); return test(); };
const walk = async (p, x, y) => { p.room.send('move', { x, y }); await sleep(1500); };

const a = await join({ profile: veteran(`ev-a-${Date.now()}`, 'Ada') });
const b = await join({ profile: veteran(`ev-b-${Date.now()}`, 'Bo') });
// Ada grows a few crops, for The Tick to find later.
a.room.send('claimPlot', { plotX: 4, plotY: 4 });
await sleep(300);
for (const slot of [4, 1, 3, 5, 7]) { a.room.send('plant', { plotKey: '4,4', slot, seed: 'pimple' }); await sleep(120); }

// ---- The Scab
check('The Scab crusts over, in ten pieces', await waitFor(() => a.state.event?.kind === 'scab', 15_000) && a.state.event.pieces.length === SCAB.pieces);
const scab = a.state.event;
a.room.send('peel');
await sleep(300);
check("it can't be peeled from across the world", a.ev.peeled.length === 0);
await Promise.all([walk(a, scab.x + 40, scab.y + 30), walk(b, scab.x - 40, scab.y + 30)]);
const early = a.state.serverNow < scab.ripeAt;
a.room.send('peel');
await sleep(250);
a.room.send('peel');  // a finger can't peel twice without holding on again
await sleep(300);
check('peeled before it dries, a piece tears', early && a.ev.peeled.length === 1 && a.ev.peeled[0].torn && a.state.event.pieces.includes(2), `early ${early}`);
check('and bleeds globs for anyone to grab', (a.state.drops ?? []).some((d) => d.blood));
await waitFor(() => a.state.serverNow >= scab.ripeAt, 10_000);
for (let i = 0; i < 30 && a.state.event?.kind === 'scab'; i++) {
  (i % 2 ? a : b).room.send('peel');
  await sleep(330);
}
check('once dry, the rest peel cleanly', a.ev.peeled.slice(1).every((m) => !m.torn) && b.ev.peeled.length > 0 && b.ev.peeled.every((m) => !m.torn));
check('all of it comes off', !a.state.event && a.ev.eventOver.some((m) => m.kind === 'scab'));
const prize = [...a.ev.eventPrize, ...b.ev.eventPrize];
check('whoever peeled the last piece finds a character underneath, Uncommon or better', prize.length === 1 && prize[0].characterId !== 'pimples', JSON.stringify(prize));
check('everyone who peeled gets paid', a.ev.eventReward.some((r) => r.kind === 'scab') && b.ev.eventReward.some((r) => r.kind === 'scab'));
check('every piece counts toward Scab Picker', a.me.stats.peels + b.me.stats.peels === SCAB.pieces, `${a.me.stats.peels} + ${b.me.stats.peels}`);

// ---- The Gash
check('The Gash tears open, with crumbs of crust along it', await waitFor(() => a.state.event?.kind === 'gash', 40_000) && a.state.event.crumbs.length === Math.min(GASH.crumbs.max, GASH.crumbs.base + 2 * GASH.crumbs.perPlayer));
const gash = a.state.event;
const deepOne = gash.crumbs.find((c) => c.deep);
const crumbs = [...gash.crumbs].sort((p, q) => (p.x - q.x) * Math.cos(gash.angle) + (p.y - q.y) * Math.sin(gash.angle));
b.room.send('pick', { id: crumbs[0].id });
await sleep(250);
let checkedDeep = false;
let at = null;
for (const crumb of crumbs) {
  if (!at || Math.hypot(at.x - crumb.x, at.y - crumb.y) > REACH - 40) {
    at = { x: crumb.x, y: crumb.y + 20 };
    await Promise.all([walk(a, at.x, at.y), walk(b, at.x + 10, at.y)]);
  }
  if (crumb.deep) {
    const before = a.me.currency;
    a.room.send('pick', { id: crumb.id });
    await sleep(250);
    a.room.send('pick', { id: crumb.id });
    await sleep(250);
    const still = a.state.event.crumbs.find((c) => c.id === crumb.id);
    b.room.send('pick', { id: crumb.id });
    await sleep(300);
    if (!checkedDeep) {
      checkedDeep = true;
      check('a deep crumb only comes loose for one pair of hands', still && still.loose > a.state.serverNow - 500 && still.loose && a.me.currency >= before);
      check('and comes out with a second', !a.state.event?.crumbs.some((c) => c.id === crumb.id) && a.me.currency > before && b.ev.crumbPicked.some((m) => m.id === crumb.id && m.deep));
    }
    continue;
  }
  (crumb.id % 2 ? a : b).room.send('pick', { id: crumb.id });
  await sleep(240);
}
check('crumbs picked from far away stay put (the first one was tried from afar)', b.ev.crumbPicked.filter((m) => m.id === crumbs[0].id).length <= 1);
check('there was a deep one to try', Boolean(deepOne) && checkedDeep);
check('picked clean, The Gash closes', await waitFor(() => !a.state.event, 3000) && a.ev.eventOver.some((m) => m.kind === 'gash'));
check('everyone who picked gets paid', a.ev.eventReward.some((r) => r.kind === 'gash') && b.ev.eventReward.some((r) => r.kind === 'gash'));
check('and the crumbs count toward Wound Dresser', a.me.stats.crumbs + b.me.stats.crumbs >= gash.crumbs.length, `${a.me.stats.crumbs} + ${b.me.stats.crumbs}`);

// ---- The Tick
check('The Tick latches on', await waitFor(() => a.state.event?.kind === 'tick', 40_000));
const tick = a.state.event;
const plotMiddle = { x: 4.5 * 144, y: 4.5 * 144 };
check('beside the plot with the most growing crops', Math.hypot(tick.x - plotMiddle.x, tick.y - plotMiddle.y) < 200, `${Math.round(Math.hypot(tick.x - plotMiddle.x, tick.y - plotMiddle.y))}px`);
// The crop furthest from ripe, so it's certainly still growing (crops grow slowly in this suite).
const slow = a.state.plots['4,4'].slots.reduce((best, c, i) => (c && (best < 0 || c.readyAt > a.state.plots['4,4'].slots[best].readyAt) ? i : best), -1);
const readyBefore = a.state.plots['4,4'].slots[slow].readyAt;
await Promise.all([walk(a, tick.x + 30, tick.y + 20), walk(b, tick.x - 30, tick.y + 20)]);
for (let i = 0; i < 4; i++) { a.room.send('pry'); await sleep(280); }
const alone = a.state.event.progress;
for (let i = 0; i < 4; i++) { a.room.send('pry'); b.room.send('pry'); await sleep(280); }
check('two hands at once count double', a.state.event?.hands === 2 && a.state.event.progress - alone > alone * 3, `${alone.toFixed(3)} then ${a.state.event?.progress.toFixed(3)}`);
for (let i = 0; i < 40 && a.state.event?.kind === 'tick'; i++) { a.room.send('pry'); b.room.send('pry'); await sleep(280); }
check('pried off together', !a.state.event && a.ev.eventOver.some((m) => m.kind === 'tick' && m.pried));
check('both get paid, and it counts toward Tick Twister', a.ev.eventReward.some((r) => r.kind === 'tick') && b.ev.eventReward.some((r) => r.kind === 'tick') && a.me.stats.ticks === 1 && b.me.stats.ticks === 1);
const readyAfter = a.state.plots['4,4'].slots[slow].readyAt;
check('the crops it fed on lost the time it was on', readyAfter > readyBefore, `${readyAfter - readyBefore}ms`);
check('it all counts toward world-event quests', a.ev.announce.length > 0);

await a.room.leave(true);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
