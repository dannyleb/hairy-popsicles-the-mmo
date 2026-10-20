import colyseus from 'colyseus';
import {
  CHARACTER_BY_ID,
  CHAT_COOLDOWN_MS,
  CHAT_MAX,
  EMOTE_BY_ID,
  EMOTE_COOLDOWN_MS,
  NAME_MAX,
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
import { advance, dropImpossible, topUp } from '../game/quests.js';
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
    on('sync', (p, m, client) => this.sendWorld(p, client));

    this.clock.setInterval(() => this.flush(), BROADCAST_MS);
    this.clock.setInterval(() => this.tick(), TICK_MS);
  }

  onJoin(client, options) {
    // Everyone starts with one common character, so they have an avatar and a first album entry.
    const starter = randomCommon();
    const player = {
      id: client.sessionId,
      name: String(options?.name ?? '').trim().slice(0, NAME_MAX) || `Guest${Math.floor(Math.random() * 10000)}`,
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
      lastChatAt: 0,
      lastEmoteAt: 0,
      lastHitAt: 0,
      away: false,
    };
    this.players[client.sessionId] = player;
    console.log(`join ${player.id} ${player.name} (${this.clients.length} here)`);
    topUp(player, this.othersPresent(player));
    this.sendWorld(player, client);
    this.markDirty();
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
        await this.allowReconnection(client, RECONNECT_SECONDS);
        player.away = false;
        this.markDirty();
        console.log(`back ${player.id} ${player.name}`);
        return;
      } catch {
        // Didn't come back in time.
      }
    }
    delete this.players[client.sessionId];
    console.log(`left ${client.sessionId} ${player?.name ?? ''}`);
    // Without persistence an abandoned plot can never be tended again, so it goes too.
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

  sendWorld(player, client) {
    client.send('init', this.snapshot());
    client.send('chatLog', this.chatLog);
    this.sendMe(player);
  }

  sendMe(player) {
    const { currency, xp, level, collection, inventory, quests } = player;
    this.clientOf(player)?.send('me', { currency, xp, level, collection, inventory, quests });
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
    if (owner) this.clientOf(owner)?.send('tended', { by: player.name, characterId: crop.characterId });
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
