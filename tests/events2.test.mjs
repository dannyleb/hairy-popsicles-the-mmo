// More world events: Ingrown Hair (in the Scalp; tug on its beat, a slip off
// it lets the hair back), Blackheads (in the Armpit; squeeze each out once,
// the gunk makes fertilizer) and Navel Lint (the Navel coughs up lint to grab,
// one ball a cough with something in it).
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { BLACKHEADS, INGROWN, LANDMARKS, LINT, REACH, regionAt } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const URL = 'ws://localhost:2595';
const EVENTS = ['eventReward', 'eventOver', 'squeezed', 'gotGlob', 'navelCough', 'announce'];
async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, ev: Object.fromEntries(EVENTS.map((e) => [e, []])), offset: 0 };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; p.offset = s.serverNow - Date.now(); });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; p.offset = s.serverNow - Date.now(); });
  room.onMessage('me', (m) => { p.me = m; });
  for (const e of EVENTS) room.onMessage(e, (m) => p.ev[e].push(m));
  room.send('sync');
  await sleep(400);
  p.now = () => Date.now() + p.offset;
  return p;
}
const today = new Date().toISOString().slice(0, 10);
const veteran = (id, name) => saveToken({
  profileId: id, name, avatar: 'pimples', xp: 2000, currency: 300, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0, fertilizer: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);
const waitFor = async (test, ms) => { for (let t = 0; t < ms && !test(); t += 100) await sleep(100); return test(); };
const walk = async (p, x, y) => { p.room.send('move', { x, y }); await sleep(1500); };

const a = await join({ profile: veteran(`ev2-a-${Date.now()}`, 'Ada') });
const b = await join({ profile: veteran(`ev2-b-${Date.now()}`, 'Bo') });

// ---- Ingrown Hair
check('An Ingrown Hair bulges up, in the Scalp', await waitFor(() => a.state.event?.kind === 'ingrown', 20_000) && regionAt(a.state.event.x, a.state.event.y) === 'scalp');
const hair = a.state.event;
const beatNow = (p) => Math.round((p.now() - hair.startAt) / INGROWN.beatMs);
// Wait for the middle of a beat, then tug on it.
const onBeat = async (p) => {
  const next = hair.startAt + (beatNow(p) + 1) * INGROWN.beatMs;
  await sleep(Math.max(0, next - p.now()));
  return beatNow(p);
};
a.room.send('tug', { beat: beatNow(a) });
await sleep(300);
check("it can't be tugged from across the world", a.state.event.progress === 0);
await Promise.all([walk(a, hair.x + 40, hair.y + 30), walk(b, hair.x - 40, hair.y + 30)]);
let beat = await onBeat(a);
a.room.send('tug', { beat });
await sleep(250);
const one = a.state.event.progress;
a.room.send('tug', { beat });
await sleep(250);
check('a tug on the beat draws it out a little, once a beat', one > 0 && a.state.event.progress === one, `${one}`);
a.room.send('tug', { beat: beat + 5 });
await sleep(250);
check("a tug on a beat that hasn't come yet doesn't count", a.state.event.progress === one);
a.room.send('tug', { miss: true });
await sleep(250);
check('a tap off the beat lets it slip back', a.state.event.progress < one);
const slipped = a.state.event.progress;
a.room.send('tug', { miss: true });
a.room.send('tug', { miss: true });
await sleep(250);
check("and only once a beat (nobody can hold it in by mashing)", a.state.event.progress >= slipped - 1 / 24 - 1e-9);
for (let i = 0; i < 40 && a.state.event?.kind === 'ingrown'; i++) {
  beat = await onBeat(a);
  a.room.send('tug', { beat });
  b.room.send('tug', { beat });
  await sleep(150);
}
check('tugged together on the beat, out it comes', !a.state.event && a.ev.eventOver.some((m) => m.kind === 'ingrown'));
check('everyone who tugged gets paid, and it counts toward Hair Puller', a.ev.eventReward.some((r) => r.kind === 'ingrown') && b.ev.eventReward.some((r) => r.kind === 'ingrown') && a.me.stats.hairs === 1 && b.me.stats.hairs === 1);

// ---- Blackheads
check('Blackheads clog up the Armpit', await waitFor(() => a.state.event?.kind === 'blackheads', 60_000) && regionAt(a.state.event.x, a.state.event.y) === 'armpit');
const patch = a.state.event;
check('a patch of them, by how many are here', patch.heads.length === Math.min(BLACKHEADS.count.max, BLACKHEADS.count.base + 2 * BLACKHEADS.count.perPlayer), `${patch.heads.length}`);
b.room.send('squeeze', { id: patch.heads[0].id });
await sleep(300);
check("they can't be squeezed from across the world", !a.state.event.heads[0].done);
await Promise.all([walk(a, patch.x, patch.y + 20), walk(b, patch.x + 20, patch.y + 20)]);
const fertilizer = { a: a.me.inventory.fertilizer, b: b.me.inventory.fertilizer };
a.room.send('squeeze', { id: 0 });
await sleep(150);
b.room.send('squeeze', { id: 0 });
a.room.send('squeeze', { id: 1 });
await sleep(400);
check('each one comes out once, to whoever got there first; a finger needs holding on another', a.ev.squeezed.filter((m) => m.id === 0).length === 1 && !a.state.event.heads[1].done);
let turn = 0;
for (const head of patch.heads.slice(1)) {
  const p = turn++ % 2 ? a : b;
  if (Math.hypot(head.x - patch.x, head.y - patch.y - 20) > REACH - 10) await walk(p, head.x, head.y + 10);
  p.room.send('squeeze', { id: head.id });
  await sleep(BLACKHEADS.holdMs / 2 + 30);
}
await waitFor(() => !a.state.event, 3000);
check('squeezed clean, the patch is done', a.ev.eventOver.some((m) => m.kind === 'blackheads'));
check('the gunk makes fertilizer for everyone who squeezed', a.me.inventory.fertilizer > fertilizer.a && b.me.inventory.fertilizer > fertilizer.b, `${a.me.inventory.fertilizer - fertilizer.a} and ${b.me.inventory.fertilizer - fertilizer.b} doses`);
check('every blackhead counts toward Pore Squeezer', a.me.stats.blackheads + b.me.stats.blackheads === patch.heads.length);

// ---- Navel Lint
check('The Navel gurgles, then coughs up lint', await waitFor(() => a.state.event?.kind === 'lint', 60_000) && await waitFor(() => a.ev.navelCough.length > 0, 5000));
await sleep(300);
const balls = (a.state.drops ?? []).filter((d) => d.lint);
const navel = LANDMARKS.navel;
check('balls of lint all over its plaza, one with something in it', balls.length > 0 && balls.every((d) => Math.hypot(d.x - navel.x, d.y - navel.y) <= LINT.radius + 1) && balls.filter((d) => d.prize).length === 1, `${balls.length}`);
const before = { scraps: a.me.currency, quests: a.me.quests.map((q) => q.progress).join() };
for (let round = 0; round < 3; round++) {
  for (const ball of (a.state.drops ?? []).filter((d) => d.lint)) {
    const p = ball.id % 2 ? a : b;
    await walk(p, ball.x, ball.y + 8);
    p.room.send('grab', { id: ball.id });
  }
  await waitFor(() => a.ev.navelCough.length > round + 1 || !a.state.event, 7000);
  await sleep(300);
}
// Sweep up any left lying about (one can land behind another's walk).
for (let sweep = 0; sweep < 3 && a.state.event; sweep++) {
  for (const ball of (a.state.drops ?? []).filter((d) => d.lint)) {
    await walk(a, ball.x, ball.y + 8);
    a.room.send('grab', { id: ball.id });
  }
  await waitFor(() => !a.state.event, 3000);
}
const grabbed = [...a.ev.gotGlob, ...b.ev.gotGlob].filter((g) => g.lint);
check('it coughs three times', a.ev.navelCough.length === LINT.coughs);
check('grabbed lint pays, and counts toward Lint Picker (not as Pus Rain globs)', grabbed.length > 0 && a.me.stats.lint + b.me.stats.lint === grabbed.length && a.me.stats.globs === 0 && b.me.stats.globs === 0, `${grabbed.length} grabbed`);
check('the special one had something in it', grabbed.some((g) => g.prize));
check('all grabbed, the Navel settles down', !a.state.event && a.ev.eventOver.some((m) => m.kind === 'lint'), JSON.stringify(a.state.event && { ...a.state.event, now: a.now() }));

await a.room.leave(true);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
