process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2573';
const day = (t) => new Date(t).toISOString().slice(0, 10);

// A veteran one harvest short of Picker and one day short of Regular.
const veteran = {
  profileId: 'veteran-1', name: 'Vet', avatar: 'pimples', xp: 50, currency: 100,
  collection: { pimples: 3 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: day(Date.now() - 86_400_000), streak: 6 }, dailyQuest: null,
  stats: { harvests: 24, squeezes: 0, bossTops: 0, globs: 0, shinies: 0, chats: 0 }, titles: [], title: null,
};
const token = saveToken(veteran, null, null);

const room = await new Client(URL).joinOrCreate('world', { profile: token });
const p = { notices: [], earned: [], saves: [] };
room.onMessage('*', () => {});
room.onMessage('init', (s) => { p.state = s; });
room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
room.onMessage('me', (m) => { p.me = m; });
room.onMessage('notice', (n) => p.notices.push(n));
room.onMessage('titleEarned', (t) => p.earned.push(t.id));
room.onMessage('save', ({ token: t }) => p.saves.push(t));
room.send('sync');
await sleep(400);
const pub = () => p.state.players[room.sessionId];
check('streak title earned on arrival, as a notice', p.notices.some((n) => n.kind === 'title' && n.id === 'regular') && !p.earned.length);
check('first title is worn straight away', p.me.title === 'regular' && pub().title === 'Regular');

room.send('claimPlot', { plotX: 1, plotY: 1 });
await sleep(150);
room.send('plant', { plotKey: '1,1', slot: 4 });
await sleep(200);
const crop = p.state.plots['1,1'].slots[4];
await sleep(Math.max(0, crop.readyAt - Date.now() + 60));
room.send('harvest', { plotKey: '1,1', slot: 4 });
await sleep(300);
check('harvest title earned live', p.earned.includes('picker') && p.me.titles.includes('picker') && p.me.stats.harvests === 25);
check('wearing stays as chosen', p.me.title === 'regular');
room.send('setTitle', { id: 'picker' });
await sleep(250);
check('switch to another earned title', pub().title === 'Picker');
room.send('setTitle', { id: 'pus-farmer' });
await sleep(250);
check('cannot wear an unearned title', pub().title === 'Picker');
room.send('setTitle', { id: null });
await sleep(250);
check('can wear none', pub().title === null);
room.send('setTitle', { id: 'picker' });
await sleep(2300);
const [body] = p.saves.at(-1).split('.');
const saved = JSON.parse(Buffer.from(body, 'base64url').toString());
check('save carries stats and titles', saved.stats.harvests === 25 && saved.titles.includes('picker') && saved.title === 'picker');
await room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
