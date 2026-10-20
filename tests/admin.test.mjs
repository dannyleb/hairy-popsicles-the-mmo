// The admin page: there only with ADMIN_KEY set, data only for that key.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const HTTP = 'http://localhost:2583';
const KEY = 'test-admin-key';
const get = (path, key, headers = {}) => fetch(`${HTTP}${path}`, { headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers } });

const page = await get('/admin');
const html = await page.text();
check('the page loads, with no data in it', page.status === 200 && html.includes('Admin key') && !html.includes('profileId":'));
check("and isn't cached or framed", page.headers.get('cache-control') === 'no-store' && page.headers.get('x-frame-options') === 'DENY');
check('no key, no data', (await get('/admin/data')).status === 401);
check('wrong key, no data', (await get('/admin/data', 'nope', { 'X-Forwarded-For': '10.0.0.1' })).status === 401);

// Someone playing, and someone who's been and gone.
const today = new Date().toISOString().slice(0, 10);
const token = saveToken({
  profileId: `admin-gone-${Date.now()}`, name: 'Goner', avatar: 'pimples', xp: 400, currency: 77,
  collection: { pimples: 2, shiv: 1 }, shinies: { shiv: 1 }, inventory: { boil: 1, teeth: 3 }, quests: [],
  daily: { last: today, streak: 4 }, dailyQuest: null, stats: { harvests: 9 }, titles: [], title: null,
}, null, null);
const gone = await new Client('ws://localhost:2583').joinOrCreate('world', { profile: token });
gone.onMessage('*', () => {});
gone.send('sync');
await sleep(300);
await gone.leave(true);
const here = await new Client('ws://localhost:2583').joinOrCreate('world', { name: '<img src=x onerror=alert(1)>' });
here.onMessage('*', () => {});
here.send('sync');
here.send('chat', { text: 'hello admin' });
await sleep(400);

const res = await get('/admin/data', KEY);
const data = await res.json();
const live = data.players.find((p) => p.status === 'online');
const left = data.players.find((p) => p.name === 'Goner');
check('the right key gets the data', res.status === 200 && Array.isArray(data.players));
check("players here now, with what's private to them", live && typeof live.scraps === 'number' && live.collection && live.quests.length > 0);
// Names and chat are whatever players typed: the page only ever sets them as text.
check('the page never renders data as HTML', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
check('and players who left, from their last save', left?.status === 'offline' && left.scraps === 77 && left.inventory.teeth === 3 && left.shinies.shiv === 1 && left.streak === 4);
check('the world and recent chat come too', data.events && 'itch' in data.events && data.chat.some((c) => c.text === 'hello admin'));
check('saves themselves are never sent', !JSON.stringify(data).includes(token.split('.')[1]));

// Guessing gets an address locked out for a while (the right key included).
for (let i = 0; i < 10; i++) await get('/admin/data', `guess${i}`, { 'X-Forwarded-For': '10.0.0.9' });
check('too many wrong keys locks that address out', (await get('/admin/data', KEY, { 'X-Forwarded-For': '10.0.0.9' })).status === 429);
check('but not anyone else', (await get('/admin/data', KEY, { 'X-Forwarded-For': '10.0.0.10' })).status === 200);

// A server without ADMIN_KEY has no admin page at all.
check('without ADMIN_KEY there is no admin page', (await fetch('http://localhost:2584/admin')).status === 404 && (await fetch('http://localhost:2584/admin/data', { headers: { Authorization: 'Bearer anything' } })).status === 404);

await here.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
