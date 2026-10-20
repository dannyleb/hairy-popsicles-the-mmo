// Album rows: growing every character of a rarity pays a one-time reward.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { ALBUM_ROWS, CHARACTERS } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2579';
const today = new Date().toISOString().slice(0, 10);

async function join(profile) {
  const room = await new Client(URL).joinOrCreate('world', { profile });
  const p = { room, rows: [], announce: [], quests: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('save', ({ token }) => { p.token = token; });
  room.onMessage('notice', (n) => { if (n.kind === 'row') p.rows.push(n); });
  room.onMessage('announce', (a) => p.announce.push(a));
  room.onMessage('questDone', (q) => p.quests.push(q));
  room.send('sync');
  await sleep(300);
  return p;
}

const ids = (rarity) => CHARACTERS.filter((c) => c.rarity === rarity).map((c) => c.id);
const profile = (id, collection, extra = {}) => saveToken({
  profileId: `${id}-${Date.now()}`, name: id, avatar: Object.keys(collection)[0], xp: 0, currency: 20,
  collection, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null, ...extra,
}, null, null);

// Every common but one, then a gift of the last one.
const [last, ...rest] = ids('common');
const collector = await join(profile('Collector', Object.fromEntries(rest.map((id) => [id, 1]))));
const giver = await join(profile('Giver', { [last]: 2 }));
check('no reward for an unfinished row', collector.rows.length === 0 && !collector.me.rows.length);
const scraps = collector.me.currency;
giver.room.send('gift', { to: collector.room.sessionId, characterId: last });
await sleep(400);
const row = collector.rows[0];
// A new character can also finish a "grow someone new" quest, which pays on its own.
const questScraps = collector.quests.reduce((n, q) => n + q.scraps, 0);
check('finishing a row pays its reward', row?.rarity === 'common' && row.scraps === ALBUM_ROWS.common.scraps && collector.me.currency === scraps + questScraps + ALBUM_ROWS.common.scraps);
check('the row is marked done', collector.me.rows.includes('common'));
check('everyone hears about it', giver.announce.some((a) => a.kind === 'common' && a.text.includes('completed the Common row')));
await sleep(2200);  // let a save go out

// The same save back: paid once only.
await collector.room.leave(true);
await sleep(300);
const again = await join(collector.token);
check('a row is only paid once', again.rows.length === 0 && again.me.rows.includes('common'));
await again.room.leave(true);

// A save from before row rewards, with a row already finished, is paid on arrival.
const veteran = await join(profile('Veteran', Object.fromEntries(ids('uncommon').map((id) => [id, 2]))));
const paid = veteran.rows.find((r) => r.rarity === 'uncommon');
check('an older save with a full row is paid when it arrives', Boolean(paid) && veteran.me.inventory.boil === ALBUM_ROWS.uncommon.boil);
check('only the rows that are full', veteran.rows.length === 1);

await veteran.room.leave(true);
await giver.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
