// Saves in Postgres: stored while playing, on leaving and at shutdown; after a
// restart the newest copy beats an older one from the device, and absent
// players' plots are back in the world. Starts and stops its own servers.
// Needs a database it may wipe: TEST_DATABASE_URL (skipped without one).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.log('skipped: set TEST_DATABASE_URL to a Postgres database the tests may wipe');
  process.exit(0);
}
process.env.PROFILE_SECRET = 'test';
const { default: pg } = await import('pg');
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/server/src/index.js');

const sql = new pg.Client({ connectionString: DB });
await sql.connect();
await sql.query('DROP TABLE IF EXISTS saves');
const stored = async (profileId) => {
  const { rows } = await sql.query('SELECT token FROM saves WHERE profile_id = $1', [profileId]);
  return rows[0] && JSON.parse(Buffer.from(rows[0].token.split('.')[0], 'base64url').toString());
};

// A game server of our own; resolves once it's listening, with its log so far.
function startServer(port, env = {}) {
  const server = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB, STORE_MS: '1000',
      GROW_SCALE: '0.01', JOINS_PER_MINUTE: '1000', SEATS_PER_ADDRESS: '1000', ADMIN_KEY: 'test-admin-key', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.log = '';
  const note = (chunk) => { server.log += chunk; };
  server.stdout.on('data', note);
  server.stderr.on('data', note);
  server.exited = new Promise((resolve) => server.on('exit', resolve));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server on ${port} didn't start:\n${server.log}`)), 20_000);
    server.stdout.on('data', () => {
      if (server.log.includes('listening')) {
        clearTimeout(timer);
        resolve(server);
      }
    });
  });
}

async function join(port, options) {
  const room = await new Client(`ws://localhost:${port}`).joinOrCreate('world', options);
  const p = { room };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('me', (m) => { p.me = m; });
  room.send('sync');
  await sleep(400);
  return p;
}

const today = new Date().toISOString().slice(0, 10);
const player = (id, name) => saveToken({
  profileId: id, name, avatar: 'pimples', xp: 400, currency: 100, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);

// ---- server A: saves go into the database
let a = await startServer(2590);
check('the server sets up its database at startup', a.log.includes('database ready'));
const { rows: tables } = await sql.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'saves'");
check('the saves table exists', tables.length === 1);

const pid = `db-keeper-${Date.now()}`;
const original = player(pid, 'Keeper');  // the device's copy, kept to replay later
const keeper = await join(2590, { profile: original });
keeper.room.send('claimPlot', { plotX: 4, plotY: 4 });
await sleep(300);
keeper.room.send('plant', { plotKey: '4,4', slot: 4, seed: 'pimple' });
await sleep(3500);  // a save goes out within 2s, into the database within STORE_MS after
const whilePlaying = await stored(pid);
check('a save is stored while the player plays', whilePlaying?.currency === keeper.me.currency && whilePlaying.currency < 100 && whilePlaying.plot?.key === '4,4', JSON.stringify({ stored: whilePlaying?.currency, live: keeper.me?.currency }));
keeper.room.send('buy', { item: 'fertilizer' });
await sleep(300);
const spent = keeper.me.currency;
await keeper.room.leave(true);
await sleep(500);
check('and when they leave', (await stored(pid))?.currency === spent, `${(await stored(pid))?.currency} vs ${spent}`);

const fresh = await join(2590, { name: 'Nobody' });
const freshId = fresh.me.profileId;
await fresh.room.leave(true);
await sleep(500);
check('a player with no progress is not stored', !(await stored(freshId)));

// Someone still playing when the server is told to stop (a deploy, a restart).
const late = `db-late-${Date.now()}`;
const lastMinute = await join(2590, { profile: player(late, 'Late') });
lastMinute.room.send('buy', { item: 'fertilizer' });
await sleep(150);
const beforeStop = lastMinute.me.currency;
a.kill('SIGTERM');
const code = await Promise.race([a.exited, sleep(15_000).then(() => 'still running')]);
check('a stopping server exits cleanly', code === 0, `exit ${code}`);
check('and stores everyone still playing first', (await stored(late))?.currency === beforeStop, `${(await stored(late))?.currency} vs ${beforeStop}`);
if (code === 'still running') a.kill('SIGKILL');

// ---- server B: the same database after a restart
const b = await startServer(2591);
await sleep(300);
const watcher = await join(2591, { name: 'Watcher' });
const held = watcher.state.plots['4,4'];
check("an absent player's plot is back in the world after a restart", held?.away === true && held.ownerName === 'Keeper' && held.slots.some(Boolean), b.log.match(/restored \d+ held plots/)?.[0] ?? 'no restore logged');
const back = await join(2591, { profile: original });  // the old copy, from before they spent anything
check('coming back with an old save after a restart gets the newest one', back.me.currency === spent, `${back.me.currency} vs ${spent}`);
check('and their plot', back.state.plots['4,4']?.ownerId === back.room.sessionId);
const status = await (await fetch('http://localhost:2591/admin/data', { headers: { Authorization: 'Bearer test-admin-key' } })).json();
check('the admin page shows the database and how many saves it holds', status.database?.on === true && status.database.saves >= 2, JSON.stringify(status.database));
check('/stats says the database is on', (await (await fetch('http://localhost:2591/stats')).json()).database === true);
await back.room.leave(true);
await watcher.room.leave(true);
b.kill('SIGTERM');
await b.exited;

// ---- server C: the database is down; the game still runs
const c = await startServer(2592, { DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', DATABASE_URL_UNPOOLED: 'postgres://nobody@127.0.0.1:1/none' });
check('with the database down, the server still starts', c.log.includes('running without it'));
const started = Date.now();
const stillPlays = await join(2592, { profile: original });
check('and players can still join, from their own save', stillPlays.me?.currency === 100 && Date.now() - started < 6000, `${Date.now() - started}ms`);
await stillPlays.room.leave(true);
c.kill('SIGTERM');
await c.exited;

await sql.end();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
