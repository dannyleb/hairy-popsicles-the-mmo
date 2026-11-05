import pg from 'pg';

// Saves in Postgres (Neon), when DATABASE_URL is set. A save is still the same
// signed token the player's device keeps; the database holds the server's
// newest copy of each, so it outlives a restart: an older copy (a replayed
// save, or a phone that missed the last update) can't win after one, and
// absent players' plots go back into the world. Without DATABASE_URL all of
// this is skipped and the server runs from memory as before.
//
// node-postgres with a small pool, on Neon's pooled connection string: the
// server is one long-running process. Schema changes use the direct one.
const URL = process.env.DATABASE_URL;
const LOAD_TIMEOUT_MS = 3000;  // a join waits this long for the database at most

const pool = URL ? new pg.Pool({ connectionString: URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 }) : null;
// A dropped idle connection (Neon suspends idle databases) must not end the process.
pool?.on('error', (error) => console.error('database connection lost:', error.message));

const pending = new Set();  // writes still in flight, waited for at shutdown
let ready = false;          // set up and answering, as of startup

export const hasDatabase = Boolean(pool);
// For /stats: 'off' (no DATABASE_URL), 'ready', or 'unreachable' (set, but setup failed).
export const databaseState = () => (!pool ? 'off' : ready ? 'ready' : 'unreachable');

export async function setUpDatabase() {
  if (!pool) return;
  const direct = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || URL, connectionTimeoutMillis: 15_000 });
  await direct.connect();
  try {
    await direct.query(`
      CREATE TABLE IF NOT EXISTS saves (
        profile_id text PRIMARY KEY,
        token      text NOT NULL,
        saved_at   timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await direct.query('CREATE INDEX IF NOT EXISTS saves_updated_at ON saves (updated_at)');
    // Chat safety (game/moderation.js): strikes and bans by save, and every flagged line.
    await direct.query(`
      CREATE TABLE IF NOT EXISTS moderation (
        profile_id text PRIMARY KEY,
        pid        text NOT NULL,
        name       text NOT NULL DEFAULT '',
        strikes    integer NOT NULL DEFAULT 0,
        banned_at  timestamptz,
        network    text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await direct.query(`
      CREATE TABLE IF NOT EXISTS chat_flags (
        id         bigserial PRIMARY KEY,
        at         timestamptz NOT NULL,
        profile_id text NOT NULL,
        pid        text NOT NULL,
        name       text NOT NULL DEFAULT '',
        text       text NOT NULL,
        category   text NOT NULL,
        strike     integer NOT NULL DEFAULT 0
      )`);
    await direct.query('CREATE INDEX IF NOT EXISTS chat_flags_at ON chat_flags (at)');
    ready = true;
  } finally {
    await direct.end();
  }
}

// The newest save stored for this profile, or null (none, or the database is
// slow or down: then the device's own save is used).
export async function loadSave(profileId) {
  if (!pool) return null;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS); });
  try {
    const query = pool.query('SELECT token FROM saves WHERE profile_id = $1', [profileId]).then(({ rows }) => rows[0]?.token ?? null);
    return await Promise.race([query, timeout]);
  } catch (error) {
    console.error('loading a save failed:', error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Keeps this save, unless a newer one is already stored. Never throws: a
// failed write is logged, and the next one tries again.
export function storeSave(profileId, token) {
  if (!pool) return Promise.resolve();
  const write = pool.query(
    `INSERT INTO saves (profile_id, token, saved_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
     ON CONFLICT (profile_id) DO UPDATE SET token = EXCLUDED.token, saved_at = EXCLUDED.saved_at, updated_at = now()
     WHERE saves.saved_at <= EXCLUDED.saved_at`,
    [profileId, token, Date.now()],
  ).then(() => {}, (error) => console.error('storing a save failed:', error.message));
  pending.add(write);
  write.finally(() => pending.delete(write));
  return write;
}

// Saves stored since `since` (ms), newest first: { token, at }.
export async function recentSaves(since, limit) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT token, (extract(epoch FROM updated_at) * 1000)::float8 AS at FROM saves
     WHERE updated_at > to_timestamp($1 / 1000.0) ORDER BY updated_at DESC LIMIT $2`,
    [since, limit],
  );
  return rows;
}

// ---------- chat safety (game/moderation.js) ----------

// Writes that must not be lost go through here: logged if they fail, waited
// for at shutdown, never thrown.
function track(write, what) {
  const settled = write.then(() => {}, (error) => console.error(`${what} failed:`, error.message));
  pending.add(settled);
  settled.finally(() => pending.delete(settled));
  return settled;
}

// Everyone with a strike or a ban: { profileId, pid, name, strikes, bannedAt, network }.
export async function loadModeration() {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT profile_id, pid, name, strikes, (extract(epoch FROM banned_at) * 1000)::float8 AS banned_at, network
     FROM moderation WHERE strikes > 0 OR banned_at IS NOT NULL`,
  );
  return rows.map((r) => ({ profileId: r.profile_id, pid: r.pid, name: r.name, strikes: r.strikes, bannedAt: r.banned_at, network: r.network }));
}

export function storeModeration({ profileId, pid, name, strikes, bannedAt, network }) {
  if (!pool) return Promise.resolve();
  return track(pool.query(
    `INSERT INTO moderation (profile_id, pid, name, strikes, banned_at, network) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6)
     ON CONFLICT (profile_id) DO UPDATE SET pid = EXCLUDED.pid, name = EXCLUDED.name, strikes = EXCLUDED.strikes,
       banned_at = EXCLUDED.banned_at, network = EXCLUDED.network, updated_at = now()`,
    [profileId, pid, name, strikes, bannedAt, network],
  ), 'storing a strike');
}

export function storeFlag({ at, profileId, pid, name, text, category, strike }) {
  if (!pool) return Promise.resolve();
  return track(pool.query(
    `INSERT INTO chat_flags (at, profile_id, pid, name, text, category, strike) VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7)`,
    [at, profileId, pid, name, text, category, strike],
  ), 'storing a flagged line');
}

// The newest flagged lines, oldest first.
export async function recentFlags(limit) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT (extract(epoch FROM at) * 1000)::float8 AS at, profile_id, pid, name, text, category, strike
     FROM chat_flags ORDER BY at DESC LIMIT $1`,
    [limit],
  );
  return rows.reverse().map((r) => ({ at: r.at, profileId: r.profile_id, pid: r.pid, name: r.name, text: r.text, category: r.category, strike: r.strike }));
}

// For the admin page: whether it's connected, and how many players it holds.
export async function databaseStatus() {
  if (!pool) return { on: false };
  try {
    const { rows } = await pool.query('SELECT count(*)::int AS saves FROM saves');
    return { on: true, saves: rows[0].saves };
  } catch (error) {
    return { on: true, error: error.message };
  }
}

// At shutdown: let the last writes land, then close the pool.
export async function closeDatabase() {
  await Promise.allSettled([...pending]);
  await pool?.end();
}
