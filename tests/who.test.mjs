// "Who's around" (/players): who's here with how long since they did anything,
// who's been by lately (players from level 2 only), nothing private, Appear
// offline, and a limit per address.
import { check, finish, sleep } from './lib.mjs';

process.env.PROFILE_SECRET = 'test';
const { inviteCode, saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { levelFor } = await import('@hptm/shared');

const URL = 'ws://localhost:2596';
const HTTP = 'http://localhost:2596';
const look = async () => {
  const res = await fetch(`${HTTP}/players`);
  return { status: res.status, ...(await res.json()) };
};

// A save at some level, as the server would have signed it.
const saveAt = (name, xp) => saveToken({
  profileId: `who-${name}`, name, avatar: 'droopy', xp, currency: 50, collection: { droopy: 1 }, shinies: {},
  inventory: { boil: 0, fertilizer: 0, teeth: 0 }, quests: [], daily: { last: null, streak: 0 }, dailyQuest: null,
  stats: {}, titles: [], title: null, rows: [], colors: [], nameColor: null, inviteLog: { day: null, count: 0, paid: [] }, startedAt: Date.now(),
}, null, null);

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, state: null };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.send('sync');
  await sleep(400);
  p.pid = () => p.state.players[room.sessionId].pid;
  return p;
}

// ---- nobody yet
let seen = await look();
check('answers before anyone has joined', seen.status === 200 && Array.isArray(seen.here) && seen.here.length === 0 && Array.isArray(seen.left));

// ---- who's here, and how long they've been idle
const ann = await join({ name: 'Ann' });                      // brand new: level 1
const BERT_XP = 400;
const bert = await join({ profile: saveAt('Bert', BERT_XP) });
seen = await look();
const names = seen.here.map((p) => p.name).sort();
check('both listed as here', names.join() === 'Ann,Bert', names.join());
const fields = seen.here.map((p) => Object.keys(p).sort().join());
check('only what the world already shows of a player', fields.every((f) => f === 'avatar,away,idle,level,name,pid'), fields[0]);
check('public ids match the world\'s', seen.here.find((p) => p.name === 'Bert').pid === bert.pid());
check('level shown', seen.here.find((p) => p.name === 'Bert').level === levelFor(BERT_XP));

await sleep(2200);
ann.room.send('move', { x: 600, y: 600 });
await sleep(300);
seen = await look();
const idle = Object.fromEntries(seen.here.map((p) => [p.name, p.idle]));
check('doing something resets idle', idle.Ann <= 1, JSON.stringify(idle));
check('doing nothing counts up', idle.Bert >= 2, JSON.stringify(idle));
check('most active first', seen.here[0].name === 'Ann');

// ---- who's been by
await bert.room.leave(true);
await ann.room.leave(true);
await sleep(600);
seen = await look();
check('nobody here once they leave', seen.here.length === 0, JSON.stringify(seen.here));
const gone = seen.left.find((p) => p.name === 'Bert');
check('a player who left is seen lately', Boolean(gone) && gone.ago <= 2 && gone.level === levelFor(BERT_XP), JSON.stringify(seen.left));
check('with only public fields', gone && Object.keys(gone).sort().join() === 'ago,avatar,level,name,pid');
check('a level 1 player who left is not listed', !seen.left.some((p) => p.name === 'Ann'));

// ---- back again
const bertAgain = await join({ profile: saveAt('Bert', BERT_XP) });
seen = await look();
check('back: here, and not also in seen lately', seen.here.some((p) => p.name === 'Bert') && !seen.left.some((p) => p.name === 'Bert'));
await bertAgain.room.leave(true);

// ---- appear offline
const cleo = await join({ profile: saveAt('Cleo', BERT_XP), appearOffline: true });
const dora = await join({ profile: saveAt('Dora', BERT_XP) });
seen = await look();
check('appearing offline: not listed as here', !seen.here.some((p) => p.name === 'Cleo') && seen.here.some((p) => p.name === 'Dora'), seen.here.map((p) => p.name).join());
const onNow = async (p) => (await (await fetch(`${HTTP}/invite?with=${inviteCode(p.pid())}`)).json()).here;
check("and their invite link doesn't say they're on", (await onNow(cleo)) === false && (await onNow(dora)) === true);
dora.room.send('appearOffline', { on: true });
await sleep(300);
seen = await look();
check('switched on mid-game: off the list straight away', !seen.here.some((p) => p.name === 'Dora'));
await cleo.room.leave(true);
await dora.room.leave(true);
await sleep(500);
seen = await look();
check('and not listed after leaving either', !seen.left.some((p) => p.name === 'Cleo' || p.name === 'Dora'), seen.left.map((p) => p.name).join());
check('Bert, who left before, still is', seen.left.some((p) => p.name === 'Bert'));
const bertHidden = await join({ profile: saveAt('Bert', BERT_XP), appearOffline: true });
await bertHidden.room.leave(true);
await sleep(400);
seen = await look();
check('someone listed before is dropped once they appear offline', !seen.left.some((p) => p.name === 'Bert'));

// ---- a limit per address
let refused = null;
for (let i = 0; i < 40 && !refused; i++) {
  const res = await look();
  if (res.status === 429) refused = res;
}
check('too many looks are refused for a while', refused?.status === 429 && typeof refused.error === 'string');

finish();
