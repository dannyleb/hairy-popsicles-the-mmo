// Under the Skin (deep.js) and Crust: from level 15 the Navel goes down to a
// second layer of the world with its own plots and seeds; crops there grow
// slower but pay double XP, and a Legendary comes up rooted (a neighbor can
// loosen it, or it works loose by itself). Past level 25, XP goes into Crust.
import { check, finish, sleep, waitFor } from './lib.mjs';

process.env.PROFILE_SECRET = 'test';
const { readToken, saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { CHARACTER_BY_ID, DEEP, HOLE_ORDER, PLACES, RARITIES, XP, greenThumb } = await import('@hptm/shared');

const URL = 'ws://localhost:2598';
const GROW_SCALE = 0.02;
const today = new Date().toISOString().slice(0, 10);
const navel = PLACES.surface.landmarks.navel;
const rarityOf = (crop) => CHARACTER_BY_ID[crop.characterId].rarity;

const saveOf = (name, xp) => saveToken({
  profileId: `deep-${name}-${Date.now()}`, name, avatar: 'pimples', xp, currency: 5000,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0, fertilizer: 0, teeth: 0 }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null, rows: [], colors: [], nameColor: null,
  inviteLog: { day: null, count: 0, paid: [] },
}, null, null);

const HEARD = ['harvested', 'crustUp', 'loosened', 'loosenDone', 'chat', 'tend', 'tendDone', 'titleEarned'];
async function join(profile) {
  const room = await new Client(URL).joinOrCreate('world', { profile });
  const p = { room, state: null, me: null, inits: 0, token: null, got: {} };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; p.inits++; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('save', ({ token }) => { p.token = token; });
  for (const type of HEARD) room.onMessage(type, (m) => (p.got[type] ??= []).push(m));
  room.send('sync');
  await sleep(400);
  p.id = room.sessionId;
  return p;
}
const heard = (p, type) => p.got[type] ?? [];
const walk = async (p, x, y) => {
  p.room.send('move', { x, y });
  await sleep(1500);
};
async function climbDown(p) {
  await walk(p, navel.x, navel.y + 120);
  const before = p.inits;
  p.room.send('travel', { to: 'deep' });
  return waitFor(() => p.inits > before && p.state.layer === 'deep', 2000);
}

const shallow = await join(saveOf('Shallow', 5700));  // level 14
const digger = await join(saveOf('Digger', 16500));   // level 20
const helper = await join(saveOf('Helper', 7000));    // level 15

// ---- getting down there
await walk(shallow, navel.x, navel.y + 120);
const shallowInits = shallow.inits;
shallow.room.send('travel', { to: 'deep' });
await sleep(500);
check('below level 15 the Navel goes nowhere', shallow.me.layer === 'surface' && shallow.inits === shallowInits);
await walk(digger, 300, 300);
digger.room.send('travel', { to: 'deep' });
await sleep(500);
check("from across the world it doesn't either", digger.me.layer === 'surface');
check('at level 15+, standing at the Navel, down you go', await climbDown(digger));
check('...on the deep side, by the Knot', digger.me.layer === 'deep'
  && Math.hypot(digger.state.players[digger.id].x - PLACES.deep.landmarks.knot.x, digger.state.players[digger.id].y - PLACES.deep.landmarks.knot.y) < 260);
check('...and that earns Navel Diver', heard(digger, 'titleEarned').some((t) => t.id === 'navel-diver'));
check('no world events, strays or statue down there', digger.state.event === null && digger.state.boss === null && digger.state.strays.length === 0 && digger.state.statue === null);
check('only those Under the Skin are seen there', Object.keys(digger.state.players).join() === digger.id);
await sleep(300);
check('up on the skin, they are gone from view (and counted as elsewhere)', !shallow.state.players[digger.id] && shallow.state.elsewhere === 1);
digger.room.send('travel', { to: 'surface' });
await sleep(400);
check("can't bounce straight back up", digger.me.layer === 'deep');

// ---- a plot down there
digger.room.send('claimPlot', { plotX: 9, plotY: 9 });
await sleep(200);
check("nobody farms the Knot", !digger.state.plots['9,9']);
digger.room.send('claimPlot', { plotX: 3, plotY: 3 });
await waitFor(() => digger.state.plots['3,3'], 1000);
check('a plot of their own Under the Skin', digger.state.plots['3,3']?.ownerId === digger.id);
check("...that isn't on the skin", !shallow.state.plots['3,3']);
const plot = () => digger.state.plots['3,3'];
digger.room.send('plant', { plotKey: '3,3', slot: HOLE_ORDER[0], seed: 'pimple' });
await sleep(200);
check("skin seeds don't grow down here", !plot().slots[HOLE_ORDER[0]]);
digger.room.send('plant', { plotKey: '3,3', slot: HOLE_ORDER[8], seed: 'vein' });
await sleep(200);
check('at level 20, 8 of the 9 holes are open down here', !plot().slots[HOLE_ORDER[8]]);
digger.room.send('plant', { plotKey: '3,3', slot: HOLE_ORDER[0], seed: 'vein' });
for (const slot of HOLE_ORDER.slice(1, 8)) digger.room.send('plant', { plotKey: '3,3', slot, seed: 'marrow' });
await sleep(400);
const crops = plot().slots.filter(Boolean);
check('vein and marrow seeds grow here', crops.length === 8, `${crops.length} planted`);
const slow = crops.every((c) => Math.abs((c.readyAt - c.plantedAt) - RARITIES[rarityOf(c)].growMs * GROW_SCALE * (1 - greenThumb(20)) * DEEP.growSlower) < 3);
check('...and grow half as slow again', slow);
check('Legendaries (and only they) come up rooted', crops.every((c) => Boolean(c.rooted) === (rarityOf(c) === 'legendary')));

// ---- a neighbor comes down
check('a neighbor climbs down too', await climbDown(helper));
await walk(helper, 3 * 144 + 72, 3 * 144 + 110);
await sleep(300);
check('they see each other down there', Boolean(digger.state.players[helper.id]) && Boolean(helper.state.players[digger.id]));
helper.room.send('chat', { text: 'hello from below' });
await sleep(400);
check('chat still reaches the skin', heard(shallow, 'chat').some((l) => l.text === 'hello from below'));
const growing = HOLE_ORDER.find((s) => plot().slots[s] && plot().slots[s].readyAt > Date.now() + 2000);
helper.room.send('tend', { plotKey: '3,3', slot: growing });
await waitFor(() => heard(helper, 'tendDone').length, 1500);
check('neighbors squeeze crops down here too', heard(helper, 'tendDone').length === 1);
check("...and the skin doesn't see the squelch", heard(shallow, 'tend').length === 0 && heard(digger, 'tend').length >= 1);

// ---- harvest: double XP, half as many scraps again
const firstRipe = () => HOLE_ORDER.find((s) => plot().slots[s] && !plot().slots[s].rooted);
const plain = firstRipe();
if (plain !== undefined) {
  const crop = plot().slots[plain];
  await waitFor(() => Date.now() > crop.readyAt + 150, 15_000);
  digger.room.send('harvest', { plotKey: '3,3', slot: plain });
  await waitFor(() => heard(digger, 'harvested').length, 1500);
  const got = heard(digger, 'harvested')[0];
  check('a harvest down here pays double XP', got?.xp === XP.harvest[rarityOf(crop)] * DEEP.xp, JSON.stringify(got));
  check('...and half as many scraps again', got && got.scraps === Math.round(RARITIES[rarityOf(crop)].scraps * (got.shiny ? 3 : 1) * DEEP.scraps));
}

// ---- rooted: loosened by a neighbor, or by itself after a while
const rooted = () => HOLE_ORDER.filter((s) => plot().slots[s]?.rooted).sort((a, b) => plot().slots[a].readyAt - plot().slots[b].readyAt);
const [first, second] = rooted();
check('a rooted crop to pull', first !== undefined);
if (first !== undefined) {
  const crop = plot().slots[first];
  await waitFor(() => Date.now() > crop.readyAt + 150, 20_000);
  digger.room.send('harvest', { plotKey: '3,3', slot: first });
  await sleep(300);
  check("ripe, but rooted: the owner can't pull it alone", Boolean(plot().slots[first]));
  helper.room.send('loosen', { plotKey: '3,3', slot: first });
  await waitFor(() => heard(helper, 'loosenDone').length, 1500);
  check('a neighbor loosens it, and is paid for the hand', heard(helper, 'loosenDone')[0]?.scraps === DEEP.loosen.scraps && heard(helper, 'loosenDone')[0]?.xp === DEEP.loosen.xp);
  check('...and the owner hears who helped', heard(digger, 'loosened')[0]?.by === 'Helper');
  const harvests = heard(digger, 'harvested').length;
  digger.room.send('harvest', { plotKey: '3,3', slot: first });
  check('then it comes up', await waitFor(() => heard(digger, 'harvested').length > harvests, 1500) && !plot().slots[first]);
}
if (second !== undefined) {
  const crop = plot().slots[second];
  await waitFor(() => Date.now() > crop.readyAt + DEEP.rootMs * GROW_SCALE + 300, 20_000);
  const harvests = heard(digger, 'harvested').length;
  digger.room.send('harvest', { plotKey: '3,3', slot: second });
  check('left long enough, a rooted crop works loose by itself', await waitFor(() => heard(digger, 'harvested').length > harvests, 1500));
}

// ---- the deep plot is in the save, and waits for them
await waitFor(() => readToken(digger.token)?.deepPlot, 3000);
check('the save carries the plot Under the Skin', readToken(digger.token)?.deepPlot?.key === '3,3');
const token = digger.token;
await digger.room.leave(true);
await sleep(400);
check('a departed player\'s deep plot stays, for neighbors to squeeze', helper.state.plots['3,3']?.away === true);
const back = await join(token);
check('everyone comes back up on the skin', back.state.layer === 'surface' && back.me.layer === 'surface');
await climbDown(back);
check('...and finds their plot down there as they left it', back.state.plots['3,3']?.ownerId === back.id && back.state.plots['3,3'].slots.some(Boolean));
await sleep(DEEP.travelMs);
await walk(back, PLACES.deep.landmarks.knot.x, PLACES.deep.landmarks.knot.y + 120);
const inits = back.inits;
back.room.send('travel', { to: 'surface' });
check('back up through the Knot', await waitFor(() => back.inits > inits && back.state.layer === 'surface', 2000));

// ---- Crust: past level 25, XP keeps counting
const crusty = await join(saveOf('Crusty', 40990));  // level 25, a few XP short of Crust 2
check('level 25 is the top, and XP past it is Crust', crusty.me.level === 25 && crusty.me.crust === 1);
crusty.room.send('claimPlot', { plotX: 16, plotY: 16 });
await sleep(200);
crusty.room.send('plant', { plotKey: '16,16', slot: HOLE_ORDER[0], seed: 'pimple' });
await sleep(200);
const crustCrop = crusty.state.plots['16,16']?.slots[HOLE_ORDER[0]];
await waitFor(() => crustCrop && Date.now() > crustCrop.readyAt + 150, 15_000);
crusty.room.send('harvest', { plotKey: '16,16', slot: HOLE_ORDER[0] });
check('another layer of Crust', await waitFor(() => heard(crusty, 'crustUp').some((c) => c.crust === 2), 2000) && crusty.me.crust === 2);
await sleep(300);
check('...that everyone sees', shallow.state.players[crusty.id]?.crust === 2);

for (const p of [shallow, helper, back, crusty]) await p.room.leave(true);
finish();
