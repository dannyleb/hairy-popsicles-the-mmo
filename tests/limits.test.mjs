// Limits that keep one person from spoiling the world for everyone: joins and
// seats per address, request sizes, repeat syncs, invisible characters, and the
// admin lockout going by an address that can't be faked.
process.env.PROFILE_SECRET = 'test';
const http = await import('node:http');
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const PORT = 2585;
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const ADMIN = { Authorization: 'Bearer test-admin-key' };
// The server runs with JOINS_PER_MINUTE=16, SEATS_PER_ADDRESS=3 and NEWCOMERS_KEPT=3.

const matchmake = (body, headers = {}) => fetch(`${HTTP}/matchmake/joinOrCreate/world`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body,
});

// A raw request, for what fetch won't send: a body with no length.
function chunked() {
  return new Promise((resolve, reject) => {
    const req = http.request(`${HTTP}/matchmake/joinOrCreate/world`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.write('{"name":');
    req.end('"x"}');
  });
}

function listen(room) {
  const p = { room, inits: 0, chat: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.inits += 1; p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('chat', (line) => p.chat.push(line));
  return p;
}
const join = async (options = {}) => listen(await new Client(WS).joinOrCreate('world', options));
const refusal = (promise) => promise.then(() => null, (error) => error);

// Requests the game never makes are turned away before they cost anything.
check('a huge join is refused unread', (await matchmake(JSON.stringify({ name: 'x'.repeat(20_000) }), { 'CF-Connecting-IP': '198.51.100.1' })).status === 413);
check('so is one with no length', await chunked() === 411);
check('and the room list', (await fetch(`${HTTP}/matchmake/world`)).status === 405);
// A mangled path (here one no URL parser accepts) gets an answer, not a crash.
const net = await import('node:net');
const mangled = await new Promise((resolve) => {
  const socket = net.connect(PORT, 'localhost', () => socket.write('GET //[ HTTP/1.1\r\nHost: x\r\n\r\n'));
  socket.on('data', (d) => { resolve(String(d).split('\r\n')[0]); socket.end(); });
  socket.on('error', () => resolve('error'));
});
check('a mangled request path is answered, and the server stays up', mangled.startsWith('HTTP/1.1') && (await fetch(`${HTTP}/stats`)).ok, mangled);

// Seats per network (by socket here: no proxy in front).
const seated = [await join({ name: 'One' }), await join({ name: 'Two' }), await join({ name: 'Three' })];
const fourth = await refusal(join({ name: 'Four' }));
check('one network gets only so many seats at once', fourth?.code === 429 && /too many players/i.test(fourth.message), String(fourth?.message));
await seated[2].room.leave(true);
await sleep(200);
const again = await join({ name: 'Again' }).catch((error) => error);
check('a seat frees up when one of them leaves', Boolean(again.room), String(again.message ?? ''));
// Dropping and reconnecting doesn't free a seat for someone else.
const token = seated[0].room.reconnectionToken;
seated[0].room.connection.close();
await sleep(300);
// While they're away the world holds their place, seat and all.
const sixth = await refusal(join({ name: 'Six' }));
check('a player whose phone dropped still holds their seat', sixth?.code === 429, String(sixth?.message));
seated[0] = listen(await new Client(WS).reconnect(token));
await sleep(200);
const fifth = await refusal(join({ name: 'Five' }));
check('a player who reconnected still counts', fifth?.code === 429, String(fifth?.message));

// A full copy of the world goes out at most once a second per connection.
const p = seated[0];
await sleep(1100);
const before = p.inits;
for (let i = 0; i < 6; i++) p.room.send('sync');
await sleep(400);
check('asking for the world again and again gets it once', p.inits === before + 1, `${p.inits - before} copies`);
await sleep(1000);
p.room.send('sync');
await sleep(300);
check('and again after a second', p.inits === before + 2);

// Names and chat lose characters that hide words or flip text around.
await seated[1].room.leave(true);
await sleep(200);
const sneaky = await join({ name: 'Ev‮il​\u0007 ⁦Name' });
sneaky.room.send('sync');
await sleep(300);
const me = sneaky.state.players[sneaky.room.sessionId];
check('invisible characters are stripped from names', me?.name === 'Evil Name', JSON.stringify(me?.name));
sneaky.room.send('chat', { text: 'hi‮there​\u001b[31m 👨‍👩‍👧' });
await sleep(300);
const line = sneaky.chat.at(-1)?.text;
check('and from chat (emoji kept)', line === 'hithere[31m 👨‍👩‍👧', JSON.stringify(line));
await sneaky.room.leave(true);
await sleep(200);
const ghost = await join({ name: '\u200B\u202E\u2066' });
await sleep(200);
check('a name of nothing but invisible characters becomes a Guest', /^Guest\d+$/.test(ghost.state.players[ghost.room.sessionId]?.name ?? ''));
await ghost.room.leave(true);
await sleep(200);

// Everyone is remembered when they leave, but newcomers in a pool of their own
// (3 here): a flood of throwaway players can't push out anyone with progress.
const keeper = saveToken({
  profileId: `limits-keeper-${Date.now()}`, name: 'Keeper', avatar: 'pimples', xp: 50, currency: 40,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: null, streak: 0 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);
const kept = await join({ profile: keeper });
await sleep(200);
await kept.room.leave(true);
await sleep(200);
for (const name of ['Junk1', 'Junk2', 'Junk3']) {
  const junk = await join({ name });
  await sleep(100);
  await junk.room.leave(true);
}
await sleep(300);
const report = await (await fetch(`${HTTP}/admin/data`, { headers: ADMIN })).json();
const names = report.players.filter((x) => x.status === 'offline').map((x) => x.name);
check('a flood of newcomers leaving pushes out only other newcomers', names.includes('Keeper') && ['Junk1', 'Junk2', 'Junk3'].every((n) => names.includes(n)) && !names.includes('Two'), names.join(','));

// The admin lockout goes by the address the edge saw, which a caller can't
// fake by adding their own X-Forwarded-For entries.
for (let i = 0; i < 10; i++) await fetch(`${HTTP}/admin/data`, { headers: { Authorization: `Bearer guess${i}`, 'X-Forwarded-For': `10.1.${i}.1, 10.0.0.9` } });
check('wrong keys lock out the real address, whatever is put in front of it', (await fetch(`${HTTP}/admin/data`, { headers: { ...ADMIN, 'X-Forwarded-For': '10.9.9.9, 10.0.0.9' } })).status === 429);
for (let i = 0; i < 10; i++) await fetch(`${HTTP}/admin/data`, { headers: { Authorization: `Bearer guess${i}`, 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': `10.2.${i}.1` } });
check('the edge address wins over X-Forwarded-For', (await fetch(`${HTTP}/admin/data`, { headers: { ...ADMIN, 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '10.3.3.3' } })).status === 429);
const mine = await fetch(`${HTTP}/admin/data`, { headers: { ...ADMIN, 'CF-Connecting-IP': '203.0.113.50' } });
check('the admin page shows the address it sees and where from', (await mine.json()).you?.address === '203.0.113.50');
const page = await fetch(`${HTTP}/admin`);
const policy = page.headers.get('content-security-policy') ?? '';
check('the admin page may run only its own script', /script-src 'sha256-[^']+'/.test(policy) && policy.includes("default-src 'none'") && page.headers.get('x-content-type-options') === 'nosniff');

// Joins per address per minute: seats held for joins that never connect can't
// fill the world.
const flood = [];
for (let i = 0; i < 17; i++) flood.push((await matchmake('{}', { 'CF-Connecting-IP': '198.51.100.7' })).status);
check('joins from one address are limited', flood.slice(0, 16).every((s) => s === 200) && flood[16] === 429, flood.join(' '));
check("others aren't held up by it", (await matchmake('{}', { 'CF-Connecting-IP': '198.51.100.8' })).status === 200);
// Use up this machine's joins: the game is told why it can't get in.
let status = 200;
for (let i = 0; i < 16 && status === 200; i++) status = (await matchmake('{}')).status;
const blocked = await refusal(join({ name: 'Late' }));
check('a player over the limit is told why', blocked?.code === 429 && /wait a minute/i.test(blocked.message), String(blocked?.message));

await seated[0].room.leave(true);
await again.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
