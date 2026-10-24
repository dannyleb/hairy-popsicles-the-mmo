// Loaded into the game server for a load test only (node --import), to see
// inside it without changing it: how late its event loop runs, how long each
// world broadcast takes to build and send, and its CPU and memory. Reports to
// run.mjs once a second.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

// The broadcast (WorldRoom.flush, every 100 ms): its own module instance, the
// same one the server is about to import.
const { WorldRoom } = await import('../../packages/server/src/rooms/WorldRoom.js');
let flushes = [];
const flush = WorldRoom.prototype.flush;
WorldRoom.prototype.flush = function timedFlush() {
  const start = performance.now();
  try {
    return flush.call(this);
  } finally {
    flushes.push(performance.now() - start);
  }
};

const ms = (ns) => ns / 1e6;
let cpuAt = process.cpuUsage();
let wallAt = performance.now();
setInterval(() => {
  const cpu = process.cpuUsage(cpuAt);
  const wall = performance.now() - wallAt;
  cpuAt = process.cpuUsage();
  wallAt = performance.now();
  const { heapUsed, rss } = process.memoryUsage();
  process.send?.({
    type: 'probe',
    cores: (cpu.user + cpu.system) / 1000 / wall,
    loop: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) },
    flushes,
    heapMB: heapUsed / 1048576,
    rssMB: rss / 1048576,
  });
  loop.reset();
  flushes = [];
}, 1000).unref();
