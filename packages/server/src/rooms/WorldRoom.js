import colyseus from 'colyseus';
import {
  ITEM_DEFS,
  PLOT_SIZE,
  STARTING_CURRENCY,
  WORLD_HEIGHT_PLOTS,
  WORLD_WIDTH_PLOTS,
} from '@hptm/shared';

const { Room } = colyseus;

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
    this.onMessage('plant', (client, { plotKey, slot, itemId }) => this.handlePlant(client, plotKey, slot, itemId));
    this.onMessage('harvest', (client, { plotKey, slot }) => this.handleHarvest(client, plotKey, slot));
  }

  onJoin(client, options) {
    this.players[client.sessionId] = {
      id: client.sessionId,
      name: options?.name || `Guest${Math.floor(Math.random() * 10000)}`,
      x: 0,
      y: 0,
      currency: STARTING_CURRENCY,
    };
    client.send('init', this.snapshot());
    this.broadcastState();
  }

  onLeave(client) {
    delete this.players[client.sessionId];
    this.broadcastState();
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

  handlePlant(client, plotKey, slot, itemId) {
    const plot = this.plots[plotKey];
    const player = this.players[client.sessionId];
    const def = ITEM_DEFS[itemId];
    if (!plot || !player || !def) return;
    if (plot.ownerId !== client.sessionId) return;
    if (slot < 0 || slot >= plot.slots.length) return;
    if (plot.slots[slot]) return; // occupied
    if (player.currency < def.cost) return;

    player.currency -= def.cost;
    plot.slots[slot] = { itemId, plantedAt: Date.now() };
    this.broadcastState();
  }

  handleHarvest(client, plotKey, slot) {
    const plot = this.plots[plotKey];
    const player = this.players[client.sessionId];
    if (!plot || !player) return;
    if (plot.ownerId !== client.sessionId) return;

    const planted = plot.slots[slot];
    if (!planted) return;
    const def = ITEM_DEFS[planted.itemId];
    if (!def) return;
    if (Date.now() - planted.plantedAt < def.growMs) return; // not grown yet

    const yieldAmount = Math.floor(def.yieldMin + Math.random() * (def.yieldMax - def.yieldMin));
    player.currency += yieldAmount;
    plot.slots[slot] = null;
    this.broadcastState();
  }

  snapshot() {
    return { players: this.players, plots: this.plots };
  }

  broadcastState() {
    this.broadcast('state', this.snapshot());
  }
}
