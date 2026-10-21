// Plots of players who've gone stay in the world (for a while) for others to
// see and squeeze, and are theirs again when they come back.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { TEND_SCRAPS } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2582';
const HOLD_MS = 8000;  // PLOT_HOLD_MS for this suite's server
const today = new Date().toISOString().slice(0, 10);

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, notices: [], saves: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => {
    p.raw = s;
    if (s.plots) p.plotSends = (p.plotSends ?? 0) + 1;
    p.state = { ...s, plots: s.plots ?? p.state?.plots };  // plots come only when changed
  });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('notice', (n) => p.notices.push(n));
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.send('sync');
  await sleep(300);
  return p;
}
const farmer = (name) => saveToken({
  profileId: `held-${name}-${Date.now()}`, name, avatar: 'pimples', xp: 2900, currency: 5000,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);

// ---- A plants and leaves; the plot stays
const a = await join({ profile: farmer('Absent') });
a.room.send('claimPlot', { plotX: 7, plotY: 7 });
await sleep(200);
for (let slot = 0; slot < 9; slot++) a.room.send('plant', { plotKey: '7,7', slot, seed: 'bone' });
await sleep(2400);  // a save goes out
const token = a.saves.at(-1);
const planted = a.state.plots['7,7'].slots.map((s) => s?.readyAt);
await a.room.leave(true);

const b = await join({ name: 'Neighbor' });
const held = b.state.plots['7,7'];
check("a departed player's growing plot stays in the world", Boolean(held) && held.away === true && held.ownerId === null && held.ownerName === 'Absent');
check('it carries their level, for its locked holes', held?.ownerLevel >= 7);

// ---- others can squeeze it, but not harvest or take the spot
const slot = held.slots.findIndex((c) => c && c.readyAt - Date.now() > 4000);
const at = { x: 7 * 144 + (slot % 3) * 48 + 24, y: 7 * 144 + Math.floor(slot / 3) * 48 + 24 };
b.room.send('move', { x: at.x, y: at.y + 30 });
await sleep(1500);
const before = b.me.currency;
b.room.send('tend', { plotKey: '7,7', slot });
await sleep(300);
check('a neighbor can squeeze a crop on it', b.me.currency === before + TEND_SCRAPS && b.state.plots['7,7'].slots[slot].readyAt < planted[slot]);
b.room.send('harvest', { plotKey: '7,7', slot: held.slots.findIndex((c) => c && c.readyAt <= Date.now()) });
b.room.send('claimPlot', { plotX: 7, plotY: 7 });
await sleep(300);
check("but can't harvest it or claim the spot", b.state.plots['7,7'].away && b.state.plots['7,7'].slots.filter(Boolean).length === 9);

// ---- A comes back to the same plot, squeeze and all
await sleep(3200);  // long enough for a welcome back (60s × GROW_SCALE)
const back = await join({ profile: token });
const mine = back.state.plots['7,7'];
check('coming back reclaims the held plot', mine?.ownerId === back.room.sessionId && !mine.away);
check("with the neighbor's squeeze kept (newer than the save)", mine?.slots[slot].readyAt < planted[slot]);
const welcome = back.notices.find((n) => n.kind === 'welcome');
check('the welcome back says how many squeezes', welcome?.squeezed === 1, JSON.stringify(welcome));
check('one plot, not two', Object.values(back.state.plots).filter((p) => p.ownerName === 'Absent').length === 1);

// ---- an empty plot isn't held
const c = await join({ name: 'Empty' });
c.room.send('claimPlot', { plotX: 12, plotY: 12 });
await sleep(300);
await c.room.leave(true);
await sleep(300);
check('an empty plot goes when its owner does', !b.state.plots['12,12']);

// ---- nor is a brand-new player's (throwaway saves can't fill the world)
const d = await join({ name: 'Newbie' });
d.room.send('claimPlot', { plotX: 13, plotY: 13 });
await sleep(200);
d.room.send('plant', { plotKey: '13,13', slot: 4 });
await sleep(300);
const planted13 = Boolean(b.state.plots['13,13']?.slots[4]);
await d.room.leave(true);
await sleep(300);
check("a level 1 player's plot isn't held", planted13 && !b.state.plots['13,13']);

// ---- held plots don't last forever
await sleep(2400);
const token2 = back.saves.at(-1);
await back.room.leave(true);
await sleep(300);
check('held again on leaving', b.state.plots['7,7']?.away === true);
await sleep(HOLD_MS + 1500);
check('and let go once the hold runs out', !b.state.plots['7,7']);
const again = await join({ profile: token2 });
check('after which the save brings it back as usual', again.state.plots['7,7']?.ownerId === again.room.sessionId);

// ---- walking about doesn't resend every plot
b.room.send('move', { x: 300, y: 300 });
await sleep(400);
check("a move that changes no plot doesn't resend the plots", b.raw && !('plots' in b.raw) && Object.keys(b.state.plots).length > 0);
// (Other things going on, like strays wandering, send the state without plots meanwhile.)
const sends = b.plotSends ?? 0;
b.room.send('claimPlot', { plotX: 15, plotY: 15 });
await sleep(400);
check('a plot change does', (b.plotSends ?? 0) === sends + 1);

await again.room.leave(true);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
