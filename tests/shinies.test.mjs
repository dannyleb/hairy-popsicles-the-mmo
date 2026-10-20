import { Client } from 'colyseus.js';
import { RARITIES, CHARACTER_BY_ID, wearBonus } from '@hptm/shared';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2570';

async function join(name, profile) {
  const room = await new Client(URL).joinOrCreate('world', { name, profile });
  const p = { room, harvested: [], announce: [], saves: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = s; });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('harvested', (h) => p.harvested.push(h));
  room.onMessage('announce', (a) => p.announce.push(a));
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.send('sync');
  await sleep(300);
  return p;
}

const a = await join('Goldie');
a.room.send('claimPlot', { plotX: 2, plotY: 2 });
await sleep(150);
a.room.send('plant', { plotKey: '2,2', slot: 4 });
await sleep(200);
const crop = a.state.plots['2,2'].slots[4];
check('crop rolled shiny (boosted odds)', crop.shiny === true);
await sleep(Math.max(0, crop.readyAt - Date.now() + 100));
a.room.send('harvest', { plotKey: '2,2', slot: 4 });
await sleep(300);
const h = a.harvested[0];
check('harvest says shiny and pays triple', h?.shiny === true && h.scraps === RARITIES[CHARACTER_BY_ID[crop.characterId].rarity].scraps * 3);
check('shiny recorded privately', a.me.shinies[crop.characterId] === 1);
check('shiny announced to the world', a.announce.some((m) => m.kind === 'shiny' && m.text.includes('shiny')));
a.room.send('setAvatar', { characterId: crop.characterId });
await sleep(300);
const pub = a.state.players[a.room.sessionId];
check('playing as it shows the sheen publicly', pub.shiny === true && pub.shinies === 1);

// Playing as it now boosts what you grow.
a.room.send('plant', { plotKey: '2,2', slot: 4 });
await sleep(200);
const next = a.state.plots['2,2'].slots[4];
const bonus = wearBonus(crop.characterId, a.me.collection[crop.characterId]);
const plainMs = RARITIES[CHARACTER_BY_ID[next.characterId].rarity].growMs * 0.01;
check('worn character speeds growing by its bonus', Math.abs((next.readyAt - next.plantedAt) - plainMs * (1 - bonus.grow)) < 2, `${CHARACTER_BY_ID[crop.characterId].rarity}: grow -${bonus.grow * 100}%`);
await sleep(Math.max(0, next.readyAt - Date.now() + 60));
a.room.send('harvest', { plotKey: '2,2', slot: 4 });
await sleep(250);
const paid = a.harvested.at(-1);
const expected = Math.round(RARITIES[CHARACTER_BY_ID[next.characterId].rarity].scraps * 3 * (1 + wearBonus(crop.characterId, a.me.collection[crop.characterId]).scraps));
check('worn character boosts scraps by its bonus', paid.scraps === expected, `${paid.scraps} vs ${expected}`);

// Grow three of one character for a star: plant until a character repeats 3 times.
const counts = {};
let starUp = null;
for (let round = 0; round < 40 && !starUp; round++) {
  if (a.me.currency < 5) break;
  a.room.send('plant', { plotKey: '2,2', slot: 4 });
  await sleep(150);
  const c = a.state.plots['2,2'].slots[4];
  if (!c) continue;
  await sleep(Math.max(0, c.readyAt - Date.now() + 60));
  a.room.send('harvest', { plotKey: '2,2', slot: 4 });
  await sleep(200);
  starUp = a.harvested.find((x) => x.starUp);
}
check('third copy earns a star', starUp?.starUp === 1 && a.me.collection[starUp.characterId] === 3, starUp ? starUp.characterId : 'none in 40 rounds');

// Shinies survive a save and restore.
await sleep(2200);
const token = a.saves.at(-1);
await a.room.leave(true);
const b = await join('', token);
check('shinies restored from the save', JSON.stringify(b.me.shinies) === JSON.stringify(a.me.shinies));
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
