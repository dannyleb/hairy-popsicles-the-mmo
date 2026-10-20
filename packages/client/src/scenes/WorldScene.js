import Phaser from 'phaser';
import { CHARACTER_BY_ID, PLOT_SIZE, RARITIES, SEED_COST, TILE_SIZE } from '@hptm/shared';
import { DPR } from '../display.js';
import { createHud } from '../ui/hud.js';

const PLOT_PIXELS = TILE_SIZE * PLOT_SIZE;
// Character textures are squares with the character standing on the bottom edge.
const AVATAR_SIZE = 64;
const CROP_SIZE = 56;
const SOIL = 0x2a161c;
const SILHOUETTE = 0x120a0d;
const TEXT = '#ffe8d6';
const FONT = 'system-ui, sans-serif';
const textStyle = (size, color = TEXT) => ({ fontFamily: FONT, fontSize: `${size}px`, color, resolution: DPR });
const HUD_DEPTH = 100_000;

function formatLeft(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  init(data) {
    this.room = data.room;
  }

  create() {
    this.cameras.main.setBackgroundColor('#3a2128').setZoom(DPR).setOrigin(0, 0);
    this.ground = this.add.graphics();
    this.avatars = new Map();
    this.crops = new Map();
    this.labels = new Map();
    this.state = null;
    this.clockOffset = 0;

    this.hud = createHud({ onWear: (characterId) => this.room.send('setAvatar', { characterId }) });

    // Leaves room on the right for the album button.
    const help = this.add.text(12, 12, `Tap to walk. Tap empty ground to claim a plot. Tap its tiles to plant (${SEED_COST} scraps) and harvest.`, {
      ...textStyle(13),
      wordWrap: { width: Math.min(window.innerWidth - 150, 420) },
    }).setDepth(HUD_DEPTH);
    this.scraps = this.add.text(12, help.y + help.height + 6, '', textStyle(14)).setDepth(HUD_DEPTH);

    this.room.onMessage('init', (state) => this.applyState(state));
    this.room.onMessage('state', (state) => this.applyState(state));
    this.room.onMessage('harvested', (result) => this.onHarvested(result));
    this.input.on('pointerdown', (pointer) => this.handleTap(pointer));
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  me() {
    return this.state?.players[this.room.sessionId];
  }

  handleTap(pointer) {
    if (!this.state) return;
    const x = pointer.worldX;
    const y = pointer.worldY;
    const plotX = Math.floor(x / PLOT_PIXELS);
    const plotY = Math.floor(y / PLOT_PIXELS);
    const plotKey = `${plotX},${plotY}`;
    const plot = this.state.plots[plotKey];

    // Tending your own plot doesn't walk you onto it, where you'd hide the crop you just tapped.
    if (plot?.ownerId !== this.room.sessionId) {
      this.room.send('move', { x, y });
      const ownsPlot = Object.values(this.state.plots).some((p) => p.ownerId === this.room.sessionId);
      if (!plot && !ownsPlot) this.room.send('claimPlot', { plotX, plotY });
      return;
    }

    const col = Math.floor((x - plotX * PLOT_PIXELS) / TILE_SIZE);
    const row = Math.floor((y - plotY * PLOT_PIXELS) / TILE_SIZE);
    const slot = row * PLOT_SIZE + col;
    const planted = plot.slots[slot];

    if (!planted) {
      if (this.me().currency < SEED_COST) this.hud.toast(`Seeds cost ${SEED_COST} scraps.`);
      else this.room.send('plant', { plotKey, slot });
    } else if (this.now() >= planted.readyAt) {
      this.room.send('harvest', { plotKey, slot });
    } else {
      this.hud.toast(`Still growing: ${formatLeft(planted.readyAt - this.now())} left.`);
    }
  }

  applyState(state) {
    this.clockOffset = state.serverNow - Date.now();
    this.state = state;
    this.syncPlots();
    this.syncAvatars();

    const me = this.me();
    if (me) {
      this.scraps.setText(`${me.name} · ${me.currency} scraps`);
      this.hud.update(me);
    }
  }

  onHarvested({ characterId, scraps, isNew }) {
    const character = CHARACTER_BY_ID[characterId];
    const rarity = RARITIES[character.rarity];
    const text = isNew
      ? `New! ${character.name} (${rarity.label}) +${scraps} scraps`
      : `${character.name} +${scraps} scraps`;
    this.hud.toast(text, { characterId, color: isNew ? rarity.color : undefined });
  }

  syncPlots() {
    const g = this.ground;
    g.clear();
    const seenCrops = new Set();

    for (const [key, plot] of Object.entries(this.state.plots)) {
      const [px, py] = key.split(',').map(Number);
      const x0 = px * PLOT_PIXELS;
      const y0 = py * PLOT_PIXELS;
      const mine = plot.ownerId === this.room.sessionId;

      g.fillStyle(SOIL, 1).fillRect(x0, y0, PLOT_PIXELS, PLOT_PIXELS);
      g.lineStyle(1, 0xffe8d6, 0.12);
      for (let i = 1; i < PLOT_SIZE; i++) {
        g.lineBetween(x0 + i * TILE_SIZE, y0, x0 + i * TILE_SIZE, y0 + PLOT_PIXELS);
        g.lineBetween(x0, y0 + i * TILE_SIZE, x0 + PLOT_PIXELS, y0 + i * TILE_SIZE);
      }
      g.lineStyle(2, 0xffe8d6, mine ? 0.8 : 0.35).strokeRect(x0, y0, PLOT_PIXELS, PLOT_PIXELS);

      if (!this.labels.has(key)) {
        const label = this.add.text(x0 + 2, y0 - 2, plot.ownerName, textStyle(11))
          .setOrigin(0, 1)
          .setAlpha(0.7)
          .setDepth(HUD_DEPTH - 1);
        this.labels.set(key, label);
      }

      plot.slots.forEach((slotData, i) => {
        if (!slotData) return;
        const cropKey = `${key}:${i}`;
        seenCrops.add(cropKey);
        let crop = this.crops.get(cropKey);
        if (!crop || crop.slotData.plantedAt !== slotData.plantedAt) {
          if (crop) this.destroyCrop(cropKey);
          const cx = x0 + (i % PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2;
          const cy = y0 + Math.floor(i / PLOT_SIZE) * TILE_SIZE + TILE_SIZE - 4;
          const image = this.add.image(cx, cy, `char:${slotData.characterId}`).setOrigin(0.5, 1).setDepth(cy);
          crop = { image, slotData, fullScale: CROP_SIZE / image.width, ripe: false };
          this.crops.set(cropKey, crop);
        }
      });
    }

    for (const cropKey of this.crops.keys()) {
      if (!seenCrops.has(cropKey)) this.destroyCrop(cropKey);
    }
    this.updateCrops();
  }

  destroyCrop(cropKey) {
    const { image } = this.crops.get(cropKey);
    this.tweens.killTweensOf(image);
    image.destroy();
    this.crops.delete(cropKey);
  }

  // Growing crops are a dark silhouette rising out of the soil; ripe ones show
  // in full color and breathe so they read as ready to harvest.
  updateCrops() {
    const now = this.now();
    for (const crop of this.crops.values()) {
      const { plantedAt, readyAt } = crop.slotData;
      const progress = Phaser.Math.Clamp((now - plantedAt) / (readyAt - plantedAt), 0, 1);
      if (progress < 1) {
        crop.image.setTintFill(SILHOUETTE).setAlpha(0.45 + 0.4 * progress).setScale(crop.fullScale * (0.3 + 0.7 * progress));
      } else if (!crop.ripe) {
        crop.ripe = true;
        crop.image.clearTint().setAlpha(1).setScale(crop.fullScale);
        this.tweens.add({
          targets: crop.image,
          scaleY: crop.fullScale * 1.06,
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  syncAvatars() {
    const { players } = this.state;

    for (const [id, avatar] of this.avatars) {
      if (players[id]) continue;
      this.tweens.killTweensOf(avatar.container);
      avatar.container.destroy();
      this.avatars.delete(id);
    }

    for (const p of Object.values(players)) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        const image = this.add.image(0, 0, `char:${p.avatar}`).setOrigin(0.5, 1);
        const color = p.id === this.room.sessionId ? TEXT : '#c9b3a6';
        const name = this.add.text(0, 2, p.name, textStyle(11, color)).setOrigin(0.5, 0);
        const container = this.add.container(p.x, p.y, [image, name]);
        avatar = { container, image, characterId: null, x: p.x, y: p.y };
        this.avatars.set(p.id, avatar);
      } else if (avatar.x !== p.x || avatar.y !== p.y) {
        avatar.x = p.x;
        avatar.y = p.y;
        const { container } = avatar;
        const distance = Phaser.Math.Distance.Between(container.x, container.y, p.x, p.y);
        this.tweens.killTweensOf(container);
        this.tweens.add({
          targets: container,
          x: p.x,
          y: p.y,
          duration: Phaser.Math.Clamp(distance * 2, 150, 700),
          ease: 'Sine.out',
        });
      }
      if (avatar.characterId !== p.avatar) {
        avatar.characterId = p.avatar;
        avatar.image.setTexture(`char:${p.avatar}`).setScale(AVATAR_SIZE / avatar.image.width);
      }
    }
  }

  update() {
    if (!this.state) return;
    this.updateCrops();
    for (const { container } of this.avatars.values()) container.setDepth(container.y + 1);
  }
}
