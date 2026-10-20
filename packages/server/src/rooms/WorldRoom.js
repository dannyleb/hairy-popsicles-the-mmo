import colyseus from 'colyseus';
import {
  CHARACTERS,
  CHARACTER_BY_ID,
  PLOT_SIZE,
  RARITIES,
  SEED_COST,
  STARTING_CURRENCY,
  WORLD_HEIGHT_PLOTS,
  WORLD_WIDTH_PLOTS,
} from '@hptm/shared';

const { Room } = colyseus;

// Speeds up every grow timer for local testing, e.g. GROW_SCALE=0.01.
const GROW_SCALE = Number(process.env.GROW_SCALE) || 1;
const NAME_MAX = 20;

const BY_RARITY = Object.fromEntries(
  Object.keys(RARITIES).map((r) => [r, CHARACTERS.filter((c) => c.rarity === r)]),
);
const TOTAL_WEIGHT = Object.values(RARITIES).reduce((sum, r) => sum + r.weight, 0);

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rollCharacter() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const [rarity, { weight }] of Object.entries(RARITIES)) {
    roll -= weight;
    if (roll < 0) return pick(BY_RARITY[rarity]);
  }
  return pick(BY_RARITY.common);
}

// v1: state is a plain object, broadcast in full on every change via room.broadcast().
// Fine at small scale. Once there are enough concurrent players that full-state
// broadcasts get expensive, swap this for @colyseus/schema's delta-encoded state sync.
export class WorldRoom extends Room {
  maxClients = 200;

  onCreate() {
    this.players = {};
    this.plots = {};

    this.onMessage('move', (client, { x, y }) => {
      const player = this.players[client.sessionId];
      if (!player || typeof x !== 'number' || typeof y !== 'number') return;
      player.x = x;
      player.y = y;
      this.broadcastState();
    });

    this.onMessage('claimPlot', (client, { plotX, plotY }) => this.handleClaimPlot(client, plotX, plotY));
    this.onMessage('plant', (client, { plotKey, slot }) => this.handlePlant(client, plotKey, slot));
    this.onMessage('harvest', (client, { plotKey, slot }) => this.handleHarvest(client, plotKey, slot));
    this.onMessage('setAvatar', (client, { characterId }) => this.handleSetAvatar(client, characterId));
  }

  onJoin(client, options) {
    // Everyone starts with one common character, so they have an avatar and a first album entry.
    const starter = pick(BY_RARITY.common);
    this.players[client.sessionId] = {
      id: client.sessionId,
      name: String(options?.name ?? '').slice(0, NAME_MAX) || `Guest${Math.floor(Math.random() * 10000)}`,
      // Somewhere on screen on any phone, below the help text.
      x: 60 + Math.random() * 240,
      y: 180 + Math.random() * 200,
      currency: STARTING_CURRENCY,
      avatar: starter.id,
      collection: { [starter.id]: 1 },
    };
    client.send('init', this.snapshot());
    this.broadcastState();
  }

  onLeave(client) {
    delete this.players[client.sessionId];
    this.broadcastState();
  }

  ownedPlot(client, plotKey, slot) {
    const plot = this.plots[plotKey];
    if (!plot || plot.ownerId !== client.sessionId) return null;
    if (!Number.isInteger(slot) || slot < 0 || slot >= plot.slots.length) return null;
    return plot;
  }

  handleClaimPlot(client, plotX, plotY) {
    if (!Number.isInteger(plotX) || !Number.isInteger(plotY)) return;
    if (plotX < 0 || plotY < 0 || plotX >= WORLD_WIDTH_PLOTS || plotY >= WORLD_HEIGHT_PLOTS) return;

    const key = `${plotX},${plotY}`;
    if (this.plots[key]) return; // already claimed

    const player = this.players[client.sessionId];
    if (!player) return;
    if (Object.values(this.plots).some((p) => p.ownerId === client.sessionId)) return; // one plot per player

    this.plots[key] = {
      ownerId: client.sessionId,
      ownerName: player.name,
      slots: Array.from({ length: PLOT_SIZE * PLOT_SIZE }, () => null),
    };
    this.broadcastState();
  }

  handlePlant(client, plotKey, slot) {
    const player = this.players[client.sessionId];
    const plot = this.ownedPlot(client, plotKey, slot);
    if (!player || !plot || plot.slots[slot]) return;
    if (player.currency < SEED_COST) return;

    // Rolled at planting so the grow time can depend on rarity; clients see a
    // silhouette of it while it grows.
    const character = rollCharacter();
    const now = Date.now();
    player.currency -= SEED_COST;
    plot.slots[slot] = {
      characterId: character.id,
      plantedAt: now,
      readyAt: now + RARITIES[character.rarity].growMs * GROW_SCALE,
    };
    this.broadcastState();
  }

  handleHarvest(client, plotKey, slot) {
    const player = this.players[client.sessionId];
    const plot = this.ownedPlot(client, plotKey, slot);
    if (!player || !plot) return;

    const planted = plot.slots[slot];
    if (!planted || Date.now() < planted.readyAt) return;

    const { characterId } = planted;
    const scraps = RARITIES[CHARACTER_BY_ID[characterId].rarity].scraps;
    const isNew = !player.collection[characterId];
    player.collection[characterId] = (player.collection[characterId] ?? 0) + 1;
    player.currency += scraps;
    plot.slots[slot] = null;

    client.send('harvested', { characterId, scraps, isNew });
    this.broadcastState();
  }

  handleSetAvatar(client, characterId) {
    const player = this.players[client.sessionId];
    if (!player || !Object.hasOwn(player.collection, characterId)) return;
    player.avatar = characterId;
    this.broadcastState();
  }

  snapshot() {
    // serverNow lets clients correct for their own clock being off when showing grow progress.
    return { players: this.players, plots: this.plots, serverNow: Date.now() };
  }

  broadcastState() {
    this.broadcast('state', this.snapshot());
  }
}
