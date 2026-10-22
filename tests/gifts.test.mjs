import { check, finish, sleep } from './lib.mjs';
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const URL = 'ws://localhost:2574';
async function join(name, profile) {
  const room = await new Client(URL).joinOrCreate('world', { name, profile });
  const p = { room, gifted: [], gave: [], announce: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('gifted', (g) => p.gifted.push(g));
  room.onMessage('gave', (g) => p.gave.push(g));
  room.onMessage('announce', (a) => p.announce.push(a));
  room.send('sync');
  await sleep(300);
  return p;
}
const giver = await join('Giver', saveToken({
  profileId: `giver-${Date.now()}`, name: 'Giver', avatar: 'droopy', xp: 0, currency: 20,
  collection: { droopy: 3, toad: 1 }, shinies: { droopy: 3 }, inventory: { boil: 0 }, quests: [],
  daily: { last: null, streak: 0 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null));
const taker = await join('Taker');
const had = taker.me.collection.droopy ?? 0;
giver.room.send('gift', { to: taker.room.sessionId, characterId: 'droopy' });
await sleep(300);
check('gift arrives with who sent it', taker.gifted[0]?.from === 'Giver' && taker.gifted[0].characterId === 'droopy' && taker.gifted[0].isNew === (had === 0));
check('copies move from giver to taker', giver.me.collection.droopy === 2 && taker.me.collection.droopy === had + 1);
check('giver keeps no more shinies than copies', giver.me.shinies.droopy === 2);
check('giver told, world told', giver.gave[0]?.to === 'Taker' && taker.announce.some((a) => a.kind === 'gift'));
check('gift counted toward Generous', giver.me.stats.gifts === 1);
giver.room.send('gift', { to: taker.room.sessionId, characterId: 'droopy' });
await sleep(300);
check('a second gift right away is refused (cooldown)', giver.me.collection.droopy === 2);
await sleep(10_200);
giver.room.send('gift', { to: taker.room.sessionId, characterId: 'toad' });
giver.room.send('gift', { to: giver.room.sessionId, characterId: 'droopy' });
giver.room.send('gift', { to: 'nobody', characterId: 'droopy' });
await sleep(300);
check('last copy, self and strangers refused', giver.me.collection.toad === 1 && giver.me.collection.droopy === 2 && taker.gifted.length === 1);
await giver.room.leave(true);
await taker.room.leave(true);
finish();
