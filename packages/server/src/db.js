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
