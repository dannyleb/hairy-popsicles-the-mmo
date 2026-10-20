import Phaser from 'phaser';
import {
  CHARACTER_BY_ID,
  EMOTE_BY_ID,
  MAX_LEVEL,
  PLOT_SIZE,
  RARITY_ORDER,
  REACH,
  SEEDS,
  SEED_BY_ID,
  TEND_MAX,
  TILE_SIZE,
  holeOpen,
  holesFor,
  levelForHole,
  linesOf,
} from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { DPR } from '../display.js';
import { reconnect } from '../net/connection.js';
import { storeProfile } from '../net/profile.js';
import { settings } from '../settings.js';
import { formatClock } from '../ui/dom.js';
import { createHud } from '../ui/hud.js';
import { loading } from '../ui/loading.js';
import { createBackdrop } from '../world/backdrop.js';
import { createBossView } from '../world/boss.js';
import { createFx } from '../world/fx.js';
import { DEPTH, FONT, HOLE_OFFSET, PLOT_ART_SIZE, PLOT_PIXELS, WORLD_H, WORLD_W } from '../world/layout.js';

// Character textures are squares with the character standing on the bottom edge.
const AVATAR_SIZE = 64;
const CROP_SIZE = 56;
const SCAB_SIZE = 24;
const SILHOUETTE = 0x120a0d;
const TEXT = '#ffe8d6';
const MUTTER_GAP = [3500, 7500];
const FRONT_OF_PLOT = 26;
// The camera sits this far above you, so your plot (just above you) lands in the
// clear middle of the screen rather than under the quest panel.
const LOOK_AHEAD = 70;
const BUBBLE_MS = { mutter: 2800, chat: 4500, emote: 2600 };
const BUBBLE_STYLE = {
  mutter: { color: '#2a1a1a', backgroundColor: '#f3e3d3' },
  chat: { color: '#1a1012', backgroundColor: '#ffffff' },
  emote: { color: '#ffe8d6', backgroundColor: '#6b2f42' },
};
const STEP_MS = 260;
const SLOW_TICK_MS = 250;         // minimap, event timers, coach
const BOSS_STANDOFF = 105;        // where to stand when walking up to The Boil
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 16000, 30000];
const HARVEST_HIDE_MS = 1500;     // a harvested crop stays hidden this long waiting for the server
const REPLACED = 4001;            // close code: this save was opened somewhere else

const RANK = Object.fromEntries(RARITY_ORDER.map((r, i) => [r, i]));
const textStyle = (size, color = TEXT) => ({ fontFamily: FONT, fontSize: `${size}px`, color, resolution: DPR });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function plotVariant(key) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 3;
}

function holeCenter(plotKey, slot) {
  const [px, py] = plotKey.split(',').map(Number);
  return {
    x: px * PLOT_PIXELS + (slot % PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2,
    y: py * PLOT_PIXELS + Math.floor(slot / PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2 + HOLE_OFFSET,
  };
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
    this.fx = createFx(this);
    this.bossView = createBossView(this, this.fx);
    this.avatars = new Map();
    this.crops = new Map();
    this.plots = new Map();
    this.bubbles = [];
    this.nextMutter = 0;
    this.nextStep = 0;
    this.nextSlowTick = 0;
    this.state = null;
    this.private = null;
    this.clockOffset = 0;
    this.lastHarvest = null;
    this.bloodMoon = false;
    this.coached = { harvested: false, albumOpened: false };

    this.hud = createHud({
      wear: (characterId) => {
        this.coached.albumOpened = true;
        this.room.send('setAvatar', { characterId });
      },
      chat: (text) => this.room.send('chat', { text }),
      emote: (emote) => this.room.send('emote', { emote }),
      goTo: (id) => this.walkToPlayer(id),
      goToBoss: () => this.walkToBoss(),
      travel: (x, y) => this.walk(x, y),
      albumOpened: () => { this.coached.albumOpened = true; },
      leave: () => this.leave(),
    });

    this.input.on('pointerdown', (pointer) => this.handleTap(pointer));
    this.bindRoom(this.room);
  }

  // ---------- connection ----------

  bindRoom(room) {
    this.room = room;
    const on = (type, handler) => room.onMessage(type, (message) => handler.call(this, message));
    on('init', this.applyState);
    on('state', this.applyState);
    on('me', this.onMe);
    on('harvested', this.onHarvested);
    on('levelUp', this.onLevelUp);
    on('questDone', (quest) => this.hud.questDone(quest));
    on('chat', this.onChat);
    on('chatLog', (lines) => this.hud.chatHistory(lines.filter((l) => !this.hud.isMuted(l.id))));
    on('emote', this.onEmote);
    on('announce', this.onAnnounce);
    on('tend', this.onTend);
    on('tended', ({ by }) => this.hud.toast(`${by} squeezed one of your crops. It'll ripen sooner.`));
    on('tendDone', this.onTendDone);
    on('bossHp', this.onBossHp);
    on('bossPopped', this.onBossPopped);
    on('bossGone', () => {
      this.bossView.sink();
      if (this.state) this.state.boss = null;
    });
    on('bossReward', this.onBossReward);
    on('save', ({ token }) => storeProfile(token));
    on('notice', this.onNotice);
    room.onLeave((code) => this.onDisconnect(code));
    room.send('sync');
  }

  async onDisconnect(code) {
    if (this.leaving) return;
    if (code === REPLACED) {
      loading.show('');
      loading.error("You're playing in another tab or window.", () => window.location.reload());
      return;
    }
    const token = this.room.reconnectionToken;
    loading.show('Reconnecting...');
    for (const delay of RECONNECT_DELAYS) {
      try {
        const room = await reconnect(token);
        loading.hide();
        this.bindRoom(room);
        return;
      } catch {
        await sleep(delay);
      }
    }
    loading.error('Lost the connection to the world.', () => window.location.reload());
  }

  leave() {
    this.leaving = true;
    this.room.leave(true).finally(() => window.location.reload());
  }

  // ---------- state ----------

  now() {
    return Date.now() + this.clockOffset;
  }

  myId() {
    return this.room.sessionId;
  }

  me() {
    return this.state?.players[this.myId()];
  }

  myPlotKey() {
    return Object.keys(this.state.plots).find((key) => this.state.plots[key].ownerId === this.myId());
  }

  applyState(state) {
    this.clockOffset = state.serverNow - Date.now();
    if (this.state) this.noticeComings(this.state.players, state.players);
    this.state = state;
    this.syncPlots();
    this.syncAvatars();
    this.bossView.sync(state.boss);
    if (Boolean(state.bloodMoon) !== this.bloodMoon) {
      this.bloodMoon = Boolean(state.bloodMoon);
      this.backdrop.setBloodMoon(this.bloodMoon);
    }
    const me = this.me();
    if (me) this.hud.setPublic(me);
    this.hud.setPlayers(state.players, this.myId());
    this.updateCoach();
  }

  // "So-and-so arrived" in the chat log makes the world feel inhabited.
  noticeComings(before, after) {
    for (const p of Object.values(after)) {
      if (!before[p.id] && p.id !== this.myId()) this.hud.chatLine({ text: `${p.name} arrived.`, kind: 'system' });
    }
    for (const p of Object.values(before)) {
      if (!after[p.id]) this.hud.chatLine({ text: `${p.name} left.`, kind: 'system' });
    }
  }

  onMe(me) {
    this.private = me;
    this.hud.setMe(me);
    this.updateCoach();
  }

  updateCoach() {
    if (!this.state || !this.private) return;
    const key = this.myPlotKey();
    if (!key) return this.hud.coach('claim');
    if (!this.coached.harvested) {
      const crops = this.state.plots[key].slots.filter(Boolean);
      const ripe = crops.some((c) => this.now() >= c.readyAt);
      return this.hud.coach(ripe ? 'harvest' : crops.length ? 'wait' : 'plant');
    }
    this.hud.coach(this.coached.albumOpened ? 'done' : 'album');
  }

  // ---------- tapping the world ----------

  handleTap(pointer) {
    if (!this.state || !this.private || this.hud.blocking()) return;
    const x = pointer.worldX;
    const y = pointer.worldY;

    if (this.bossView.contains(x, y)) return this.hitBoss();

    // A crop's head pokes up into the tile above its hole, so hit-test crops before tiles.
    // Your own plot comes before other players, who may well be standing on it.
    const hit = this.cropAt(x, y) ?? this.holeAt(x, y);
    const plot = this.state.plots[hit.plotKey];
    if (plot?.ownerId === this.myId()) return this.tapOwnHole(hit.plotKey, plot, hit.slot);
    const other = this.avatarAt(x, y);
    if (other) return this.hud.inspect(other);
    if (plot) return this.tapNeighborHole(hit.plotKey, plot, hit.slot, x, y);

    if (!this.myPlotKey()) {
      const [plotX, plotY] = hit.plotKey.split(',').map(Number);
      // Stand at the new plot's front edge, not on top of the holes.
      this.walk(x, (plotY + 1) * PLOT_PIXELS + FRONT_OF_PLOT);
      this.room.send('claimPlot', { plotX, plotY });
      sfx.claim();
      return;
    }
    this.walk(x, y);
  }

  holeAt(x, y) {
    const plotX = Math.floor(x / PLOT_PIXELS);
    const plotY = Math.floor(y / PLOT_PIXELS);
    const col = Phaser.Math.Clamp(Math.floor((x - plotX * PLOT_PIXELS) / TILE_SIZE), 0, PLOT_SIZE - 1);
    const row = Phaser.Math.Clamp(Math.floor((y - plotY * PLOT_PIXELS) / TILE_SIZE), 0, PLOT_SIZE - 1);
    return { plotKey: `${plotX},${plotY}`, slot: row * PLOT_SIZE + col };
  }

  cropAt(x, y) {
    let best = null;
    for (const [cropKey, crop] of this.crops) {
      const { image } = crop;
      if (!image.visible) continue;
      const half = Math.max(image.displayWidth * 0.35, 12);
      if (Math.abs(x - image.x) > half || y > image.y + 4 || y < image.y - Math.max(image.displayHeight * 0.9, 20)) continue;
      if (!best || image.y > best.y) best = { y: image.y, cropKey };
    }
    if (!best) return null;
    const split = best.cropKey.lastIndexOf(':');
    return { plotKey: best.cropKey.slice(0, split), slot: Number(best.cropKey.slice(split + 1)) };
  }

  avatarAt(x, y) {
    let best = null;
    for (const [id, avatar] of this.avatars) {
      if (id === this.myId()) continue;
      const { x: ax, y: ay } = avatar.container;
      if (Math.abs(x - ax) < 24 && y < ay + 6 && y > ay - AVATAR_SIZE) {
        if (!best || ay > best.y) best = { id, y: ay };
      }
    }
    return best?.id ?? null;
  }

  walk(x, y) {
    this.room.send('move', { x: Phaser.Math.Clamp(x, 0, WORLD_W), y: Phaser.Math.Clamp(y, 0, WORLD_H) });
  }

  walkToPlayer(id) {
    const p = this.state?.players[id];
    if (p) this.walk(p.x + 40, p.y + 8);
  }

  walkToBoss() {
    const boss = this.state?.boss;
    const me = this.me();
    if (!boss || !me) return;
    const angle = Math.atan2(me.y - boss.y, me.x - boss.x);
    this.walk(boss.x + Math.cos(angle) * BOSS_STANDOFF, boss.y + Math.sin(angle) * BOSS_STANDOFF * 0.6 + 20);
  }

  hitBoss() {
    const boss = this.state.boss;
    const me = this.me();
    // Out of reach: walk up first. The server takes the move before the hit, so the hit still lands.
    if (Math.hypot(me.x - boss.x, me.y - boss.y) > REACH - 15) this.walkToBoss();
    this.room.send('hitBoss');
    this.bossView.hit();
    sfx.hit(Math.random() < 0.1);
  }

  tapOwnHole(plotKey, plot, slot) {
    const crop = plot.slots[slot];
    const now = this.now();
    if (crop) {
      if (now >= crop.readyAt) return this.harvest(plotKey, slot);
      const squeezed = crop.tendedBy.length ? ` Squeezed ${crop.tendedBy.length}×.` : '';
      this.hud.toast(`Still growing: ${formatClock(crop.readyAt - now)} left.${squeezed}`);
      return;
    }
    const { level, currency, inventory } = this.private;
    if (!holeOpen(slot, level)) {
      sfx.nope();
      this.hud.toast(`This hole opens at level ${levelForHole(slot)}.`);
      return;
    }
    const seed = SEED_BY_ID[this.hud.selectedSeed];
    if (seed.dropOnly ? !(inventory[seed.id] > 0) : currency < seed.cost) {
      sfx.nope();
      this.hud.toast(`Not enough scraps for a ${seed.name}. Harvest something, or squeeze a neighbor's crop.`);
      return;
    }
    this.room.send('plant', { plotKey, slot, seed: seed.id });
    sfx.plant();
    const at = holeCenter(plotKey, slot);
    this.fx.droplets(at.x, at.y, { count: 5, key: 'drop-blood', speed: [50, 120], size: [4, 8] });
  }

  harvest(plotKey, slot) {
    this.room.send('harvest', { plotKey, slot });
    const crop = this.crops.get(`${plotKey}:${slot}`);
    if (!crop) return;
    const { image } = crop;
    this.lastHarvest = { x: image.x, y: image.y - CROP_SIZE / 2 };
    // Pull a copy up out of the hole; the real one goes when the server confirms.
    crop.hiddenUntil = this.time.now + HARVEST_HIDE_MS;
    image.setVisible(false);
    const ghost = this.add.image(image.x, image.y, image.texture.key).setOrigin(0.5, 1)
      .setScale(crop.fullScale).setDepth(DEPTH.flies - 2);
    this.tweens.add({ targets: ghost, y: image.y - 46, scale: crop.fullScale * 1.25, duration: 260, ease: 'Back.out' });
    this.tweens.add({ targets: ghost, alpha: 0, delay: 260, duration: 260, onComplete: () => ghost.destroy() });
  }

  tapNeighborHole(plotKey, plot, slot, x, y) {
    const crop = plot.slots[slot];
    if (crop && this.now() < crop.readyAt) {
      if (crop.tendedBy.includes(this.myId())) {
        this.hud.toast('You already squeezed this one.');
      } else if (crop.tendedBy.length >= TEND_MAX) {
        this.hud.toast("It's been squeezed dry. Let it grow.");
      } else {
        const at = holeCenter(plotKey, slot);
        const me = this.me();
        if (Math.hypot(me.x - at.x, me.y - at.y) > REACH - 10) this.walk(at.x + 18, at.y + 34);
        this.room.send('tend', { plotKey, slot });
        return;
      }
    } else if (crop) {
      this.hud.toast(`Ripe, and waiting for ${plot.ownerName}.`);
    }
    this.walk(x, y);
  }

  // ---------- plots and crops ----------

  syncPlots() {
    const seenCrops = new Set();
    for (const [key, plot] of Object.entries(this.state.plots)) {
      if (!this.plots.has(key)) this.openPlot(key, plot);
      const ownerLevel = this.state.players[plot.ownerId]?.level ?? 1;
      this.syncScabs(key, plot, ownerLevel);

      plot.slots.forEach((slotData, i) => {
        if (!slotData) return;
        const cropKey = `${key}:${i}`;
        seenCrops.add(cropKey);
        let crop = this.crops.get(cropKey);
        if (!crop || crop.slotData.plantedAt !== slotData.plantedAt) {
          if (crop) this.destroyCrop(cropKey);
          crop = this.makeCrop(key, plot, i, slotData);
          this.crops.set(cropKey, crop);
        }
        crop.slotData = slotData;  // readyAt moves when someone squeezes it
      });
    }

    for (const cropKey of this.crops.keys()) {
      if (!seenCrops.has(cropKey)) this.destroyCrop(cropKey);
    }
    for (const key of this.plots.keys()) {
      if (!this.state.plots[key]) this.closePlot(key);
    }
  }

  makeCrop(plotKey, plot, slot, slotData) {
    // Feet down in the plot's hole for this tile.
    const at = holeCenter(plotKey, slot);
    const image = this.add.image(at.x, at.y + 3, `char:${slotData.characterId}`).setOrigin(0.5, 1).setDepth(at.y + 3);
    const glow = this.add.image(at.x, at.y, 'world:glow').setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.light).setVisible(false);
    return {
      image,
      glow,
      slotData,
      mine: plot.ownerId === this.myId(),
      fullScale: CROP_SIZE / image.width,
      ripe: false,
      hiddenUntil: 0,
      squishUntil: 0,
    };
  }

  // A new plot opens up out of the skin.
  openPlot(key, plot) {
    const [px, py] = key.split(',').map(Number);
    const x0 = px * PLOT_PIXELS;
    const y0 = py * PLOT_PIXELS;
    const mine = plot.ownerId === this.myId();
    const art = this.add.image(x0 + PLOT_PIXELS / 2, y0 + PLOT_PIXELS / 2, `world:plot-${plotVariant(key)}`)
      .setDepth(DEPTH.plot);
    const scale = PLOT_ART_SIZE / art.width;
    art.setScale(scale * 0.4).setAlpha(0);
    this.tweens.add({ targets: art, scale, alpha: 1, duration: 650, ease: 'Back.out' });
    if (mine) this.fx.droplets(x0 + PLOT_PIXELS / 2, y0 + PLOT_PIXELS / 2, { count: 14, key: 'drop-blood', speed: [80, 200] });

    // On the plot's top rim, under the crops: growing characters cover it rather than the other way round.
    const label = this.add.text(x0 + 8, y0 + 2, plot.ownerName, textStyle(14, mine ? TEXT : '#d9b8a8'))
      .setShadow(0, 1, '#000', 4, false, true)
      .setAlpha(mine ? 0.9 : 0.7)
      .setDepth(DEPTH.plot + 1);
    this.plots.set(key, { art, label, scabs: new Map(), mine, fresh: true });
  }

  closePlot(key) {
    const { art, label, scabs } = this.plots.get(key);
    const parts = [art, label, ...[...scabs.values()].flatMap((s) => [s.image, s.text].filter(Boolean))];
    this.tweens.add({ targets: parts, alpha: 0, duration: 800, onComplete: () => parts.forEach((p) => p.destroy()) });
    this.plots.delete(key);
  }

  // Holes the owner hasn't unlocked yet are scabbed over; the scab pops off on level-up.
  syncScabs(key, plot, ownerLevel) {
    const entry = this.plots.get(key);
    for (let slot = 0; slot < PLOT_SIZE * PLOT_SIZE; slot++) {
      const locked = !holeOpen(slot, ownerLevel) && !plot.slots[slot];
      const scab = entry.scabs.get(slot);
      if (locked && !scab) {
        const at = holeCenter(key, slot);
        const image = this.add.image(at.x, at.y, 'world:scab').setDepth(DEPTH.plot + 2);
        image.setScale(SCAB_SIZE / image.width).setRotation((slot * 1.7) % (Math.PI * 2));
        const text = entry.mine
          ? this.add.text(at.x, at.y + 12, `Lv ${levelForHole(slot)}`, textStyle(11, '#e9c8b8')).setOrigin(0.5, 0)
            .setShadow(0, 1, '#000', 3, false, true).setDepth(DEPTH.plot + 2).setAlpha(0.8)
          : null;
        entry.scabs.set(slot, { image, text });
      } else if (!locked && scab) {
        entry.scabs.delete(slot);
        if (scab.text) scab.text.destroy();
        this.fx.droplets(scab.image.x, scab.image.y, { count: 6, key: 'drop-blood', speed: [60, 150], size: [4, 8] });
        this.tweens.add({
          targets: scab.image,
          y: scab.image.y - 24,
          scale: scab.image.scale * 1.6,
          alpha: 0,
          rotation: scab.image.rotation + 2,
          duration: 500,
          ease: 'Cubic.out',
          onComplete: () => scab.image.destroy(),
        });
      }
    }
    entry.fresh = false;
  }

  destroyCrop(cropKey) {
    const { image, glow } = this.crops.get(cropKey);
    this.tweens.killTweensOf(image);
    image.destroy();
    glow.destroy();
    this.crops.delete(cropKey);
  }

  // Growing crops are a dark silhouette rising out of the hole; ripe ones show
  // in full color and breathe so they read as ready to harvest. Mine glow gold
  // when ripe; a neighbor's I could squeeze glow green.
  updateCrops(time) {
    const now = this.now();
    const myId = this.myId();
    for (const crop of this.crops.values()) {
      const { image, glow, slotData } = crop;
      const { plantedAt, readyAt, tendedBy } = slotData;
      image.setVisible(time > crop.hiddenUntil);
      const progress = Phaser.Math.Clamp((now - plantedAt) / (readyAt - plantedAt), 0, 1);
      if (progress < 1) {
        const scale = crop.fullScale * (0.3 + 0.7 * progress);
        const squish = time < crop.squishUntil ? 0.22 : 0;
        image.setTintFill(SILHOUETTE).setAlpha(0.55 + 0.35 * progress).setScale(scale * (1 + squish), scale * (1 - squish));
      } else if (!crop.ripe) {
        crop.ripe = true;
        image.clearTint().setAlpha(1).setScale(crop.fullScale);
        this.tweens.add({ targets: image, scaleY: crop.fullScale * 1.06, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        if (crop.mine) this.fx.ring(image.x, image.y - 10, { color: 0xffe2a0, size: 120 });
      }

      const squeezable = !crop.mine && !crop.ripe && !tendedBy.includes(myId) && tendedBy.length < TEND_MAX;
      const harvestable = crop.mine && crop.ripe && image.visible;
      glow.setVisible(squeezable || harvestable);
      if (glow.visible) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.005 + image.x);
        glow.setTint(harvestable ? 0xffd080 : 0x9cff7a).setAlpha(harvestable ? 0.35 + 0.25 * pulse : 0.2 + 0.2 * pulse)
          .setScale((harvestable ? 70 : 54) / 256, (harvestable ? 34 : 26) / 256);
      }
    }
  }

  // ---------- avatars ----------

  syncAvatars() {
    const { players } = this.state;
    for (const [id, avatar] of this.avatars) {
      if (players[id]) continue;
      this.tweens.killTweensOf(avatar.container);
      avatar.container.destroy();
      this.avatars.delete(id);
    }

    for (const p of Object.values(players)) {
      const mine = p.id === this.myId();
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        const shadow = this.add.image(0, 0, 'world:glow').setTint(0x000000).setAlpha(0.6).setDisplaySize(46, 14);
        const image = this.add.image(0, 0, `char:${p.avatar}`).setOrigin(0.5, 1);
        const name = this.add.text(0, 6, '', textStyle(15, mine ? TEXT : '#d9b8a8'))
          .setOrigin(0.5, 0).setShadow(0, 1, '#000', 4, false, true);
        const level = this.add.text(0, 8, '', textStyle(12, '#f3d27a'))
          .setOrigin(0, 0).setShadow(0, 1, '#000', 4, false, true);
        const container = this.add.container(p.x, p.y, [shadow, image, name, level]);
        avatar = { container, image, name, level, characterId: null, x: p.x, y: p.y, moving: false, label: '', away: false };
        this.avatars.set(p.id, avatar);
        if (mine) {
          this.cameras.main.centerOn(p.x, p.y - LOOK_AHEAD);
          this.cameras.main.startFollow(container, false, 0.1, 0.1, 0, LOOK_AHEAD);
        } else if (this.state) {
          container.setAlpha(0);
          this.tweens.add({ targets: container, alpha: 1, duration: 400 });
        }
      } else if (avatar.x !== p.x || avatar.y !== p.y) {
        avatar.x = p.x;
        avatar.y = p.y;
        const { container } = avatar;
        const distance = Phaser.Math.Distance.Between(container.x, container.y, p.x, p.y);
        this.tweens.killTweensOf(container);
        avatar.moving = true;
        this.tweens.add({
          targets: container,
          x: p.x,
          y: p.y,
          duration: Phaser.Math.Clamp(distance * 2.5, 150, 1400),
          ease: 'Sine.inOut',
          onComplete: () => { avatar.moving = false; },
        });
      }
      if (avatar.characterId !== p.avatar) {
        const changed = avatar.characterId !== null;
        avatar.characterId = p.avatar;
        avatar.image.setTexture(`char:${p.avatar}`).setScale(AVATAR_SIZE / avatar.image.width);
        if (changed) {
          this.fx.ring(p.x, p.y - 30, { color: 0xffe2c8, size: 140 });
          this.fx.droplets(p.x, p.y - 30, { count: 6 });
        }
      }
      const label = `${p.name}|${p.level}`;
      if (avatar.label !== label) {
        avatar.label = label;
        avatar.name.setText(p.name);
        avatar.level.setText(`${p.level}`);
        const total = avatar.name.width + 4 + avatar.level.width;
        avatar.name.setX(-total / 2 + avatar.name.width / 2);
        avatar.level.setX(-total / 2 + avatar.name.width + 4);
      }
      // Players whose connection dropped fade until they're back (or gone).
      if (avatar.away !== Boolean(p.away)) {
        avatar.away = Boolean(p.away);
        this.tweens.add({ targets: avatar.container, alpha: avatar.away ? 0.45 : 1, duration: 300 });
      }
    }
  }

  // ---------- speech ----------

  bubble(follow, text, kind, height) {
    for (const old of this.bubbles.filter((b) => b.follow === follow)) {
      this.tweens.killTweensOf(old.bubble);
      old.bubble.destroy();
    }
    this.bubbles = this.bubbles.filter((b) => b.follow !== follow && b.bubble.active);
    const bubble = this.add.text(follow.x, follow.y - height - 10, text, {
      ...textStyle(16),
      ...BUBBLE_STYLE[kind],
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
      delay: BUBBLE_MS[kind],
      duration: 300,
      onComplete: () => {
        bubble.destroy();
        this.bubbles = this.bubbles.filter((b) => b !== entry);
      },
    });
  }

  onChat({ id, name, text }) {
    if (this.hud.isMuted(id)) return;
    this.hud.chatLine({ name, text });
    const avatar = this.avatars.get(id);
    if (avatar && settings.get('bubbles')) this.bubble(avatar.container, text, 'chat', AVATAR_SIZE);
    if (id !== this.myId()) sfx.chat();
  }

  onEmote({ id, emote }) {
    if (this.hud.isMuted(id)) return;
    const { text } = EMOTE_BY_ID[emote];
    const name = this.state?.players[id]?.name ?? 'Someone';
    this.hud.chatLine({ text: `${name} ${text}`, kind: 'emote' });
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    if (settings.get('bubbles')) this.bubble(avatar.container, text, 'emote', AVATAR_SIZE);
    this.tweens.add({ targets: avatar.image, y: -14, duration: 140, yoyo: true, repeat: 1, ease: 'Quad.out' });
    sfx.emote();
  }

  onAnnounce({ text, kind }) {
    // My own rare harvests already get the big reveal.
    const myName = this.me()?.name;
    if (myName && RANK[kind] !== undefined && text.startsWith(`${myName} grew`)) return;
    this.hud.announce(text, kind);
    this.hud.chatLine({ text, kind: 'system' });
    if (kind === 'boss' && text.includes('swelling')) sfx.rumble();
    if (kind === 'bloodMoon' && text.startsWith('Blood Moon')) sfx.rumble();
  }

  // Now and then, someone on screen says something about themselves.
  mutter() {
    if (!settings.get('bubbles')) return;
    // Only speakers well inside the screen, so the bubble above them isn't cut off.
    const view = this.cameras.main.worldView;
    const onScreen = (x, y) => x > view.x + 80 && x < view.right - 80 && y > view.y + 140 && y < view.bottom - 20;
    const speakers = [];
    for (const crop of this.crops.values()) {
      if (crop.ripe && crop.image.visible && onScreen(crop.image.x, crop.image.y)) {
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
    if (this.bubbles.some((b) => b.follow === follow)) return;
    const lines = linesOf(id);
    this.bubble(follow, lines[Math.floor(Math.random() * lines.length)], 'mutter', height);
  }

  // ---------- rewards ----------

  onHarvested({ characterId, scraps, xp, isNew }) {
    const character = CHARACTER_BY_ID[characterId];
    const { rarity } = character;
    const me = this.me();
    const at = this.lastHarvest ?? { x: me.x, y: me.y - 40 };
    this.fx.droplets(at.x, at.y, { count: 6 + 5 * RANK[rarity] });
    this.fx.float(at.x, at.y - 18, `+${scraps}`, { color: '#f3d27a', size: 22 });
    this.fx.float(at.x, at.y + 2, `+${xp} xp`, { color: '#bfe38a', size: 15, delay: 160 });
    if (RANK[rarity] >= 2) this.fx.ring(at.x, at.y, { color: rarity === 'legendary' ? 0xffd070 : 0x9cc8ff, size: 300, duration: 700 });
    sfx.harvest(rarity);
    this.coached.harvested = true;

    if (isNew || RANK[rarity] >= 2) {
      this.hud.reveal(characterId, { isNew });
      if (rarity === 'legendary') sfx.fanfare();
      else if (isNew) sfx.discover();
      if (isNew) this.hud.markNew();
    } else {
      this.hud.toast(`${character.name} +${scraps} scraps`, { characterId });
    }
  }

  onLevelUp({ level }) {
    const from = this.private?.level ?? level - 1;
    const unlocks = [];
    const holes = holesFor(level) - holesFor(from);
    if (holes > 0) unlocks.push(holes === 1 ? 'A new hole opened in your plot' : `${holes} new holes opened in your plot`);
    for (const seed of SEEDS) {
      if (!seed.dropOnly && seed.level > from && seed.level <= level) unlocks.push(`${seed.name}s unlocked`);
    }
    if (level >= MAX_LEVEL) unlocks.push('Max level. Bragging rights.');
    this.hud.levelUp(level, unlocks);
    sfx.fanfare();
    const me = this.me();
    if (me) {
      this.fx.ring(me.x, me.y - 30, { color: 0xffd070, size: 260, duration: 800 });
      this.fx.droplets(me.x, me.y - 40, { count: 16, speed: [120, 260] });
    }
  }

  onTend({ plotKey, slot, by }) {
    const crop = this.crops.get(`${plotKey}:${slot}`);
    if (!crop) return;
    crop.squishUntil = this.time.now + 160;
    this.fx.droplets(crop.image.x, crop.image.y - crop.image.displayHeight * 0.6, { count: 5, speed: [60, 150], size: [4, 8] });
    if (by === this.myId() || crop.mine) sfx.squeeze();
  }

  onTendDone({ scraps, xp }) {
    const me = this.me();
    if (!me) return;
    this.fx.float(me.x, me.y - AVATAR_SIZE - 6, `+${scraps}`, { color: '#f3d27a', size: 20 });
    this.fx.float(me.x, me.y - AVATAR_SIZE + 14, `+${xp} xp`, { color: '#bfe38a', size: 14, delay: 140 });
  }

  onBossHp({ hp, maxHp }) {
    this.bossView.setHp(hp, maxHp);
    if (this.state?.boss) Object.assign(this.state.boss, { hp, maxHp });
  }

  onBossPopped({ x, y }) {
    this.bossView.pop(x, y);
    sfx.splat();
    if (this.state) this.state.boss = null;
  }

  onNotice(notice) {
    if (notice.kind === 'welcome') {
      this.hud.welcome({ ...notice, avatar: this.me()?.avatar });
      sfx.discover();
    } else if (notice.kind === 'daily') {
      this.hud.daily(notice);
      if (notice.reward.boil) this.hud.selectSeed('boil');
    }
  }

  onBossReward({ damage, top, scraps, xp, seeds }) {
    const parts = [`+${scraps} scraps`, `+${xp} xp`];
    if (seeds) parts.push(`+${seeds} Boil Seed${seeds > 1 ? 's' : ''}`);
    this.hud.announce(`${top ? 'Top squeezer! ' : ''}You hit it ${damage}×. ${parts.join(' · ')}`, seeds ? 'legendary' : 'quest');
    if (seeds) {
      this.hud.selectSeed('boil');
      sfx.discover();
    }
  }

  // ---------- frame ----------

  // While The Boil is off screen, an arrow at the screen edge points the way.
  pointAtBoss() {
    const boss = this.bossView.position();
    const view = this.cameras.main.worldView;
    if (!boss || (boss.x > view.x + 20 && boss.x < view.right - 20 && boss.y > view.y + 40 && boss.y < view.bottom + 20)) {
      this.hud.pointAtBoss(null);
      return;
    }
    const scale = window.innerWidth / view.width;
    const dx = (boss.x - view.centerX) * scale;
    const dy = (boss.y - view.centerY) * scale;
    const halfW = window.innerWidth / 2 - 30;
    const halfH = dy < 0 ? window.innerHeight / 2 - 170 : window.innerHeight / 2 - 130;
    const t = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
    this.hud.pointAtBoss({
      x: window.innerWidth / 2 + dx * t,
      y: window.innerHeight / 2 + dy * t,
      angle: Math.atan2(dy, dx),
    });
  }

  update(time, delta) {
    const camera = this.cameras.main;
    this.backdrop.update(time, delta, camera);
    if (!this.state) return;

    this.updateCrops(time);
    this.bossView.update(time);
    this.pointAtBoss();

    const mine = this.avatars.get(this.myId());
    for (const avatar of this.avatars.values()) {
      avatar.container.setDepth(avatar.container.y + 1);
      // A little hop in each step.
      if (avatar.moving) avatar.image.y = -Math.abs(Math.sin(time * 0.017 + avatar.x)) * 5;
      else if (!this.tweens.isTweening(avatar.image)) avatar.image.y = 0;
    }
    if (mine?.moving && time > this.nextStep) {
      sfx.step();
      this.nextStep = time + STEP_MS;
    }

    for (const { bubble, follow, offset } of this.bubbles) {
      if (follow.active) bubble.setPosition(follow.x, follow.y - offset);
    }
    if (time > this.nextMutter) {
      if (this.nextMutter) this.mutter();
      this.nextMutter = time + Phaser.Math.Between(...MUTTER_GAP);
    }
    if (time > this.nextSlowTick) {
      this.nextSlowTick = time + SLOW_TICK_MS;
      this.hud.minimap.draw(this.state, this.myId(), camera.worldView, time);
      this.hud.setEvents(this.state.boss, this.state.bloodMoon, this.now());
      this.updateCoach();
    }
  }
}
