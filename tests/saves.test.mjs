import { Client } from 'colyseus.js';
import { checkIn, dayOf } from '../packages/server/src/game/daily.js';
import { advanceDaily, dealDaily, restoreDaily } from '../packages/server/src/game/quests.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2569';

async function join(name, profile) {
  const room = await new Client(URL).joinOrCreate('world', { name, profile });
  const p = { room, notices: [], saves: [], leftWith: null };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('notice', (n) => p.notices.push(n));
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.onLeave((code) => { p.leftWith = code; });
  room.send('sync');
  await sleep(300);
  p.token = () => p.saves.at(-1);
  return p;
}

// ---- daily streak rules
const d = { last: null, streak: 0 };
const t0 = Date.UTC(2026, 9, 20, 12);
const first = checkIn(d, t0);
check('first visit starts a streak with day 1', first?.streak === 1 && first.reward.scraps === 15);
check('same day pays nothing more', checkIn(d, t0 + 3_600_000) === null);
check('next day continues the streak', checkIn(d, t0 + 86_400_000)?.streak === 2);
check('day 3 pays a Boil Seed', checkIn(d, t0 + 2 * 86_400_000)?.reward.boil === 1);
check('a missed day starts over', checkIn(d, t0 + 5 * 86_400_000)?.streak === 1);
const week = { last: null, streak: 0 };
let r;
for (let i = 0; i < 8; i++) r = checkIn(week, t0 + i * 86_400_000);
check('after day 7 the rewards loop', r.streak === 8 && r.reward.scraps === 15);

// ---- daily quest rules
const dq = {};
dealDaily(dq, '2026-10-20');
const { kind, target } = dq.dailyQuest;
check('daily quest dealt for the day', dq.dailyQuest.day === '2026-10-20' && dq.dailyQuest.progress === 0 && target > 0);
check('other kinds do not advance it', !advanceDaily(dq, kind === 'plant' ? 'harvest' : 'plant') && dq.dailyQuest.progress === 0);
let finished = false;
for (let i = 0; i < target; i++) finished = advanceDaily(dq, kind);
check('finishing it reports done exactly once', finished && dq.dailyQuest.done && !advanceDaily(dq, kind));
check('yesterday\'s daily quest is not restored', restoreDaily(dq.dailyQuest, '2026-10-21') === null && restoreDaily(dq.dailyQuest, '2026-10-20')?.done === true);

// ---- a new player gets a save and the day's reward
const a = await join('Alice');
check('new player gets a save on sync', typeof a.token() === 'string' && a.token().includes('.'));
check('daily quest dealt on joining', a.me.dailyQuest?.day === dayOf(Date.now()) && !a.me.dailyQuest.done);
check('first daily reward paid and announced', a.me.currency === 35 && a.notices.some((n) => n.kind === 'daily' && n.streak === 1));
a.room.send('claimPlot', { plotX: 5, plotY: 5 });
await sleep(150);
a.room.send('plant', { plotKey: '5,5', slot: 4 });
await sleep(2300);
const crop = a.state.plots['5,5'].slots[4];
const saved = a.token();
const palId = a.state.players[a.room.sessionId].pid;
check('save updated after planting', saved !== a.saves[0]);
const collection = JSON.stringify(a.me.collection);
await a.room.leave(true);
await sleep(900);  // crop ripens while away (GROW_SCALE=0.01)

// ---- coming back
const a2 = await join('Alice Again', saved);
const pub = a2.state.players[a2.room.sessionId];
check('restored: scraps, album, no second daily reward', a2.me.currency === 30 && JSON.stringify(a2.me.collection) === collection && !a2.notices.some((n) => n.kind === 'daily'));
check('restored: same daily quest', JSON.stringify(a2.me.dailyQuest) === JSON.stringify(a.me.dailyQuest));
check('restored: plot back in the same spot with its crop', a2.state.plots['5,5']?.ownerId === a2.room.sessionId && a2.state.plots['5,5'].slots[4]?.characterId === crop.characterId);
check('new name applies to player and plot', pub.name === 'Alice Again' && a2.state.plots['5,5'].ownerName === 'Alice Again');
check('same public id across visits, and not the save id', pub.pid === palId && typeof pub.pid === 'string' && !saved.includes(pub.pid) && a2.me.profileId !== pub.pid);
check('standing at the plot', Math.abs(pub.x - (5 * 144 + 72)) < 1 && Math.abs(pub.y - (6 * 144 + 26)) < 1);
const welcome = a2.notices.find((n) => n.kind === 'welcome');
const ripeNow = Date.now() >= crop.readyAt ? 1 : 0;
check('welcome back notice counts ripe and growing crops', welcome?.ripe === ripeNow && welcome.growing === 1 - ripeNow, JSON.stringify(welcome));
await sleep(Math.max(0, crop.readyAt - Date.now() + 50));
a2.room.send('harvest', { plotKey: '5,5', slot: 4 });
await sleep(300);
check('restored crop can be harvested', a2.state.plots['5,5'].slots[4] === null && a2.me.currency > 30);

// ---- tampering
const [body, sig] = a2.token().split('.');
const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
forged.currency = 999999;
const b = await join('Mallory', `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`);
check('edited save is rejected (fresh start)', b.me.currency === 35 && b.me.currency !== 999999);
await b.room.leave(true);

// ---- the same save opened twice: the newest connection takes over
await sleep(2200);
const token = a2.token();
const a3 = await join('', token);
await sleep(300);
check('old connection closed as replaced', a2.leftWith === 4001);
const named = Object.values(a3.state.players).filter((p) => p.name === 'Alice Again');
check('one player, not two, and the plot followed', named.length === 1 && a3.state.plots['5,5']?.ownerId === a3.room.sessionId);
check('takeover keeps live state (not the older save)', a3.me.currency === a2.me.currency);

// ---- dropped, then back as a new connection (e.g. a reload) while held
a3.room.connection.close();
await sleep(300);
const a4 = await join('', a3.token());
await sleep(300);
const all = Object.values(a4.state.players).filter((p) => p.name === 'Alice Again');
check('held player taken over, not duplicated', all.length === 1 && !all[0].away && a4.state.plots['5,5']?.ownerId === a4.room.sessionId);
await a4.room.leave(true);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
