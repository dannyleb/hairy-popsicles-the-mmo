// A load-test worker: runs many bots in one process, each playing like a person
// on a phone (see run.mjs, which starts these and adds up what they report).
//
// A bot joins, claims a plot, plants and harvests, squeezes neighbors' crops,
// wanders about, chats and emotes now and then, and piles onto The Boil while
// it's up, tapping a few times a second. A fifth of them mostly stand about.
//
// Every bot counts the bytes it's sent (that's the server's egress) and times
// how long its own moves take to show up in the world (that's lag as a player
// feels it). Bots only decode the world a few times a second, not every
// broadcast, so a worker can keep up with a crowd: the bytes are counted either way.
import WebSocket from 'ws';
import {
  EMOTES, PLOT_PX, PLOT_SIZE, REACH, WORLD_HEIGHT_PLOTS, WORLD_PX, WORLD_WIDTH_PLOTS, holeOpen, isReservedPlot, levelFor, slotCenter, travelMs,
} from '@hptm/shared';

// The ws library, not Node's built-in WebSocket: lighter with hundreds of sockets.
globalThis.WebSocket = WebSocket;
const { Client, Room } = await import('colyseus.js');

const URL = process.env.LOAD_URL;
const RETURNING = process.env.LOAD_RETURNING === '1';  // half the bots bring a level-5 save (needs the server's PROFILE_SECRET)
const THINK_MS = 250;
const DECODE_EVERY_MS = 400;   // a bot looks at the world this often (or sooner, waiting on its own move)
const ECHO_TIMEOUT_MS = 5000;  // a move not seen back by then counts as lost
const HIT_EVERY_MS = [180, 300];  // tapping The Boil
const TAP_MS = [450, 900];        // between taps on your own plot
const WANDER_MS = [3000, 9000];
const LURKER_WANDER_MS = [15000, 40000];
const CHAT_MS = [45_000, 150_000];
const EMOTE_MS = [30_000, 90_000];
const LINES = ['hi', 'anyone got a boil seed', 'this game is gross lol', 'nice plot', 'squeeze mine pls', 'brb', 'gg', 'where is the stray', 'ew', 'lol'];
// What a bot needs decoded; everything else is only counted.
const WANTED = new Set(['init', 'state', 'me']);
const ROOM_DATA = 13;  // colyseus Protocol.ROOM_DATA

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = ([a, b]) => rand(a, b);

let saveToken = null;
let xpForLevel5 = 0;
if (RETURNING) {
  ({ saveToken } = await import('../../packages/server/src/game/profile.js'));
  while (levelFor(xpForLevel5) < 5) xpForLevel5 += 10;
}

// ---------- what this worker reports each second ----------

const totals = { joins: 0, joinFails: 0, disconnects: 0, bytes: 0, messages: 0, maxMessage: 0, moves: 0, echoTimeouts: 0 };
let actions = {};  // what the bots sent, by type
let latencies = [];
let gaps = [];
const errors = new Map();  // message → count
const noteError = (text) => errors.set(text, (errors.get(text) ?? 0) + 1);

// Every message passes through here first: counted always, decoded only if this
// bot wants it right now. (The stock handler copies each message into an array
// of numbers before decoding it, far too slow to do for every broadcast.)
const stock = Room.prototype.onMessageCallback;
Room.prototype.onMessageCallback = function (event) {
  const bytes = new Uint8Array(event.data);
  totals.bytes += bytes.length;
  totals.messages += 1;
  if (bytes.length > totals.maxMessage) totals.maxMessage = bytes.length;
  if (bytes[0] === ROOM_DATA && (bytes[1] & 0xe0) === 0xa0) {
    const length = bytes[1] & 0x1f;
    const type = String.fromCharCode(...bytes.subarray(2, 2 + length));
    if (type === 'state') this.bot?.stateArrived();
    if (!WANTED.has(type) || (type === 'state' && !this.bot?.wantsWorld())) return;
  }
  return stock.call(this, event);
};

// ---------- a bot ----------

class Bot {
  constructor(index) {
    this.index = index;
    this.name = `Bot${index}`;
    this.lurker = Math.random() < 0.2;
    this.world = null;
    this.me = null;
    this.offset = 0;  // server clock minus ours
    this.plotKey = null;
    this.tried = new Map();  // plots tried for: key → when
    this.busyUntil = 0;
    this.goal = null;
    this.pendingMove = null;
    this.lastDecode = 0;
    this.lastState = 0;
    this.nextWander = Date.now() + between(this.lurker ? LURKER_WANDER_MS : WANDER_MS);
    this.nextChat = Date.now() + between(CHAT_MS);
    this.nextEmote = Date.now() + between(EMOTE_MS);
    this.nextHit = 0;
    this.left = false;
  }

  async join() {
    const options = { name: this.name };
    if (RETURNING && this.index % 2 === 0) options.profile = this.returningSave();
    try {
      this.room = await new Client(URL).joinOrCreate('world', options);
    } catch (error) {
      totals.joinFails += 1;
      noteError(`join: ${error.message ?? error}`);
      return false;
    }
    totals.joins += 1;
    this.room.bot = this;
    this.id = this.room.sessionId;
    this.room.onMessage('*', () => {});
    this.room.onMessage('init', (state) => this.see(state));
    this.room.onMessage('state', (state) => this.see(state));
    this.room.onMessage('me', (me) => { this.me = me; });
    this.room.onLeave((code) => {
      if (!this.left) {
        totals.disconnects += 1;
        noteError(`disconnected (${code})`);
      }
      clearInterval(this.timer);
    });
    this.room.send('sync');
    this.timer = setInterval(() => this.think(), THINK_MS);
    return true;
  }

  returningSave() {
    return saveToken({
      profileId: `load-${process.pid}-${this.index}`, name: this.name, avatar: 'droopy', xp: xpForLevel5, currency: 150,
      collection: { droopy: 2, mirror: 1 }, shinies: {}, inventory: { boil: 0, fertilizer: 0, teeth: 0 }, quests: [],
      daily: { last: null, streak: 0 }, dailyQuest: null, stats: {}, titles: [], title: null, rows: [], colors: [], nameColor: null,
      inviteLog: { day: null, count: 0, paid: [] }, startedAt: Date.now(),
    }, null, null);
  }

  leave() {
    this.left = true;
    clearInterval(this.timer);
    return this.room?.leave(true).catch(() => {});
  }

  // ---- what it sees

  stateArrived() {
    const now = Date.now();
    if (this.lastState) gaps.push(now - this.lastState);
    this.lastState = now;
  }

  wantsWorld() {
    return Boolean(this.pendingMove) || Date.now() - this.lastDecode >= DECODE_EVERY_MS;
  }

  see(state) {
    const now = Date.now();
    this.lastDecode = now;
    if (state.serverNow) this.offset = state.serverNow - now;
    // A state without plots means the plots haven't changed.
    this.world = { ...state, plots: state.plots ?? this.world?.plots ?? {} };
    const mine = state.players?.[this.id];
    const move = this.pendingMove;
    if (mine && move && mine.x === move.x && mine.y === move.y) {
      latencies.push(now - move.at);
      this.pendingMove = null;
    }
    if (!this.plotKey) {
      const own = Object.entries(this.world.plots).find(([, plot]) => plot.ownerId === this.id);
      if (own) this.plotKey = own[0];
    }
  }

  // ---- what it does

  send(type, message) {
    actions[type] = (actions[type] ?? 0) + 1;
    try {
      this.room.send(type, message);
    } catch (error) {
      noteError(`send: ${error.message}`);
    }
  }

  walk(x, y) {
    const me = this.world.players[this.id];
    const to = { x: Math.round(Math.min(WORLD_PX, Math.max(0, x))), y: Math.round(Math.min(WORLD_PX, Math.max(0, y))) };
    if (this.pendingMove && Date.now() - this.pendingMove.at > ECHO_TIMEOUT_MS) totals.echoTimeouts += 1;
    this.pendingMove = { ...to, at: Date.now() };
    this.send('move', to);
    totals.moves += 1;
    const ms = travelMs(Math.hypot(to.x - me.x, to.y - me.y));
    this.arrivesAt = Date.now() + ms;
    return ms;
  }

  think() {
    const now = Date.now();
    const me = this.world?.players?.[this.id];
    if (!me || !this.me) return;
    if (this.pendingMove && now - this.pendingMove.at > ECHO_TIMEOUT_MS) {
      totals.echoTimeouts += 1;
      this.pendingMove = null;
    }
    if (now >= this.nextChat) {
      this.nextChat = now + between(CHAT_MS);
      this.send('chat', { text: pick(LINES) });
    }
    if (now >= this.nextEmote) {
      this.nextEmote = now + between(EMOTE_MS);
      this.send('emote', { emote: pick(EMOTES).id });
    }
    if (now < this.busyUntil) return;

    // The Boil: everyone runs over and taps.
    const boss = this.world.boss;
    if (boss && boss.hp > 0 && !this.lurker) {
      if (Math.hypot(me.x - boss.x, me.y - boss.y) > REACH - 40) {
        this.busyUntil = now + this.walk(boss.x + rand(-90, 90), boss.y + rand(20, 90));
        return;
      }
      if (now >= this.nextHit && now >= this.arrivesAt) {
        this.nextHit = now + between(HIT_EVERY_MS);
        this.send('hitBoss');
      }
      return;
    }
    if (this.goal) return this.pursue(now, me);
    if (!this.plotKey) return this.claim(now, me);
    if (!this.lurker && this.farm(now)) return;
    if (now >= this.nextWander) {
      this.nextWander = now + between(this.lurker ? LURKER_WANDER_MS : WANDER_MS);
      if (!this.lurker && Math.random() < 0.3 && this.squeezeSomeone(me)) return;
      const [px, py] = this.plotKey.split(',').map(Number);
      this.busyUntil = now + this.walk((px + 0.5) * PLOT_PX + rand(-260, 260), (py + 0.5) * PLOT_PX + rand(-200, 260));
    }
  }

  // The nearest free plot: walk to its front edge and claim it.
  claim(now, me) {
    if (this.tried.size && now - Math.max(...this.tried.values()) < 2000) return;
    let best = null;
    for (let py = 0; py < WORLD_HEIGHT_PLOTS; py++) {
      for (let px = 0; px < WORLD_WIDTH_PLOTS; px++) {
        const key = `${px},${py}`;
        if (this.world.plots[key] || isReservedPlot(key) || this.tried.has(key)) continue;
        const d = Math.hypot((px + 0.5) * PLOT_PX - me.x, (py + 0.5) * PLOT_PX - me.y);
        if (!best || d < best.d) best = { key, px, py, d };
      }
    }
    if (!best) return;
    this.tried.set(best.key, now);
    this.busyUntil = now + this.walk((best.px + 0.5) * PLOT_PX, (best.py + 1) * PLOT_PX + 26);
    this.send('claimPlot', { plotX: best.px, plotY: best.py });
  }

  // Harvest what's ripe, then plant the empty holes, a tap at a time.
  farm(now) {
    const plot = this.world.plots[this.plotKey];
    if (!plot) {
      this.plotKey = null;
      return false;
    }
    const serverNow = now + this.offset;
    const ripe = plot.slots.findIndex((s) => s && s.readyAt <= serverNow);
    if (ripe >= 0) {
      this.send('harvest', { plotKey: this.plotKey, slot: ripe });
      plot.slots[ripe] = null;  // (till the server's word comes back)
      this.busyUntil = now + between(TAP_MS);
      return true;
    }
    const empty = plot.slots.findIndex((s, slot) => !s && holeOpen(slot, this.me.level));
    if (empty >= 0 && this.me.currency >= 5) {
      this.send('plant', { plotKey: this.plotKey, slot: empty, seed: 'pimple' });
      plot.slots[empty] = { readyAt: Infinity };
      this.me.currency -= 5;
      this.busyUntil = now + between(TAP_MS);
      return true;
    }
    return false;
  }

  // Off to squeeze a neighbor's growing crop.
  squeezeSomeone(me) {
    const serverNow = Date.now() + this.offset;
    const pid = me.pid;
    for (const [plotKey, plot] of Object.entries(this.world.plots)) {
      if (plot.ownerId === this.id) continue;
      for (let slot = 0; slot < PLOT_SIZE * PLOT_SIZE; slot++) {
        const crop = plot.slots[slot];
        if (!crop || crop.readyAt <= serverNow || crop.tendedBy.includes(pid) || crop.tendedBy.length >= 3) continue;
        const at = slotCenter(plotKey, slot);
        if (Math.hypot(at.x - me.x, at.y - me.y) > 700) continue;
        this.goal = { plotKey, slot, at };
        this.busyUntil = Date.now() + this.walk(at.x + rand(-40, 40), at.y + 50);
        return true;
      }
    }
    return false;
  }

  pursue(now) {
    const { plotKey, slot } = this.goal;
    this.goal = null;
    if (now < this.arrivesAt) return;
    this.send('tend', { plotKey, slot });
    this.busyUntil = now + between(TAP_MS);
  }
}

// ---------- the worker ----------

const bots = [];
let reportedCpu = process.cpuUsage();
let reportedAt = Date.now();

process.on('message', async (command) => {
  if (command.type === 'add') {
    for (const index of command.indexes) {
      const bot = new Bot(index);
      bots.push(bot);
      bot.join();  // (not awaited: joins overlap, as players' do)
    }
  } else if (command.type === 'stop') {
    clearInterval(reporter);
    await Promise.all(bots.map((bot) => bot.leave()));
    process.exit(0);
  }
});

const reporter = setInterval(() => {
  const now = Date.now();
  const cpu = process.cpuUsage(reportedCpu);
  const cores = (cpu.user + cpu.system) / 1000 / (now - reportedAt);
  reportedCpu = process.cpuUsage();
  reportedAt = now;
  const connected = bots.filter((bot) => bot.room && !bot.left && bot.room.connection?.isOpen).length;
  process.send({
    type: 'metrics', connected, ...totals, latencies, gaps, cores, actions, errors: Object.fromEntries(errors),
  });
  actions = {};
  Object.assign(totals, { joins: 0, joinFails: 0, disconnects: 0, bytes: 0, messages: 0, maxMessage: 0, moves: 0, echoTimeouts: 0 });
  latencies = [];
  gaps = [];
  errors.clear();
}, 1000);
