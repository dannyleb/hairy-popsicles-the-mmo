// The shop: fertilizer, candles for your plot, name colors, all saved.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { CHARACTER_BY_ID, RARITIES, NAME_COLORS, SHOP } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2576';
const today = new Date().toISOString().slice(0, 10);

async function join(profile) {
  const room = await new Client(URL).joinOrCreate('world', { profile });
  const p = { room, bought: [], saves: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('bought', (b) => p.bought.push(b));
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.send('sync');
  await sleep(300);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}

const rich = saveToken({
  profileId: `rich-${Date.now()}`, name: 'Rich', avatar: 'pimples', xp: 0, currency: 400,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  // Not brand new (a first harvest behind them), so their crops grow at the usual speed.
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: { harvests: 1 }, titles: [], title: null,
}, null, null);
const a = await join(rich);

a.room.send('buy', { item: 'candle' });
await sleep(200);
check('no candle without a plot', a.me.currency === 400 && !a.bought.length);

a.room.send('buy', { item: 'fertilizer' });
await sleep(200);
check('fertilizer: 3 doses for 30', a.me.currency === 370 && a.me.inventory.fertilizer === SHOP.fertilizer.doses);
a.room.send('claimPlot', { plotX: 6, plotY: 6 });
await sleep(150);
a.room.send('plant', { plotKey: '6,6', slot: 4 });
await sleep(200);
const crop = a.state.plots['6,6'].slots[4];
const plain = RARITIES[CHARACTER_BY_ID[crop.characterId].rarity].growMs;
check('a dose makes it grow twice as fast', Math.abs((crop.readyAt - crop.plantedAt) - plain / 2) < 2 && a.me.inventory.fertilizer === 2);

for (let i = 0; i < 5; i++) a.room.send('buy', { item: 'candle' });
await sleep(300);
check('candles stop at 4', a.state.plots['6,6'].candles === 4 && a.me.currency === 370 - 5 - 4 * 50);

a.room.send('buy', { item: 'color', color: 'gold' });
await sleep(250);
check('name color bought and worn', a.me.colors.includes('gold') && a.me.nameColor === 'gold' && a.pub().color === NAME_COLORS.gold);
a.room.send('buy', { item: 'color', color: 'gold' });
a.room.send('setColor', { color: 'slime' });
await sleep(250);
check('no buying twice, no wearing unowned', a.me.colors.length === 1 && a.me.nameColor === 'gold');
a.room.send('setColor', { color: null });
await sleep(250);
check('can go back to plain', a.pub().color === null);
const before = a.me.currency;
a.room.send('buy', { item: 'color', color: 'vein' });
a.room.send('buy', { item: 'nonsense' });
await sleep(250);
check("cannot buy without the scraps, or what isn't sold", a.me.currency === before && !a.me.colors.includes('vein'), `${before} scraps`);

a.room.send('setColor', { color: 'gold' });
await sleep(2300);
const token = a.saves.at(-1);
await a.room.leave(true);
const b = await join(token);
check('restored: candles, colors, fertilizer', b.state.plots['6,6']?.candles === 4 && b.me.nameColor === 'gold' && b.me.inventory.fertilizer === 2);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
