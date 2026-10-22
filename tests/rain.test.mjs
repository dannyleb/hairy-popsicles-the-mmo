import { Client } from 'colyseus.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2571';

async function join(name) {
  const room = await new Client(URL).joinOrCreate('world', { name });
  const p = { room, got: [], grabbed: [], announce: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('gotGlob', (g) => p.got.push(g));
  room.onMessage('grabbed', (g) => p.grabbed.push(g));
  room.onMessage('announce', (m) => p.announce.push(m));
  room.send('sync');
  await sleep(300);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}

const a = await join('Racer');
const b = await join('Rival');
let waited = 0;
while (!a.state.rain && waited < 40) { await sleep(250); waited++; }
check('a Pus Rain starts and is announced', Boolean(a.state.rain) && a.announce.some((m) => m.kind === 'rain'));
check('globs rain down around everyone', a.state.drops.length >= 8, `${a.state.drops.length} globs`);

const me = a.pub();
const far = [...a.state.drops].sort((x, y) => Math.hypot(y.x - me.x, y.y - me.y) - Math.hypot(x.x - me.x, x.y - me.y))[0];
a.room.send('grab', { id: far.id });
await sleep(200);
check('grab from too far away does nothing', !a.got.length && a.state.drops.some((d) => d.id === far.id), `${Math.round(Math.hypot(far.x - me.x, far.y - me.y))}px away`);

a.room.send('move', { x: far.x, y: far.y });
a.room.send('grab', { id: far.id });
await sleep(150);
check('grab while still walking over does nothing', !a.got.length);
await sleep(1400);
const scrapsBefore = a.me.currency;
a.room.send('grab', { id: far.id });
await sleep(250);
check('grab after arriving pays scraps', a.got.length === 1 && [2, 10].includes(a.got[0].scraps) && a.me.currency === scrapsBefore + a.got[0].scraps);
check('everyone sees who grabbed it, and it is gone', b.grabbed.some((g) => g.id === far.id && g.by === a.room.sessionId) && !b.state.drops.some((d) => d.id === far.id));

b.room.send('move', { x: far.x, y: far.y });
await sleep(1500);
b.room.send('grab', { id: far.id });
await sleep(200);
check('a glob can only be grabbed once', !b.got.length);

// Short hops one after another are timed as one walk, so nobody gets there sooner.
const at = a.pub();
const next = [...a.state.drops].sort((x, y) => Math.hypot(y.x - at.x, y.y - at.y) - Math.hypot(x.x - at.x, x.y - at.y))[0];
const hops = next ? Math.ceil(Math.hypot(next.x - at.x, next.y - at.y) / 50) : 0;
for (let i = 1; i <= hops; i++) a.room.send('move', { x: at.x + ((next.x - at.x) * i) / hops, y: at.y + ((next.y - at.y) * i) / hops });
const gotSoFar = a.got.length;
a.room.send('grab', { id: next?.id });
await sleep(200);
check('a string of short hops arrives no sooner than one walk', hops >= 5 && a.got.length === gotSoFar && a.state.drops.some((d) => d.id === next.id), `${hops} hops`);

await a.room.leave(true);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
