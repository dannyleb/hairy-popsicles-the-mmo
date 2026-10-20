// High levels: every hole open, and crops growing faster for each level past 7.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { CHARACTER_BY_ID, RARITIES, greenThumb, levelFor } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const XP = 2900;  // level 11
const today = new Date().toISOString().slice(0, 10);
const token = saveToken({
  profileId: `lv-${Date.now()}`, name: 'Elder', avatar: 'pimples', xp: XP, currency: 500,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);
const room = await new Client('ws://localhost:2575').joinOrCreate('world', { profile: token });
let state = null;
room.onMessage('*', () => {});
room.onMessage('state', (s) => { state = { ...s, plots: s.plots ?? state?.plots }; });  // plots come only when changed
room.onMessage('init', (s) => { state = s; });
room.send('sync');
await sleep(300);
room.send('claimPlot', { plotX: 4, plotY: 4 });
await sleep(150);
for (let slot = 0; slot < 9; slot++) room.send('plant', { plotKey: '4,4', slot });
await sleep(300);
const slots = state.plots['4,4'].slots;
check('every hole open at a high level', slots.every(Boolean));
const level = levelFor(XP);
const thumb = greenThumb(level);
const ok = slots.every((c) => Math.abs((c.readyAt - c.plantedAt) - RARITIES[CHARACTER_BY_ID[c.characterId].rarity].growMs * 0.01 * (1 - thumb)) < 2);
check(`level ${level} crops grow ${Math.round(thumb * 100)}% faster`, thumb > 0 && ok);
await room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
