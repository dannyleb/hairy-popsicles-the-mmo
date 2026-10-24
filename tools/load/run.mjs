// Load test: bots that play the game, in stages (10, then 50, 100, 200 players
// by default), against a copy of the server started just for it, to see where
// it strains and which Render plan it needs.
//
//   npm run load                          stages 10,50,100,200, the server held to one core
//   npm run load -- --plan starter        the server held to Starter's 0.5 CPU and 512 MB
//   npm run load -- --stages 10,50 --hold 30 --profile
//
// Options:
//   --stages 10,50,100,200   players at each stage
//   --hold 60                seconds measured at each stage (after it's filled and settled)
//   --plan free|starter|standard|pro   hold the server to that Render plan's CPU and
//                            memory (Linux, as root: cgroups). Without it the server
//                            gets one core, and the report says which plans that fits.
//   --profile                record where the server spends its CPU (top functions)
//   --keep-going             carry on past a stage that broke
//   --url ws://host:port     play against a server that's already running instead
//                            (only what the bots see is measured; a server's per-network
//                            limits stop more than 10 bots from one machine)
//   --label name             name for the report
//
// Reports go to tools/load/out/ (Markdown and JSON). See docs/DEVELOPMENT.md,
// "Load testing".
import { execFileSync, fork, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SERVER = path.join(ROOT, 'packages/server/src/index.js');

// Render's web service plans (render.com/pricing, October 2026).
const PLANS = {
  free: { name: 'Free', cpu: 0.1, memoryMB: 512, price: '$0' },
  starter: { name: 'Starter', cpu: 0.5, memoryMB: 512, price: '$7/mo' },
  standard: { name: 'Standard', cpu: 1, memoryMB: 2048, price: '$25/mo' },
  pro: { name: 'Pro', cpu: 2, memoryMB: 4096, price: '$85/mo' },
};
// A stage is healthy while lag (a player's own move showing up) stays under
// these, and nobody is dropped or turned away.
const LAG_STRAINED_MS = 300;
const LAG_BROKEN_MS = 1000;
const HEADROOM = 0.75;  // a plan fits a stage while it uses at most this share of the plan's CPU and memory
const RAMP_PER_SECOND = 10;
const SETTLE_SECONDS = 10;

// ---------- options ----------

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const stages = option('stages', '10,50,100,200').split(',').map(Number).filter((n) => n > 0);
const holdSeconds = Number(option('hold', 60));
const planId = option('plan', null);
const plan = planId ? PLANS[planId] : null;
if (planId && !plan) throw new Error(`--plan is one of ${Object.keys(PLANS).join(', ')}`);
const remote = option('url', null);
const profiling = flag('profile');
const keepGoing = flag('keep-going');
const port = Number(option('port', 2700));
const url = remote ?? `ws://localhost:${port}`;
const label = option('label', plan ? plan.name.toLowerCase() : remote ? 'remote' : 'one-core');
const outDir = path.join(HERE, 'out');
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const secret = 'load-test';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const has = (command) => {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const pin = (pid, cores) => {
  if (!canPin) return;
  try {
    execFileSync('taskset', ['-a', '-p', '-c', cores, String(pid)], { stdio: 'ignore' });
  } catch {
    // Not pinned: it shares every core.
  }
};
const canPin = process.platform === 'linux' && has('taskset');
const coreCount = os.availableParallelism();
const serverCores = Math.max(1, Math.ceil(plan?.cpu ?? 1));
const serverCpuList = Array.from({ length: serverCores }, (_, i) => i).join(',');
const botCpus = Array.from({ length: Math.max(1, coreCount - serverCores) }, (_, i) => (canPin ? i + serverCores : i) % coreCount);
const workerCount = Number(option('workers', Math.max(1, botCpus.length)));

// ---------- the server, held to a plan if asked ----------

// A cgroup (v1 or v2) holding the server to the plan's CPU and memory.
function makeCgroup(name, cpu, memoryMB) {
  const quota = Math.round(cpu * 100_000);
  const bytes = String(memoryMB * 1048576);
  if (existsSync('/sys/fs/cgroup/cgroup.controllers')) {
    const dir = `/sys/fs/cgroup/${name}`;
    mkdirSync(dir);
    writeFileSync(`${dir}/cpu.max`, `${quota} 100000`);
    writeFileSync(`${dir}/memory.max`, bytes);
    writeFileSync(`${dir}/memory.swap.max`, '0');
    return { procs: [`${dir}/cgroup.procs`], stat: `${dir}/cpu.stat`, v2: true, dirs: [dir] };
  }
  const cpuDir = `/sys/fs/cgroup/cpu/${name}`;
  const memoryDir = `/sys/fs/cgroup/memory/${name}`;
  mkdirSync(cpuDir);
  mkdirSync(memoryDir);
  writeFileSync(`${cpuDir}/cpu.cfs_period_us`, '100000');
  writeFileSync(`${cpuDir}/cpu.cfs_quota_us`, String(quota));
  writeFileSync(`${memoryDir}/memory.limit_in_bytes`, bytes);
  try {
    writeFileSync(`${memoryDir}/memory.memsw.limit_in_bytes`, bytes);
  } catch {
    // No swap accounting: the memory limit alone.
  }
  return { procs: [`${cpuDir}/cgroup.procs`, `${memoryDir}/cgroup.procs`], stat: `${cpuDir}/cpu.stat`, v2: false, dirs: [cpuDir, memoryDir] };
}

// How long the cgroup has been held back (throttled), in ms so far.
function throttledMs(group) {
  if (!group) return 0;
  const text = readFileSync(group.stat, 'utf8');
  const value = Number(text.match(group.v2 ? /throttled_usec (\d+)/ : /throttled_time (\d+)/)?.[1] ?? 0);
  return group.v2 ? value / 1000 : value / 1e6;
}

let server = null;
let group = null;
let serverExit = null;
let latestProbe = null;
const probeHandlers = [];

async function startServer() {
  if (plan) {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) {
      throw new Error('--plan needs Linux and root (it holds the server to the plan with cgroups). Run without it to measure on one core.');
    }
    group = makeCgroup(`hptm-load-${process.pid}`, plan.cpu, plan.memoryMB);
  }
  const flags = ['--import', path.join(HERE, 'probe.mjs')];
  if (profiling) flags.unshift('--cpu-prof', `--cpu-prof-dir=${path.join(outDir, 'profiles')}`, `--cpu-prof-name=${stamp}-${label}.cpuprofile`);
  server = spawn(process.execPath, [...flags, SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PROFILE_SECRET: secret,
      // One machine plays every bot: the per-network limits would stop it at 10.
      JOINS_PER_MINUTE: '100000',
      SEATS_PER_ADDRESS: '100000',
      // Never a real database.
      DATABASE_URL: '',
      DATABASE_URL_UNPOOLED: '',
      // The Boil comes round about every minute and a half, so each stage has a crowd tapping it.
      WORLD_EVENTS: 'boil',
      EVENT_SCALE: '0.3',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const file of group?.procs ?? []) writeFileSync(file, String(server.pid));
  pin(server.pid, serverCpuList);
  server.on('message', (message) => {
    if (message?.type !== 'probe') return;
    latestProbe = message;
    for (const handler of probeHandlers) handler(message);
  });
  let log = '';
  server.stderr.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  serverExit = new Promise((resolve) => server.on('exit', (code, signal) => resolve({ code, signal, log })));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not start')), 20_000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', () => reject(new Error(`the server exited: ${log}`)));
  });
}

async function stopServer() {
  if (!server) return;
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGINT');
  const timeout = sleep(15_000).then(() => server.kill('SIGKILL'));
  await Promise.race([serverExit, timeout]);
  for (const dir of group?.dirs ?? []) {
    try {
      rmdirSync(dir);
    } catch {
      // Still emptying; the OS clears it up.
    }
  }
}

// ---------- the bots ----------

const workers = [];
let nextBot = 0;
let requested = 0;

function startWorkers() {
  for (let i = 0; i < workerCount; i++) {
    const worker = fork(path.join(HERE, 'bots.mjs'), {
      cwd: ROOT,
      env: { ...process.env, LOAD_URL: url, LOAD_RETURNING: remote ? '0' : '1', PROFILE_SECRET: secret },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    pin(worker.pid, String(botCpus[i % botCpus.length]));
    const entry = { worker, connected: 0, cores: 0 };
    worker.on('message', (message) => {
      if (message?.type !== 'metrics') return;
      entry.connected = message.connected;
      entry.cores = message.cores;
      measured.take(message);
    });
    workers.push(entry);
  }
}

const connected = () => workers.reduce((sum, w) => sum + w.connected, 0);

async function addBots(count) {
  const perTick = Math.max(1, Math.round(RAMP_PER_SECOND / 10));
  while (count > 0) {
    const n = Math.min(perTick, count);
    const batches = new Map();
    for (let i = 0; i < n; i++) {
      const w = workers[nextBot % workers.length];
      if (!batches.has(w)) batches.set(w, []);
      batches.get(w).push(nextBot++);
    }
    for (const [w, indexes] of batches) w.worker.send({ type: 'add', indexes });
    requested += n;
    count -= n;
    await sleep(100);
  }
}

async function stopWorkers() {
  await Promise.all(workers.map(({ worker }) => new Promise((resolve) => {
    worker.once('exit', resolve);
    worker.send({ type: 'stop' });
    setTimeout(() => worker.kill('SIGKILL'), 10_000);
  })));
}

// ---------- measuring ----------

// Everything that comes in while a stage is measured.
const measured = {
  on: false,
  reset() {
    Object.assign(this, {
      seconds: [], latencies: [], gaps: [], flushes: [], loopP99: [], loopP50: [], cores: [], heapMB: [], rssMB: [],
      throttled: [], bytes: 0, messages: 0, moves: 0, echoTimeouts: 0, joinFails: 0, disconnects: 0, maxMessage: 0,
      errors: {}, workerCores: [], connected: [], actions: {},
    });
  },
  take(m) {
    // Joins turned away and players dropped count from the start of a stage's ramp.
    this.joinFails += m.joinFails;
    this.disconnects += m.disconnects;
    for (const [text, count] of Object.entries(m.errors)) this.errors[text] = (this.errors[text] ?? 0) + count;
    if (!this.on) return;
    this.bytes += m.bytes;
    this.messages += m.messages;
    this.moves += m.moves;
    this.echoTimeouts += m.echoTimeouts;
    this.maxMessage = Math.max(this.maxMessage, m.maxMessage);
    this.latencies.push(...m.latencies);
    this.gaps.push(...m.gaps);
    this.workerCores.push(m.cores);
    for (const [type, count] of Object.entries(m.actions)) this.actions[type] = (this.actions[type] ?? 0) + count;
  },
};
measured.reset();
probeHandlers.push((p) => {
  if (!measured.on) return;
  measured.cores.push(p.cores);
  measured.loopP99.push(p.loop.p99);
  measured.loopP50.push(p.loop.p50);
  measured.flushes.push(...p.flushes);
  measured.heapMB.push(p.heapMB);
  measured.rssMB.push(p.rssMB);
});

const quantile = (list, q) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const max = (list) => (list.length ? Math.max(...list) : null);

async function runStage(target) {
  measured.reset();
  const before = connected();
  console.log(`\n▶ ${target} players: filling (${before} now)`);
  if (requested < target) await addBots(target - requested);
  const deadline = Date.now() + 30_000 + target * 150;
  while (connected() < target && Date.now() < deadline && !serverGone) await sleep(500);
  await sleep(SETTLE_SECONDS * 1000);
  console.log(`  ${connected()} in; measuring ${holdSeconds}s`);
  const throttledBefore = throttledMs(group);
  const startedAt = Date.now();
  measured.on = true;
  for (let s = 0; s < holdSeconds && !serverGone; s++) {
    await sleep(1000);
    measured.connected.push(connected());
  }
  measured.on = false;
  const seconds = (Date.now() - startedAt) / 1000;
  const throttledShare = group ? (throttledMs(group) - throttledBefore) / (seconds * 1000) : null;
  return summarize(target, seconds, throttledShare);
}

function summarize(target, seconds, throttledShare) {
  const w = measured;
  const players = Math.round(mean(w.connected) ?? 0);
  const egressBps = w.bytes / seconds;
  const result = {
    target,
    players,
    lag: { p50: quantile(w.latencies, 0.5), p95: quantile(w.latencies, 0.95), p99: quantile(w.latencies, 0.99), samples: w.latencies.length },
    lostMoves: w.moves ? w.echoTimeouts / w.moves : 0,
    stateGapP95: quantile(w.gaps, 0.95),
    cpu: { mean: mean(w.cores), p95: quantile(w.cores, 0.95), max: max(w.cores) },
    throttledShare,
    loop: { p50: mean(w.loopP50), p99: quantile(w.loopP99, 0.95), worst: max(w.loopP99) },
    flush: { perSecond: w.flushes.length / seconds, mean: mean(w.flushes), p99: quantile(w.flushes, 0.99), max: max(w.flushes) },
    memory: { rssMB: max(w.rssMB), heapMB: max(w.heapMB) },
    egress: {
      totalKBps: egressBps / 1024,
      perPlayerKBps: players ? egressBps / players / 1024 : 0,
      gbPerPlayerHour: players ? (egressBps / players) * 3600 / 1e9 : 0,
      gbPerHourAll: egressBps * 3600 / 1e9,
      messagesPerPlayerSecond: players ? w.messages / seconds / players : 0,
      biggestMessageKB: w.maxMessage / 1024,
    },
    joinFails: w.joinFails,
    disconnects: w.disconnects,
    errors: w.errors,
    harnessCores: max(w.workerCores),
    // What each player did a minute, on average.
    actionsPerPlayerMinute: Object.fromEntries(Object.entries(w.actions).map(([type, count]) => [type, players ? (count / players / seconds) * 60 : 0])),
    serverDied: serverGone,
  };
  result.verdict = verdict(result);
  return result;
}

function verdict(r) {
  const reasons = [];
  if (r.serverDied) reasons.push(`server died (${r.serverDied})`);
  if (r.players < r.target * 0.95) reasons.push(`only ${r.players} of ${r.target} got in`);
  if (r.disconnects > 0) reasons.push(`${r.disconnects} dropped`);
  if (r.lag.p95 === null) reasons.push('no moves came back');
  else if (r.lag.p95 > LAG_BROKEN_MS) reasons.push(`lag p95 ${Math.round(r.lag.p95)} ms`);
  if (r.lostMoves > 0.05) reasons.push(`${Math.round(r.lostMoves * 100)}% of moves never showed`);
  if (reasons.length) return { level: 'BROKEN', reasons };
  if (r.lag.p95 > LAG_STRAINED_MS) reasons.push(`lag p95 ${Math.round(r.lag.p95)} ms`);
  if (r.loop.p99 > 150) reasons.push(`event loop late by ${Math.round(r.loop.p99)} ms`);
  if (plan && r.cpu.p95 > plan.cpu * 0.85) reasons.push(`CPU at ${Math.round((r.cpu.p95 / plan.cpu) * 100)}% of the plan`);
  if (r.throttledShare > 0.1) reasons.push(`held back by the CPU cap ${Math.round(r.throttledShare * 100)}% of the time`);
  if (plan && r.memory.rssMB > plan.memoryMB * 0.85) reasons.push(`memory at ${Math.round((r.memory.rssMB / plan.memoryMB) * 100)}% of the plan`);
  return reasons.length ? { level: 'STRAINED', reasons } : { level: 'OK', reasons };
}

let serverGone = null;

// ---------- the report ----------

const ACTION_TYPES = ['move', 'plant', 'harvest', 'tend', 'hitBoss', 'claimPlot', 'chat', 'emote'];
const n0 = (v) => (v === null || v === undefined ? '–' : String(Math.round(v)));
const n1 = (v) => (v === null || v === undefined ? '–' : v.toFixed(1));
const n2 = (v) => (v === null || v === undefined ? '–' : v.toFixed(2));

function line(r) {
  return `  ${r.verdict.level.padEnd(8)} ${String(r.players).padStart(3)} players · lag p50/p95 ${n0(r.lag.p50)}/${n0(r.lag.p95)} ms · `
    + `CPU ${n2(r.cpu.mean)} cores (p95 ${n2(r.cpu.p95)}) · loop p99 ${n0(r.loop.p99)} ms · broadcast ${n1(r.flush.mean)} ms · `
    + `RSS ${n0(r.memory.rssMB)} MB · out ${n0(r.egress.totalKBps)} KB/s · bots' CPU ${n2(r.harnessCores)}`
    + (r.verdict.reasons.length ? `\n           ${r.verdict.reasons.join('; ')}` : '');
}

// Which plans the measured CPU and memory fit (on one core, uncapped).
function planFit(results) {
  return Object.values(PLANS).map((p) => {
    const fits = results.filter((r) => r.verdict.level !== 'BROKEN' && r.cpu.p95 <= p.cpu * HEADROOM && r.memory.rssMB <= p.memoryMB * HEADROOM);
    const most = fits.length ? Math.max(...fits.map((r) => r.players)) : 0;
    return { ...p, most };
  });
}

function profileSummary() {
  if (!profiling) return null;
  const dir = path.join(outDir, 'profiles');
  const file = readdirSync(dir).filter((f) => f.startsWith(`${stamp}-${label}`)).map((f) => path.join(dir, f))[0];
  if (!file) return null;
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFunction = new Map();
  const byArea = new Map();
  let busy = 0;
  for (const node of profile.nodes) {
    const us = self.get(node.id) ?? 0;
    const { functionName, url: source, lineNumber } = node.callFrame;
    if (functionName === '(idle)' || !us) continue;
    busy += us;
    const short = source.replace(/^file:\/\//, '').replace(`${ROOT}/`, '').replace(/^.*node_modules\//, '');
    const key = `${functionName || '(anonymous)'}${short ? ` ${short}:${lineNumber + 1}` : ''}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + us);
    const area = source.includes('/packages/') ? 'game server code'
      : source.includes('msgpackr') ? 'msgpackr (encoding messages)'
        : /node_modules\/ws\//.test(source) ? 'ws (sending on sockets)'
          : source.includes('@colyseus') ? 'Colyseus'
            : source.startsWith('node:') ? 'Node internals (sockets, timers)'
              : functionName.startsWith('(') ? functionName
                : 'built-ins (JSON, etc.)';
    byArea.set(area, (byArea.get(area) ?? 0) + us);
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, us]) => ({ name, share: us / busy }));
  return { file: path.relative(ROOT, file), areas: top(byArea, 8), functions: top(byFunction, 15) };
}

function report(results, profile) {
  const where = remote ? `a running server at ${remote}` : plan
    ? `a local copy held to Render ${plan.name} (${plan.cpu} CPU, ${plan.memoryMB} MB) with cgroups`
    : `a local copy on one core (${os.cpus()[0]?.model ?? 'unknown CPU'})`;
  const rows = results.map((r) => `| ${r.players} | **${r.verdict.level}** | ${n0(r.lag.p50)} / ${n0(r.lag.p95)} / ${n0(r.lag.p99)} | ${n2(r.cpu.mean)} / ${n2(r.cpu.p95)} | ${r.throttledShare === null ? '–' : `${Math.round(r.throttledShare * 100)}%`} | ${n0(r.loop.p99)} | ${n1(r.flush.mean)} / ${n1(r.flush.p99)} | ${n0(r.memory.rssMB)} | ${n0(r.egress.totalKBps)} | ${n1(r.egress.perPlayerKBps)} | ${n2(r.egress.gbPerPlayerHour)} | ${n0(r.egress.biggestMessageKB)} | ${n2(r.harnessCores)} |`);
  const notes = results.filter((r) => r.verdict.reasons.length).map((r) => `- **${r.players} players, ${r.verdict.level}:** ${r.verdict.reasons.join('; ')}`);
  const errors = results.flatMap((r) => Object.entries(r.errors).map(([text, count]) => `- ${r.target} players: ${text} ×${count}`));
  const fit = !plan && !remote ? planFit(results) : null;
  return [
    `# Load test: ${label} (${stamp})`,
    '',
    `Against ${where}. Bots play like people: claim a plot, plant, harvest, squeeze neighbors' crops, wander, chat and emote; all but the fifth who mostly stand about mob The Boil (forced to come round every ~1.5 min) and tap it ~4 times a second. ${remote ? 'All bots are new players.' : 'Half bring a level-5 save (7 holes).'} Each stage: filled at ${RAMP_PER_SECOND} joins/s, settled ${SETTLE_SECONDS}s, measured ${holdSeconds}s.`,
    '',
    '| Players | Verdict | Lag p50 / p95 / p99 (ms) | Server CPU mean / p95 (cores) | Throttled | Event loop p99 (ms) | Broadcast mean / p99 (ms) | Memory (MB) | Egress (KB/s) | Per player (KB/s) | GB per player-hour | Biggest message (KB) | Bots\' CPU |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '**Lag** is how long a player\'s own move takes to show up in the world (sent → seen in a broadcast; broadcasts go out every 100 ms, so ~50 ms is the floor). **Broadcast** is the server building and sending one world update. **Bots\' CPU** is the busiest bot worker (near 1.0 means the test itself was the limit).',
    '',
    ...(notes.length ? ['## What strained', '', ...notes, ''] : []),
    '## What the bots did (per player, per minute)',
    '',
    '| Players | ' + ACTION_TYPES.join(' | ') + ' |',
    '|---|' + ACTION_TYPES.map(() => '---').join('|') + '|',
    ...results.map((r) => `| ${r.players} | ${ACTION_TYPES.map((t) => n1(r.actionsPerPlayerMinute[t] ?? 0)).join(' | ')} |`),
    '',
    ...(fit ? [
      '## Plan fit (projected from CPU and memory used)',
      '',
      `A plan fits a stage while the server uses at most ${HEADROOM * 100}% of the plan's CPU (p95) and memory. Measured on this machine's CPU; Render's may be a little slower.`,
      '',
      '| Plan | Price | CPU | Memory | Fits up to (of the stages run) |',
      '|---|---|---|---|---|',
      ...fit.map((p) => `| ${p.name} | ${p.price} | ${p.cpu} | ${p.memoryMB} MB | ${p.most ? `${p.most} players` : 'none of them'} |`),
      '',
    ] : []),
    ...(profile ? [
      '## Where the server\'s CPU went (whole run)',
      '',
      ...profile.areas.map((a) => `- ${a.name}: ${Math.round(a.share * 100)}%`),
      '',
      'Top functions (own time):',
      '',
      ...profile.functions.map((f) => `- ${(f.share * 100).toFixed(1)}% \`${f.name}\``),
      '',
      `Profile: \`${profile.file}\` (open in Chrome DevTools → Performance).`,
      '',
    ] : []),
    ...(errors.length ? ['## Errors', '', ...errors, ''] : []),
  ].join('\n');
}

// ---------- run ----------

mkdirSync(path.join(outDir, 'profiles'), { recursive: true });
console.log(`Load test "${label}": stages ${stages.join(', ')}; ${holdSeconds}s each; ${workerCount} bot workers${canPin ? ` (server on core ${serverCpuList})` : ''}`);
if (!remote) {
  await startServer();
  serverExit.then(({ code, signal }) => {
    serverGone = signal === 'SIGKILL' || code === 137 ? 'killed: out of memory?' : `exit ${code ?? signal}`;
  });
}
startWorkers();
const results = [];
let stopping = false;
const finish = async () => {
  if (stopping) return;
  stopping = true;
  await stopWorkers();
  if (!remote) {
    serverGone = null;
    await stopServer();
  }
  const profile = profileSummary();
  const text = report(results, profile);
  const file = path.join(outDir, `${stamp}-${label}`);
  writeFileSync(`${file}.md`, text);
  writeFileSync(`${file}.json`, JSON.stringify({ label, plan, stages, holdSeconds, results, profile }, null, 2));
  console.log(`\n${text}\n\nReport: ${path.relative(ROOT, file)}.md`);
};
process.on('SIGINT', () => finish().then(() => process.exit(130)));

for (const target of stages) {
  const result = await runStage(target);
  results.push(result);
  console.log(line(result));
  if (serverGone || (result.verdict.level === 'BROKEN' && !keepGoing)) break;
}
await finish();
process.exit(0);
