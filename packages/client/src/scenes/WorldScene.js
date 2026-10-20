import Phaser from 'phaser';
import { CHARACTER_BY_ID, PLOT_SIZE, RARITIES, SEED_COST, TILE_SIZE, linesOf } from '@hptm/shared';
import { DPR } from '../display.js';
import { createHud } from '../ui/hud.js';
import { createBackdrop } from '../world/backdrop.js';
import { DEPTH, FONT, HOLE_OFFSET, PLOT_ART_SIZE, PLOT_PIXELS, WORLD_H, WORLD_W } from '../world/layout.js';

// Character textures are squares with the character standing on the bottom edge.
const AVATAR_SIZE = 64;
const CROP_SIZE = 56;
const SILHOUETTE = 0x120a0d;
const TEXT = '#ffe8d6';
const MUTTER_GAP = [3500, 7500];
const FRONT_OF_PLOT = 26;
const BUBBLE_MS = 2800;

const textStyle = (size, color = TEXT) => ({ fontFamily: FONT, fontSize: `${size}px`, color, resolution: DPR });

function formatLeft(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function plotVariant(key) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 3;
}

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
  }

  init(data) {
    this.room = data.room;
  }

  create() {
    this.cameras.main.setBackgroundColor('#0e0608').setZoom(DPR).setBounds(0, 0, WORLD_W, WORLD_H);
    this.backdrop = createBackdrop(this);
    this.avatars = new Map();
    this.crops = new Map();
    this.plots = new Map();
    this.bubbles = [];
    this.nextMutter = 0;
    this.state = null;
    this.clockOffset = 0;

    this.hud = createHud({ onWear: (characterId) => this.room.send('setAvatar', { characterId }) });

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

  ownsPlot() {
    return Object.values(this.state.plots).some((p) => p.ownerId === this.room.sessionId);
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
      if (!plot && !this.ownsPlot()) {
        // Stand at the new plot's front edge, not on top of the holes.
        this.room.send('move', { x, y: (plotY + 1) * PLOT_PIXELS + FRONT_OF_PLOT });
        this.room.send('claimPlot', { plotX, plotY });
      } else {
        this.room.send('move', { x, y });
      }
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
    if (me) this.hud.update(me, this.ownsPlot());
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
    const seenCrops = new Set();

    for (const [key, plot] of Object.entries(this.state.plots)) {
      const [px, py] = key.split(',').map(Number);
      const x0 = px * PLOT_PIXELS;
      const y0 = py * PLOT_PIXELS;

      if (!this.plots.has(key)) this.openPlot(key, plot, x0, y0);

      plot.slots.forEach((slotData, i) => {
        if (!slotData) return;
        const cropKey = `${key}:${i}`;
        seenCrops.add(cropKey);
        let crop = this.crops.get(cropKey);
        if (!crop || crop.slotData.plantedAt !== slotData.plantedAt) {
          if (crop) this.destroyCrop(cropKey);
          // Feet down in the plot's hole for this tile.
          const cx = x0 + (i % PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2;
          const cy = y0 + Math.floor(i / PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2 + HOLE_OFFSET + 3;
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

  // A new plot opens up out of the skin.
  openPlot(key, plot, x0, y0) {
    const mine = plot.ownerId === this.room.sessionId;
    const art = this.add.image(x0 + PLOT_PIXELS / 2, y0 + PLOT_PIXELS / 2, `world:plot-${plotVariant(key)}`)
      .setDepth(DEPTH.plot);
    const scale = PLOT_ART_SIZE / art.width;
    art.setScale(scale * 0.4).setAlpha(0);
    this.tweens.add({ targets: art, scale, alpha: 1, duration: 650, ease: 'Back.out' });

    // On the plot's top rim, under the crops: growing characters cover it rather than the other way round.
    const label = this.add.text(x0 + 8, y0 + 2, plot.ownerName, textStyle(14, mine ? TEXT : '#d9b8a8'))
      .setShadow(0, 1, '#000', 4, false, true)
      .setAlpha(mine ? 0.9 : 0.7)
      .setDepth(DEPTH.plot + 1);
    this.plots.set(key, { art, label });
  }

  destroyCrop(cropKey) {
    const { image } = this.crops.get(cropKey);
    this.tweens.killTweensOf(image);
    image.destroy();
    this.crops.delete(cropKey);
  }

  // Growing crops are a dark silhouette rising out of the hole; ripe ones show
  // in full color and breathe so they read as ready to harvest.
  updateCrops() {
    const now = this.now();
    for (const crop of this.crops.values()) {
      const { plantedAt, readyAt } = crop.slotData;
      const progress = Phaser.Math.Clamp((now - plantedAt) / (readyAt - plantedAt), 0, 1);
      if (progress < 1) {
        crop.image.setTintFill(SILHOUETTE).setAlpha(0.55 + 0.35 * progress).setScale(crop.fullScale * (0.3 + 0.7 * progress));
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
      const mine = p.id === this.room.sessionId;
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        const shadow = this.add.image(0, 0, 'world:glow').setTint(0x000000).setAlpha(0.6).setDisplaySize(46, 14);
        const image = this.add.image(0, 0, `char:${p.avatar}`).setOrigin(0.5, 1);
        const name = this.add.text(0, 6, p.name, textStyle(15, mine ? TEXT : '#d9b8a8'))
          .setOrigin(0.5, 0)
          .setShadow(0, 1, '#000', 4, false, true);
        const container = this.add.container(p.x, p.y, [shadow, image, name]);
        avatar = { container, image, characterId: null, x: p.x, y: p.y };
        this.avatars.set(p.id, avatar);
        if (mine) {
          this.cameras.main.centerOn(p.x, p.y);
          this.cameras.main.startFollow(container, false, 0.1, 0.1);
        }
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
          duration: Phaser.Math.Clamp(distance * 2.5, 150, 1400),
          ease: 'Sine.inOut',
        });
      }
      if (avatar.characterId !== p.avatar) {
        avatar.characterId = p.avatar;
        avatar.image.setTexture(`char:${p.avatar}`).setScale(AVATAR_SIZE / avatar.image.width);
      }
    }
  }

  // Now and then, someone on screen says something about themselves.
  mutter() {
    // Only speakers well inside the screen, so the bubble above them isn't cut off.
    const view = this.cameras.main.worldView;
    const onScreen = (x, y) => x > view.x + 80 && x < view.right - 80 && y > view.y + 140 && y < view.bottom - 20;
    const speakers = [];
    for (const crop of this.crops.values()) {
      if (crop.ripe && onScreen(crop.image.x, crop.image.y)) {
        speakers.push({ id: crop.slotData.characterId, follow: crop.image, height: CROP_SIZE });
      }
    }
    for (const avatar of this.avatars.values()) {
      if (onScreen(avatar.container.x, avatar.container.y)) {
        speakers.push({ id: avatar.characterId, follow: avatar.container, height: AVATAR_SIZE });
      }
    }
    if (!speakers.length) return;

    const { id, follow, height } = speakers[Math.floor(Math.random() * speakers.length)];
    const lines = linesOf(id);
    const bubble = this.add.text(0, 0, lines[Math.floor(Math.random() * lines.length)], {
      ...textStyle(16, '#2a1a1a'),
      backgroundColor: '#f3e3d3',
      padding: { x: 9, y: 4 },
      wordWrap: { width: 190 },
      align: 'center',
    }).setOrigin(0.5, 1).setDepth(DEPTH.bubbles).setAlpha(0);
    const entry = { bubble, follow, offset: height + 10 };
    this.bubbles.push(entry);
    this.tweens.add({ targets: bubble, alpha: 1, duration: 200 });
    this.tweens.add({
      targets: bubble,
      alpha: 0,
      delay: BUBBLE_MS,
      duration: 300,
      onComplete: () => {
        bubble.destroy();
        this.bubbles = this.bubbles.filter((b) => b !== entry);
      },
    });
  }

  update(time, delta) {
    const camera = this.cameras.main;
    this.backdrop.update(time, delta, camera);
    if (!this.state) return;

    this.updateCrops();
    for (const { container } of this.avatars.values()) container.setDepth(container.y + 1);
    for (const { bubble, follow, offset } of this.bubbles) {
      if (follow.active) bubble.setPosition(follow.x, follow.y - offset);
    }
    if (time > this.nextMutter) {
      if (this.nextMutter) this.mutter();
      this.nextMutter = time + Phaser.Math.Between(...MUTTER_GAP);
    }
  }
}
