// Things a player could get wrong (or exploit) around saves and reconnects.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2577';
const today = new Date().toISOString().slice(0, 10);

async function join(name, profile) {
  const room = await new Client(URL).joinOrCreate('world', { name, profile });
  const p = { room, saves: [], rewards: [], left: null };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.onMessage('bossReward', (r) => p.rewards.push(r));
  room.onLeave((code) => { p.left = code; });
  room.send('sync');
  await sleep(300);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}
const profile = (id, extra = {}) => saveToken({
  profileId: id, name: id, avatar: 'pimples', xp: 0, currency: 100, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null, ...extra,
}, null, null);

// ---- an old save can't undo a gift
const giverToken = profile(`giver-${Date.now()}`, { collection: { pimples: 1, snoot: 2 } });
const giver = await join('Giver', giverToken);
const taker = await join('Taker', profile(`taker-${Date.now()}`));
giver.room.send('gift', { to: taker.room.sessionId, characterId: 'snoot' });
await sleep(300);
check('gift given', giver.me.collection.snoot === 1 && taker.me.collection.snoot === 1);
await giver.room.leave(true);
await sleep(200);
const replay = await join('Giver', giverToken);  // the save from before the gift
check('coming back with an older save gets the newer state', replay.me.collection.snoot === 1, `snoot ×${replay.me.collection.snoot}`);
await replay.room.leave(true);

// ---- squeezes are remembered by save, across leaving and coming back
const owner = await join('Owner', profile(`owner-${Date.now()}`));
owner.room.send('claimPlot', { plotX: 12, plotY: 12 });
await sleep(150);
owner.room.send('plant', { plotKey: '12,12', slot: 4 });
await sleep(250);
const helperToken = profile(`helper-${Date.now()}`);
let helper = await join('Helper', helperToken);
const at = { x: 12 * 144 + 72, y: 12 * 144 + 79 + 40 };
helper.room.send('move', at);
await sleep(1500);
helper.room.send('tend', { plotKey: '12,12', slot: 4 });
await sleep(300);
check('first squeeze counts', owner.state.plots['12,12'].slots[4].tendedBy.length === 1);
await helper.room.leave(true);
await sleep(200);
helper = await join('Helper', helperToken);
helper.room.send('move', at);
await sleep(1500);
helper.room.send('tend', { plotKey: '12,12', slot: 4 });
await sleep(300);
check('no second squeeze after leaving and coming back', owner.state.plots['12,12'].slots[4].tendedBy.length === 1);
await helper.room.leave(true);

// ---- boss damage survives a reload (takeover)
let waited = 0;
while (!owner.state.boss && waited < 80) { await sleep(250); waited++; }
const boss = owner.state.boss;
check('a boss shows up', Boolean(boss));
if (boss) {
  owner.room.send('move', { x: boss.x, y: boss.y + 40 });
  await sleep(1500);
  for (let i = 0; i < 8; i++) { owner.room.send('hitBoss'); await sleep(130); }
  await sleep(2200);
  const ownerToken = owner.saves.at(-1);
  const reloaded = await join('', ownerToken);  // takes over the live player
  await sleep(200);
  for (let i = 0; i < 200 && reloaded.state.boss; i++) { reloaded.room.send('hitBoss'); await sleep(120); }
  await sleep(400);
  const reward = reloaded.rewards[0];
  // The only hitter dealt all of its health; if the hits before the reload were
  // dropped, the reward would fall at least 6 short (8 hits, crits overshoot by 2 at most).
  check('hits from before the reload still count', reward && reward.damage >= boss.maxHp && reward.top, `${reward?.damage} of ${boss.maxHp}`);
  await reloaded.room.leave(true);
}
await taker.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
