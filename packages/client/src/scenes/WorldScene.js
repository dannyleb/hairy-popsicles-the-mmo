import Phaser from 'phaser';
import { ITEM_DEFS, PLOT_SIZE, TILE_SIZE } from '@hptm/shared';

const ITEM_COLORS = {
  wart_sprout: 0x9bbf59,
  pus_bloom: 0xd7d94a,
  popsicle_sapling: 0xe8847a,
};

const PLOT_PIXELS = TILE_SIZE * PLOT_SIZE;

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  init(data) {
    this.room = data.room;
  }

  create() {
    this.cameras.main.setBackgroundColor('#3a2128');
    this.playerSprites = new Map();
    this.plotGraphics = this.add.graphics();
    this.latestState = null;

    this.room.onMessage('init', (state) => this.applyState(state));
    this.room.onMessage('state', (state) => this.applyState(state));

    this.input.on('pointerdown', (pointer) => this.handleTap(pointer));

    this.add.text(12, 12, 'Tap ground to walk. First tap on empty ground claims your plot. Tap an empty tile in your plot to plant, a grown one to harvest.', {
      fontSize: '13px',
      color: '#ffe8d6',
      wordWrap: { width: Math.min(this.scale.width - 24, 480) },
    }).setDepth(100);

    this.hud = this.add.text(12, 76, '', { fontSize: '14px', color: '#ffe8d6' }).setDepth(100);
  }

  handleTap(pointer) {
    const x = pointer.worldX;
    const y = pointer.worldY;
    this.room.send('move', { x, y });

    const plotX = Math.floor(x / PLOT_PIXELS);
    const plotY = Math.floor(y / PLOT_PIXELS);
    const plotKey = `${plotX},${plotY}`;
    const plot = this.latestState?.plots?.[plotKey];

    if (!plot) {
      this.room.send('claimPlot', { plotX, plotY });
      return;
    }
    if (plot.ownerId !== this.room.sessionId) return;

    const localX = x - plotX * PLOT_PIXELS;
    const localY = y - plotY * PLOT_PIXELS;
    const col = Math.floor(localX / TILE_SIZE);
    const row = Math.floor(localY / TILE_SIZE);
    const slot = row * PLOT_SIZE + col;
    if (slot < 0 || slot >= plot.slots.length) return;

    if (plot.slots[slot]) {
      this.room.send('harvest', { plotKey, slot });
    } else {
      this.room.send('plant', { plotKey, slot, itemId: 'wart_sprout' });
    }
  }

  applyState(state) {
    this.latestState = state;
    this.redraw();
  }

  redraw() {
    if (!this.latestState) return;
    const { players, plots } = this.latestState;

    this.plotGraphics.clear();
    Object.entries(plots).forEach(([key, plot]) => {
      const [px, py] = key.split(',').map(Number);
      const worldX = px * PLOT_PIXELS;
      const worldY = py * PLOT_PIXELS;

      this.plotGraphics.lineStyle(2, 0xffe8d6, 0.6);
      this.plotGraphics.strokeRect(worldX, worldY, PLOT_PIXELS, PLOT_PIXELS);

      plot.slots.forEach((slotData, i) => {
        if (!slotData) return;
        const def = ITEM_DEFS[slotData.itemId];
        const ready = def ? Date.now() - slotData.plantedAt >= def.growMs : false;
        const col = i % PLOT_SIZE;
        const row = Math.floor(i / PLOT_SIZE);
        const color = ITEM_COLORS[slotData.itemId] ?? 0xffffff;

        this.plotGraphics.fillStyle(color, ready ? 1 : 0.35);
        this.plotGraphics.fillRect(
          worldX + col * TILE_SIZE + 4,
          worldY + row * TILE_SIZE + 4,
          TILE_SIZE - 8,
          TILE_SIZE - 8,
        );
      });
    });

    this.playerSprites.forEach((sprite, id) => {
      if (!players[id]) {
        sprite.destroy();
        this.playerSprites.delete(id);
      }
    });

    Object.values(players).forEach((p) => {
      let sprite = this.playerSprites.get(p.id);
      if (!sprite) {
        sprite = this.add.circle(p.x, p.y, 10, p.id === this.room.sessionId ? 0xffe0c2 : 0x8fb3c7).setDepth(10);
        this.playerSprites.set(p.id, sprite);
      } else {
        sprite.setPosition(p.x, p.y);
      }
    });

    const me = players[this.room.sessionId];
    if (me) {
      this.hud.setText(`${me.name} — ${me.currency} scraps`);
    }
  }

  update(time) {
    // Re-render ~1x/sec so grow-timer dimming updates even with no new messages.
    if (this.latestState && (!this._lastRedraw || time - this._lastRedraw > 1000)) {
      this._lastRedraw = time;
      this.redraw();
    }
  }
}
