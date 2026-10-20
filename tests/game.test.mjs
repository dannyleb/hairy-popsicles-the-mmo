import { Client } from 'colyseus.js';
import { CHARACTER_BY_ID } from '@hptm/shared';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const PLOT = 144, TILE = 48;

async function join(name, url = 'ws://localhost:2567') {
  const room = await new Client(url).joinOrCreate('world', { name });
  const p = { room, state: null, me: null, events: {} };
  room.onMessage('*', () => {});
  const record = (type) => room.onMessage(type, (m) => { (p.events[type] ??= []).push(m); });
  ['harvested', 'levelUp', 'questDone', 'chat', 'chatLog', 'emote', 'announce', 'tend', 'tended', 'tendDone', 'bossHp', 'bossPopped', 'bossGone', 'bossReward'].forEach(record);
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = s; });
  room.onMessage('me', (m) => { p.me = m; });
  await sleep(300);
  p.pub = () => p.state.players[room.sessionId];
  p.ev = (type) => p.events[type] ?? [];
  return p;
}
const holeCenter = (plotX, plotY, slot) => ({ x: plotX * PLOT + (slot % 3) * TILE + 24, y: plotY * PLOT + Math.floor(slot / 3) * TILE + 24 });

// ---- joining, privacy, starting quests
const a = await join('  Alice  ');
const pubA = a.pub();
check('name trimmed', pubA.name === 'Alice');
check('public player has no private fields', !('currency' in pubA) && !('collection' in pubA) && !('quests' in pubA));
check('public player has level, album, best', pubA.level === 1 && pubA.album === 1 && typeof pubA.best === 'string');
// 20 to start, plus the first day's login reward.
check('private data: 35 scraps, 1 character', a.me.currency === 35 && Object.keys(a.me.collection).length === 1);
check('3 quests, distinct kinds', a.me.quests.length === 3 && new Set(a.me.quests.map((q) => q.kind)).size === 3);
check('no squeeze quest while alone', !a.me.quests.some((q) => q.kind === 'tend'));
console.log('  quests:', a.me.quests.map((q) => q.text).join(' | '));

a.room.send('move', { x: -100, y: 1e9 });
await sleep(200);
check('move clamped to the world', a.pub().x === 0 && a.pub().y === 2880);

// ---- holes and seeds
a.room.send('claimPlot', { plotX: 9, plotY: 9 });
await sleep(200);
const keyA = '9,9';
a.room.send('plant', { plotKey: keyA, slot: 0 });                  // corner: locked at level 1
a.room.send('plant', { plotKey: keyA, slot: 4, seed: 'pus' });     // pus seeds need level 3
a.room.send('plant', { plotKey: keyA, slot: 4, seed: 'boil' });    // no boil seeds yet
a.room.send('plant', { plotKey: keyA, slot: 4, seed: '__proto__' });
await sleep(250);
check('locked hole, locked seed, missing seed all refused', a.state.plots[keyA].slots.every((s) => s === null) && a.me.currency === 35);
for (const slot of [4, 3, 5]) a.room.send('plant', { plotKey: keyA, slot });
await sleep(250);
check('3 open holes planted with pimple seeds', [4, 3, 5].every((s) => a.state.plots[keyA].slots[s]?.seed === 'pimple') && a.me.currency === 20);
check('planting gives xp', a.me.xp >= 6, `xp=${a.me.xp}`);

// ---- harvest loop until level 2 (opens hole 1)
let cycles = 0;
while (a.me.level < 2 && cycles < 12) {
  await sleep(4900);  // longest grow (legendary) is 4.8s at GROW_SCALE=0.01
  for (const slot of [4, 3, 5]) a.room.send('harvest', { plotKey: keyA, slot });
  await sleep(250);
  for (const slot of [4, 3, 5]) if (a.me.currency >= 5) a.room.send('plant', { plotKey: keyA, slot });
  await sleep(250);
  cycles++;
}
check('reached level 2 by harvesting', a.me.level >= 2 && a.ev('levelUp').length >= 1, `level=${a.me.level} after ${cycles} cycles`);
check('harvest events carry xp', a.ev('harvested').length >= 3 && a.ev('harvested').every((h) => h.xp > 0));
check('public level matches', a.pub().level === a.me.level);
a.room.send('plant', { plotKey: keyA, slot: 1 });
await sleep(250);
check('hole 1 opens at level 2', a.state.plots[keyA].slots[1] !== null || a.me.currency < 5);
check('quests still 3 and distinct', a.me.quests.length === 3 && new Set(a.me.quests.map((q) => q.kind)).size === 3);
console.log(`  quests completed so far: ${a.ev('questDone').length}`, a.ev('questDone').map((q) => q.text).join(' | '));

// ---- chat and emotes
const b = await join('Bob');
check('chat log sent on join', Array.isArray(b.ev('chatLog')[0]));
a.room.send('chat', { text: '   hello    there   ' + 'x'.repeat(200) });
a.room.send('chat', { text: 'too soon' });
await sleep(300);
const heard = b.ev('chat');
check('chat delivered, cleaned and capped', heard.length === 1 && heard[0].text.startsWith('hello there x') && heard[0].text.length === 80 && heard[0].name === 'Alice');
check('second chat within cooldown dropped', !heard.some((c) => c.text === 'too soon'));
a.room.send('emote', { emote: 'drool' });
a.room.send('emote', { emote: 'nope' });
await sleep(250);
check('emote broadcast, unknown emote ignored', b.ev('emote').length === 1 && b.ev('emote')[0].emote === 'drool');

// ---- squeezing a neighbor's crop (real grow timers, so crops stay growing)
{
  const SLOW = 'ws://localhost:2568';
  const sa = await join('Sal', SLOW);
  const sb = await join('Bea', SLOW);
  sb.room.send('claimPlot', { plotX: 11, plotY: 9 });
  sa.room.send('claimPlot', { plotX: 9, plotY: 9 });
  await sleep(250);
  const key = '11,9';
  sb.room.send('plant', { plotKey: key, slot: 4 });
  await sleep(250);
  const before = sb.state.plots[key].slots[4].readyAt;
  sa.room.send('move', { x: 100, y: 100 });
  sa.room.send('tend', { plotKey: key, slot: 4 });                  // too far away
  await sleep(200);
  check('squeeze refused from too far', sb.state.plots[key].slots[4].readyAt === before && !sa.ev('tendDone').length);
  const spot = holeCenter(11, 9, 4);
  sa.room.send('move', { x: spot.x, y: spot.y + 60 });
  sa.room.send('tend', { plotKey: key, slot: 4 });                  // still walking over
  await sleep(250);
  check('squeeze refused until you get there', sb.state.plots[key].slots[4].readyAt === before);
  await sleep(1300);
  sa.room.send('tend', { plotKey: key, slot: 4 });
  await sleep(250);
  const after = sb.state.plots[key].slots[4];
  check('squeeze shortens the grow time', after && after.readyAt < before && after.tendedBy.includes(sa.me.profileId), `${Math.round((before - after?.readyAt) / 1000)}s off`);
  check('owner told, squeezer paid', sb.ev('tended').length === 1 && sb.ev('tended')[0].by === 'Sal' && sa.ev('tendDone').length === 1 && sa.ev('tendDone')[0].scraps > 0);
  check('everyone sees the squeeze', sb.ev('tend').length === 1 && sa.ev('tend').length === 1);
  sa.room.send('tend', { plotKey: key, slot: 4 });
  sb.room.send('tend', { plotKey: key, slot: 4 });
  await sleep(250);
  check('no double squeeze, no squeezing your own', sb.state.plots[key].slots[4]?.tendedBy.length === 1);
  sb.room.leave();
  await sleep(250);
  check('squeeze quests dropped when the neighbor leaves', !sa.me.quests.some((q) => q.kind === 'tend') && sa.me.quests.length === 3);
  sa.room.leave();
}

// ---- the boss
let waited = 0;
while (!a.state.boss && waited < 60) { await sleep(500); waited++; }
const boss = a.state.boss;
check('a boss spawns', Boolean(boss), boss ? `hp ${boss.hp}/${boss.maxHp}` : '');
if (boss) {
  a.room.send('hitBoss');
  await sleep(150);
  check('hit from far away does nothing', !a.ev('bossHp').length || a.ev('bossHp').at(-1).hp === boss.maxHp);
  a.room.send('move', { x: boss.x, y: boss.y + 40 });
  b.room.send('move', { x: boss.x + 30, y: boss.y + 40 });
  await sleep(150);
  for (let i = 0; i < 200 && !a.ev('bossPopped').length && !a.ev('bossGone').length; i++) {
    a.room.send('hitBoss');
    if (i % 2) b.room.send('hitBoss');
    await sleep(60);
  }
  await sleep(300);
  check('boss hp updates arrive', a.ev('bossHp').length > 3);
  check('boss pops', a.ev('bossPopped').length === 1 && !a.state.boss);
  const rewardA = a.ev('bossReward')[0];
  check('both hitters rewarded, top hitter gets 2 seeds', rewardA && b.ev('bossReward')[0] && (rewardA.top ? rewardA.seeds === 2 : rewardA.seeds === 1));
  // The daily quest can finish along the way and pays a Boil Seed too.
  const dailySeeds = () => a.ev('questDone').filter((q) => q.daily).reduce((n, q) => n + (q.boil ?? 0), 0);
  check('boil seeds land in the inventory', a.me.inventory.boil === rewardA?.seeds + dailySeeds());
  check('pop announced', a.ev('announce').some((m) => m.kind === 'boss' && m.text.includes('burst')));
  if (rewardA?.seeds) {
    a.room.send('harvest', { plotKey: keyA, slot: 4 });            // crops are long ripe by now
    await sleep(250);
    a.room.send('plant', { plotKey: keyA, slot: 4, seed: 'boil' });
    await sleep(250);
    const crop = a.state.plots[keyA].slots[4];
    check('boil seed plants a rare or legendary', crop?.seed === 'boil' && ['rare', 'legendary'].includes(CHARACTER_BY_ID[crop.characterId].rarity) && a.me.inventory.boil === rewardA.seeds + dailySeeds() - 1, crop ? crop.characterId : 'nothing planted');
  }
}

// ---- blood moon
waited = 0;
while (!a.state.bloodMoon && waited < 40) { await sleep(500); waited++; }
check('blood moon rises and is announced', Boolean(a.state.bloodMoon) && a.ev('announce').some((m) => m.kind === 'bloodMoon'));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
