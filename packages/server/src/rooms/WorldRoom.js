import colyseus from 'colyseus';
import {
  CHARACTER_BY_ID,
  CHAT_COOLDOWN_MS,
  CHAT_MAX,
  EMOTE_BY_ID,
  EMOTE_COOLDOWN_MS,
  PLOT_SIZE,
  RARITIES,
  RARITY_ORDER,
  REACH,
  SEED_BY_ID,
  STARTING_CURRENCY,
  TEND_MAX,
  TEND_SCRAPS,
  TEND_SHARE,
  TILE_SIZE,
  WORLD_HEIGHT_PLOTS,
  WORLD_PX,
  WORLD_WIDTH_PLOTS,
  XP,
  holeOpen,
  levelFor,
} from '@hptm/shared';
import { createBoss } from '../game/boss.js';
import { checkIn } from '../game/daily.js';
import { cleanName, newProfileId, readToken, saveToken } from '../game/profile.js';
import { advance, dropImpossible, restoreQuests, topUp } from '../game/quests.js';
import { randomCommon, rollCharacter } from '../game/roll.js';

const { Room } = colyseus;

// Speed up timers for local testing, e.g. GROW_SCALE=0.01 EVENT_SCALE=0.01.
const GROW_SCALE = Number(process.env.GROW_SCALE) || 1;
const EVENT_SCALE = Number(process.env.EVENT_SCALE) || 1;

const SPAWN_SPREAD = 400;
const BROADCAST_MS = 100;
const TICK_MS = 1000;
const CHAT_LOG = 30;
const RECONNECT_SECONDS = 90;
const SAVE_MS = 2000;            // a player's save goes out at most this often
const WELCOME_AFTER_MS = 60_000; // away at least this long to get a "welcome back"
const REPLACED = 4001;           // close code: the same save was opened somewhere else
const ANNOUNCE_LEVELS = 5;  // announce every 5th level
const BLOOD_MOON = { firstMs: 150_000, everyMs: 9 * 60_000, lastsMs: 90_000 };

const rank = (characterId) => RARITY_ORDER.indexOf(CHARACTER_BY_ID[characterId].rarity);

// v1: state is a plain object broadcast in full when it changes (at most every
// BROADCAST_MS). Per-player data (scraps, collection, quests) goes only to that
// player. Swap for @colyseus/schema delta sync once crowds make this expensive.
export class WorldRoom extends Room {
  maxClients = 200;

  onCreate() {
    this.players = {};
    this.plots = {};
    this.chatLog = [];
    this.dirty = false;
    this.boss = createBoss(this, EVENT_SCALE);
    this.bloodMoon = null;
    this.nextBloodMoon = Date.now() + BLOOD_MOON.firstMs * EVENT_SCALE;

    const on = (type, handler) => this.onMessage(type, (client, message) => {
      const player = this.players[client.sessionId];
      if (player) handler(player, message ?? {}, client);
    });
    on('move', (p, m) => this.handleMove(p, m));
    on('claimPlot', (p, m) => this.handleClaimPlot(p, m));
    on('plant', (p, m) => this.handlePlant(p, m));
    on('harvest', (p, m) => this.handleHarvest(p, m));
    on('tend', (p, m) => this.handleTend(p, m));
    on('setAvatar', (p, m) => this.handleSetAvatar(p, m));
    on('chat', (p, m) => this.handleChat(p, m));
    on('emote', (p, m) => this.handleEmote(p, m));
    on('hitBoss', (p) => this.handleHitBoss(p));
    on('sync', (p, m, client) => this.sendWorld(p, client, true));

    this.clock.setInterval(() => this.flush(), BROADCAST_MS);
    this.clock.setInterval(() => this.tick(), TICK_MS);
  }

  onJoin(client, options) {
    const save = readToken(options?.profile);
    // The same save already in the world (a reload, a second tab, or a dropped
    // phone coming back as a new connection): carry on as that player.
    const existing = save && Object.values(this.players).find((p) => p.profileId === save.id);
    const player = existing ? this.takeOver(existing, client) : this.createPlayer(client, save);
    const name = cleanName(options?.name);
    if (name) this.rename(player, name);

    const daily = checkIn(player.daily, Date.now());
    if (daily) {
      player.currency += daily.reward.scraps ?? 0;
      player.inventory.boil += daily.reward.boil ?? 0;
      player.notices.push({ kind: 'daily', ...daily });
    }
    console.log(`join ${player.id} ${player.name}${save ? ' (saved)' : ''} (${this.clients.length} here)`);
    topUp(player, this.othersPresent(player));
    player.saveDirty = true;
    this.sendWorld(player, client);
    this.markDirty();
  }

  createPlayer(client, save) {
    // Everyone starts with one common character, so they have an avatar and a first album entry.
    const starter = randomCommon();
    const player = {
      id: client.sessionId,
      profileId: save?.id ?? newProfileId(),
      name: save?.name || `Guest${Math.floor(Math.random() * 10000)}`,
      // Near the middle of the world, so new players land near each other.
      x: WORLD_PX / 2 + (Math.random() - 0.5) * SPAWN_SPREAD,
      y: WORLD_PX / 2 + (Math.random() - 0.5) * SPAWN_SPREAD,
      avatar: starter.id,
      level: 1,
      xp: 0,
      currency: STARTING_CURRENCY,
      collection: { [starter.id]: 1 },
      inventory: { boil: 0 },
      quests: [],
      daily: { last: null, streak: 0 },
      notices: [],         // shown once the client is listening ('sync')
      saveDirty: true,
      lastSaveAt: 0,
      reconnection: null,  // while away: the pending reconnection, so a takeover can cancel it
      lastChatAt: 0,
      lastEmoteAt: 0,
      lastHitAt: 0,
      away: false,
    };
    if (save) {
      Object.assign(player, {
        xp: save.xp,
        level: save.level,
        currency: save.currency,
        inventory: save.inventory,
        quests: restoreQuests(save.quests),
        daily: save.daily,
      });
      if (Object.keys(save.collection).length) {
        player.collection = save.collection;
        player.avatar = save.avatar;
      }
    }
    this.players[player.id] = player;
    if (save?.plot) this.restorePlot(player, save);
    return player;
  }

  // Put a saved plot back, where it was if nobody has taken the spot. Crops
  // kept growing while the player was away.
  restorePlot(player, save) {
    const key = this.freePlotNear(save.plot.key);
    if (!key) return;
    this.plots[key] = { ownerId: player.id, ownerName: player.name, slots: save.plot.slots };
    const [px, py] = key.split(',').map(Number);
    const plotPx = PLOT_SIZE * TILE_SIZE;
    player.x = px * plotPx + plotPx / 2;
    player.y = (py + 1) * plotPx + 26;

    const now = Date.now();
    const crops = save.plot.slots.filter(Boolean);
    if (save.savedAt && now - save.savedAt >= WELCOME_AFTER_MS * GROW_SCALE) {
      const ripe = crops.filter((c) => c.readyAt <= now).length;
      player.notices.push({ kind: 'welcome', awayMs: now - save.savedAt, ripe, growing: crops.length - ripe });
    }
  }

  freePlotNear(key) {
    const [x0, y0] = String(key).split(',').map(Number);
    if (!Number.isInteger(x0) || !Number.isInteger(y0)) return null;
    const inside = (x, y) => x >= 0 && y >= 0 && x < WORLD_WIDTH_PLOTS && y < WORLD_HEIGHT_PLOTS;
    for (let r = 0; r < Math.max(WORLD_WIDTH_PLOTS, WORLD_HEIGHT_PLOTS); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx;
          const y = y0 + dy;
          if (inside(x, y) && !this.plots[`${x},${y}`]) return `${x},${y}`;
        }
      }
    }
    return null;
  }

  // Move a player already in the world onto a new connection, and close the old one.
  takeOver(player, client) {
    const oldId = player.id;
    const newId = client.sessionId;
    player.reconnection?.reject?.();
    this.clients.getById(oldId)?.leave(REPLACED);
    delete this.players[oldId];
    Object.assign(player, { id: newId, away: false, reconnection: null });
    this.players[newId] = player;
    for (const plot of Object.values(this.plots)) {
      if (plot.ownerId === oldId) plot.ownerId = newId;
      for (const crop of plot.slots) {
        const i = crop ? crop.tendedBy.indexOf(oldId) : -1;
        if (i >= 0) crop.tendedBy[i] = newId;
      }
    }
    return player;
  }

  rename(player, name) {
    player.name = name;
    for (const plot of Object.values(this.plots)) {
      if (plot.ownerId === player.id) plot.ownerName = name;
    }
  }

  async onLeave(client, consented) {
    // Phones drop the socket whenever the app goes to the background; hold the
    // player (and their plot) for a while so they can pick up where they left off.
    const player = this.players[client.sessionId];
    if (!consented && player) {
      player.away = true;
      this.markDirty();
      console.log(`drop ${player.id} ${player.name}`);
      try {
        // The returning client asks for a fresh copy of everything with 'sync'.
        player.reconnection = this.allowReconnection(client, RECONNECT_SECONDS);
        await player.reconnection;
        player.reconnection = null;
        player.away = false;
        this.markDirty();
        console.log(`back ${player.id} ${player.name}`);
        return;
      } catch {
        // Didn't come back in time.
      }
    }
    // Taken over by a new connection: the player lives on under another id.
    if (!player || this.players[client.sessionId] !== player) return;
    delete this.players[client.sessionId];
    console.log(`left ${client.sessionId} ${player.name}`);
    // The plot is in their save and comes back with them.
    for (const [key, plot] of Object.entries(this.plots)) {
      if (plot.ownerId === client.sessionId) delete this.plots[key];
    }
    // Quests that need a neighbor are impossible if the last neighbor just left.
    for (const other of Object.values(this.players)) {
      if (dropImpossible(other, this.othersPresent(other))) {
        topUp(other, false);
        this.sendMe(other);
      }
    }
    this.markDirty();
  }

  // ---------- helpers ----------

  clientOf(player) {
    return this.clients.getById(player.id);
  }

  othersPresent(player) {
    return Object.values(this.plots).some((plot) => plot.ownerId !== player.id && this.players[plot.ownerId]);
  }

  markDirty() {
    this.dirty = true;
  }

  announce(text, kind) {
    this.broadcast('announce', { text, kind });
  }

  // `synced`: the client asked with 'sync', so it's listening for everything,
  // including notices and its save.
  sendWorld(player, client, synced = false) {
    client.send('init', this.snapshot());
    client.send('chatLog', this.chatLog);
    this.sendMe(player);
    if (!synced) return;
    for (const notice of player.notices) client.send('notice', notice);
    player.notices = [];
    this.sendSave(player);
  }

  sendMe(player) {
    const { currency, xp, level, collection, inventory, quests } = player;
    this.clientOf(player)?.send('me', { currency, xp, level, collection, inventory, quests });
    player.saveDirty = true;
  }

  plotOf(player) {
    return Object.entries(this.plots).find(([, plot]) => plot.ownerId === player.id) ?? [null, null];
  }

  sendSave(player) {
    const client = this.clientOf(player);
    if (!client) return;
    const [key, plot] = this.plotOf(player);
    client.send('save', { token: saveToken(player, plot, key) });
    player.saveDirty = false;
    player.lastSaveAt = Date.now();
  }

  grantXp(player, amount) {
    const before = player.level;
    player.xp += amount;
    player.level = levelFor(player.xp);
    if (player.level > before) {
      this.clientOf(player)?.send('levelUp', { level: player.level });
      if (player.level % ANNOUNCE_LEVELS === 0) this.announce(`${player.name} reached level ${player.level}!`, 'level');
      this.markDirty();
    }
  }

  progress(player, kind, amount = 1) {
    const done = advance(player, kind, amount);
    for (const quest of done) {
      player.currency += quest.scraps;
      this.clientOf(player)?.send('questDone', { text: quest.text, scraps: quest.scraps, xp: quest.xp });
      this.grantXp(player, quest.xp);
    }
    if (done.length) topUp(player, this.othersPresent(player));
  }

  slotCenter(plotKey, slot) {
    const [px, py] = plotKey.split(',').map(Number);
    const plotPx = PLOT_SIZE * TILE_SIZE;
    return {
      x: px * plotPx + (slot % PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2,
      y: py * plotPx + Math.floor(slot / PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  plotAt(plotKey, slot) {
    const plot = Object.hasOwn(this.plots, plotKey) ? this.plots[plotKey] : null;
    if (!plot || !Number.isInteger(slot) || slot < 0 || slot >= plot.slots.length) return null;
    return plot;
  }

  // ---------- handlers ----------

  handleMove(player, { x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    player.x = Math.min(WORLD_PX, Math.max(0, x));
    player.y = Math.min(WORLD_PX, Math.max(0, y));
    this.markDirty();
  }

  handleClaimPlot(player, { plotX, plotY }) {
    if (!Number.isInteger(plotX) || !Number.isInteger(plotY)) return;
    if (plotX < 0 || plotY < 0 || plotX >= WORLD_WIDTH_PLOTS || plotY >= WORLD_HEIGHT_PLOTS) return;
    const key = `${plotX},${plotY}`;
    if (this.plots[key]) return;
    if (Object.values(this.plots).some((p) => p.ownerId === player.id)) return; // one plot per player

    this.plots[key] = {
      ownerId: player.id,
      ownerName: player.name,
      slots: Array.from({ length: PLOT_SIZE * PLOT_SIZE }, () => null),
    };
    player.saveDirty = true;
    this.markDirty();
  }

  handlePlant(player, { plotKey, slot, seed = 'pimple' }) {
    const plot = this.plotAt(plotKey, slot);
    const seedDef = Object.hasOwn(SEED_BY_ID, seed) ? SEED_BY_ID[seed] : null;
    if (!plot || !seedDef || plot.ownerId !== player.id || plot.slots[slot]) return;
    if (!holeOpen(slot, player.level) || player.level < seedDef.level) return;
    if (seedDef.dropOnly) {
      if (!(player.inventory[seed] > 0)) return;
      player.inventory[seed] -= 1;
    } else {
      if (player.currency < seedDef.cost) return;
      player.currency -= seedDef.cost;
    }

    // Rolled at planting so the grow time can depend on rarity; clients see a
    // silhouette of it while it grows.
    const character = rollCharacter(seedDef, Boolean(this.bloodMoon));
    const now = Date.now();
    plot.slots[slot] = {
      characterId: character.id,
      seed,
      plantedAt: now,
      readyAt: now + RARITIES[character.rarity].growMs * GROW_SCALE,
      tendedBy: [],
    };
    this.grantXp(player, XP.plant);
    this.progress(player, 'plant');
    this.sendMe(player);
    this.markDirty();
  }

  handleHarvest(player, { plotKey, slot }) {
    const plot = this.plotAt(plotKey, slot);
    if (!plot || plot.ownerId !== player.id) return;
    const planted = plot.slots[slot];
    if (!planted || Date.now() < planted.readyAt) return;

    const { characterId } = planted;
    const character = CHARACTER_BY_ID[characterId];
    const rarity = RARITIES[character.rarity];
    const isNew = !player.collection[characterId];
    player.collection[characterId] = (player.collection[characterId] ?? 0) + 1;
    player.currency += rarity.scraps;
    plot.slots[slot] = null;

    const xp = XP.harvest[character.rarity];
    this.clientOf(player)?.send('harvested', { characterId, scraps: rarity.scraps, xp, isNew });
    if (rank(characterId) >= 2) this.announce(`${player.name} grew a ${rarity.label} ${character.name}!`, character.rarity);
    this.grantXp(player, xp);
    this.progress(player, 'harvest');
    if (rank(characterId) >= 1) this.progress(player, 'uncommon');
    if (rank(characterId) >= 2) this.progress(player, 'rare');
    if (isNew) this.progress(player, 'discover');
    this.sendMe(player);
    this.markDirty();
  }

  // Squeezing a neighbor's growing crop speeds it up; the squeezer gets a few scraps.
  handleTend(player, { plotKey, slot }) {
    const plot = this.plotAt(plotKey, slot);
    if (!plot || plot.ownerId === player.id) return;
    const crop = plot.slots[slot];
    const now = Date.now();
    if (!crop || now >= crop.readyAt) return;
    if (crop.tendedBy.includes(player.id) || crop.tendedBy.length >= TEND_MAX) return;
    const at = this.slotCenter(plotKey, slot);
    if (Math.hypot(player.x - at.x, player.y - at.y) > REACH) return;

    crop.readyAt -= (crop.readyAt - now) * TEND_SHARE;
    crop.tendedBy.push(player.id);
    player.currency += TEND_SCRAPS;
    this.broadcast('tend', { plotKey, slot, by: player.id });
    const owner = this.players[plot.ownerId];
    if (owner) {
      this.clientOf(owner)?.send('tended', { by: player.name, characterId: crop.characterId });
      owner.saveDirty = true;
    }
    this.clientOf(player)?.send('tendDone', { scraps: TEND_SCRAPS, xp: XP.tend, owner: plot.ownerName });
    this.grantXp(player, XP.tend);
    this.progress(player, 'tend');
    this.sendMe(player);
    this.markDirty();
  }

  handleSetAvatar(player, { characterId }) {
    if (typeof characterId !== 'string' || !Object.hasOwn(player.collection, characterId)) return;
    if (player.avatar === characterId) return;
    player.avatar = characterId;
    this.progress(player, 'wear');
    this.sendMe(player);
    this.markDirty();
  }

  handleChat(player, { text }) {
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_COOLDOWN_MS) return;
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!clean) return;
    player.lastChatAt = now;
    const line = { id: player.id, name: player.name, text: clean, at: now };
    this.chatLog.push(line);
    if (this.chatLog.length > CHAT_LOG) this.chatLog.shift();
    this.broadcast('chat', line);
    this.progress(player, 'chat');
    this.sendMe(player);
  }

  handleEmote(player, { emote }) {
    const now = Date.now();
    if (typeof emote !== 'string' || !Object.hasOwn(EMOTE_BY_ID, emote)) return;
    if (now - player.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    player.lastEmoteAt = now;
    this.broadcast('emote', { id: player.id, emote });
    this.progress(player, 'emote');
    this.sendMe(player);
  }

  handleHitBoss(player) {
    const damage = this.boss.hit(player, Date.now());
    if (!damage) return;
    this.grantXp(player, XP.bossHit * damage);
    this.progress(player, 'boss');
    this.sendMe(player);
  }

  rewardBoss(player, reward) {
    player.currency += reward.scraps;
    player.inventory.boil += reward.seeds;
    this.clientOf(player)?.send('bossReward', reward);
    this.grantXp(player, reward.xp);
    this.sendMe(player);
  }

  // ---------- time ----------

  tick() {
    const now = Date.now();
    this.boss.tick(now);
    if (!this.bloodMoon && now >= this.nextBloodMoon) {
      this.bloodMoon = { endsAt: now + BLOOD_MOON.lastsMs * EVENT_SCALE };
      this.announce('Blood Moon! Rare characters are sprouting everywhere.', 'bloodMoon');
      this.markDirty();
    } else if (this.bloodMoon && now >= this.bloodMoon.endsAt) {
      this.bloodMoon = null;
      this.nextBloodMoon = now + BLOOD_MOON.everyMs * EVENT_SCALE;
      this.announce('The Blood Moon sets.', 'bloodMoon');
      this.markDirty();
    }
  }

  flush() {
    const now = Date.now();
    for (const player of Object.values(this.players)) {
      if (player.saveDirty && !player.away && now - player.lastSaveAt >= SAVE_MS) this.sendSave(player);
    }
    const hp = this.boss.takeHpUpdate();
    if (hp) this.broadcast('bossHp', hp);
    if (!this.dirty) return;
    this.dirty = false;
    this.broadcast('state', this.snapshot());
  }

  snapshot() {
    const players = {};
    for (const p of Object.values(this.players)) {
      const album = Object.keys(p.collection);
      const best = album.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      players[p.id] = { id: p.id, name: p.name, x: p.x, y: p.y, avatar: p.avatar, level: p.level, album: album.length, best, away: p.away };
    }
    // serverNow lets clients correct for their own clock being off when showing grow progress.
    return { players, plots: this.plots, boss: this.boss.view(), bloodMoon: this.bloodMoon, serverNow: Date.now() };
  }
}
