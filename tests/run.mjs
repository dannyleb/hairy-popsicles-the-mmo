// Runs the server test suites, each against fresh servers started just for it:
//   npm test               every suite
//   npm test -- saves rain only those
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'packages/server/src/index.js');
const SUITE_TIMEOUT_MS = 5 * 60_000;

// Each suite and the servers it talks to: port plus the timers sped up for testing.
const SUITES = {
  filter: [],
  featured: [],
  game: [{ PORT: 2567, GROW_SCALE: 0.01, EVENT_SCALE: 0.1 }, { PORT: 2568 }],
  reconnect: [{ PORT: 2568 }],
  saves: [{ PORT: 2569, GROW_SCALE: 0.01 }],
  shinies: [{ PORT: 2570, GROW_SCALE: 0.01, SHINY_BOOST: 40 }],
  rain: [{ PORT: 2571, EVENT_SCALE: 0.05 }],
  hardening: [{ PORT: 2572 }],
  titles: [{ PORT: 2573, GROW_SCALE: 0.01 }],
  gifts: [{ PORT: 2574 }],
  levels: [{ PORT: 2575, GROW_SCALE: 0.01 }],
  shop: [{ PORT: 2576 }],
  integrity: [{ PORT: 2577, EVENT_SCALE: 0.2 }],
  itch: [{ PORT: 2578, GROW_SCALE: 0.01, EVENT_SCALE: 0.02 }],
  rows: [{ PORT: 2579 }],
  held: [{ PORT: 2582, GROW_SCALE: 0.05, PLOT_HOLD_MS: 8000 }],
  admin: [{ PORT: 2583, ADMIN_KEY: 'test-admin-key' }, { PORT: 2584 }],
  season: [{ PORT: 2580, GROW_SCALE: 0.01, SEASON_DAY: '2026-10-25' }, { PORT: 2581, GROW_SCALE: 0.01, SEASON_DAY: '2026-12-01' }],
  invites: [{ PORT: 2586, GROW_SCALE: 0.01 }, { PORT: 2587, GROW_SCALE: 0.01 }],
  limits: [{ PORT: 2585, JOINS_PER_MINUTE: 16, SEATS_PER_ADDRESS: 3, NEWCOMERS_KEPT: 3, ADMIN_KEY: 'test-admin-key' }],
};
// Every test player comes from this one machine, so the per-address limits are
// out of the way unless a suite sets its own.
const DEFAULTS = { JOINS_PER_MINUTE: 100_000, SEATS_PER_ADDRESS: 100_000 };

function startServer(settings) {
  const env = { ...process.env, PROFILE_SECRET: 'test' };
  for (const [key, value] of Object.entries({ ...DEFAULTS, ...settings })) env[key] = String(value);
  const server = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server on ${settings.PORT} didn't start`)), 15_000);
    // Keep reading its output (joins, leaves) so the pipe never fills up.
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        resolve(server);
      }
    });
    server.on('exit', (code) => reject(new Error(`server on ${settings.PORT} exited (${code})`)));
  });
}

function runSuite(name) {
  return new Promise((resolve) => {
    const suite = spawn(process.execPath, [path.join(ROOT, 'tests', `${name}.test.mjs`)], { cwd: ROOT, stdio: 'inherit' });
    const timer = setTimeout(() => suite.kill(), SUITE_TIMEOUT_MS);
    suite.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

const chosen = process.argv.slice(2);
const names = chosen.length ? chosen : Object.keys(SUITES);
const results = [];
for (const name of names) {
  if (!SUITES[name]) {
    console.error(`No suite called ${name}. Suites: ${Object.keys(SUITES).join(', ')}`);
    process.exit(2);
  }
  console.log(`\n=== ${name} ===`);
  const servers = [];
  let ok = false;
  try {
    for (const settings of SUITES[name]) servers.push(await startServer(settings));
    ok = await runSuite(name);
  } catch (error) {
    console.error(error.message);
  } finally {
    for (const server of servers) {
      server.removeAllListeners('exit');
      server.kill();
    }
  }
  results.push({ name, ok });
}

console.log('\n=== summary ===');
for (const { name, ok } of results) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
