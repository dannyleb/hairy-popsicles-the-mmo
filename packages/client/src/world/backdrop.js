import Phaser from 'phaser';
import { DEPTH, PLOT_PIXELS, WORLD_H, WORLD_W, seededRandom } from './layout.js';

// Art from tools/world.py, all lit from the upper left like the character renders.
const PROPS = [
  { keys: ['pimple-0', 'pimple-1', 'pimple-2'], count: 220, size: [12, 24] },
  { keys: ['pustule'], count: 24, size: [24, 34] },
  { keys: ['mole-0', 'mole-1'], count: 40, size: [14, 22] },
  { keys: ['hair-0', 'hair-1', 'hair-2', 'hair-3'], count: 110, size: [80, 140], spin: true },
  { keys: ['slime-0', 'slime-1'], count: 16, size: [60, 120] },
  { keys: ['pus-0'], count: 9, size: [50, 90] },
];

export const WORLD_TEXTURES = [
  'ground', 'ground-macro', 'plot-0', 'plot-1', 'plot-2', 'candle', 'flame', 'glow', 'spore',
  'boil', 'scab', 'drop-pus', 'drop-blood',
  'mite-0', 'mite-1', 'flea', 'worm-head', 'worm-body', 'smear',
  ...PROPS.flatMap((p) => p.keys),
];

const NIGHT_TINT = 0x9a8c90;  // darkens the ground so candlelight and the characters stand out
const BLOOD_TINT = 0xa07476;  // the same, under a Blood Moon
const CANDLE_LIGHT = 0xffa65c;
const BLOOD_LIGHT = 0xff3a2a;
const FLY_GLOW = 0xc8ff60;
const BLOOD_FLY_GLOW = 0xff6a50;
const CANDLE_CHANCE = 0.2;    // share of plot-grid corners with a candle
const CANDLE_WIDTH = 22;
const GLOW_SIZE = 340;
const FLIES = 36;
const SPORES = 45;

export function createBackdrop(scene) {
  const rand = seededRandom(1337);
  const between = (a, b) => a + (b - a) * rand();

  const ground = scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'world:ground')
    .setOrigin(0).setTileScale(0.5).setTint(NIGHT_TINT).setDepth(DEPTH.ground);
  // A big soft color drift stretched over the world, so the ground tile's repeat doesn't show.
  // It deepens and fades very slowly: the skin breathing.
  const macro = scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'world:ground-macro')
    .setOrigin(0).setTileScale(8).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH.macro);

  const hairs = [];
  for (const { keys, count, size, spin } of PROPS) {
    for (let i = 0; i < count; i++) {
      const key = keys[Math.floor(rand() * keys.length)];
      const prop = scene.add.image(between(0, WORLD_W), between(0, WORLD_H), `world:${key}`)
        .setTint(NIGHT_TINT).setDepth(DEPTH.decor);
      prop.setScale(between(...size) / prop.width);
      if (spin) {
        prop.setRotation(between(0, Math.PI * 2));
        hairs.push({ prop, rest: prop.rotation, push: 0, phase: rand() * 1000 });
      }
    }
  }

  // Candles stand at the corners of the plot grid, like markers between fields.
  const candles = [];
  const candleScale = CANDLE_WIDTH / 96;
  for (let i = 0; i <= WORLD_W / PLOT_PIXELS; i++) {
    for (let j = 0; j <= WORLD_H / PLOT_PIXELS; j++) {
      if (rand() > CANDLE_CHANCE) continue;
      const x = i * PLOT_PIXELS + between(-6, 6);
      const y = j * PLOT_PIXELS + between(-6, 6);
      const glow = scene.add.image(x, y - 18, 'world:glow')
        .setTint(CANDLE_LIGHT).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.light);
      scene.add.image(x, y, 'world:candle').setOrigin(0.5, 0.86).setScale(candleScale).setDepth(y);
      const flame = scene.add.image(x, y - 25, 'world:flame')
        .setOrigin(0.5, 0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 0.5);
      candles.push({ x, y, glow, flame, phase: rand() * 1000 });
    }
  }

  // Pus-flies: little glowing bugs drifting in loops.
  const flies = [];
  for (let i = 0; i < FLIES; i++) {
    const halo = scene.add.image(0, 0, 'world:glow').setTint(FLY_GLOW).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(28 / 256).setDepth(DEPTH.flies);
    const core = scene.add.image(0, 0, 'world:spore').setTint(0xf4ffc0).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(6 / 32).setDepth(DEPTH.flies + 1);
    flies.push({
      x: between(0, WORLD_W), y: between(0, WORLD_H), halo, core, phase: rand() * 1000,
      rx: between(20, 80), ry: between(15, 55), speed: between(0.5, 1.2),
    });
  }

  // Spores: faint motes drifting through whatever is on screen.
  const spores = [];
  for (let i = 0; i < SPORES; i++) {
    const mote = scene.add.image(0, 0, 'world:spore').setTint(0xffe2c8).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.spores).setScale(between(2, 5) / 32).setAlpha(between(0.12, 0.4));
    spores.push({ mote, u: rand(), v: rand(), vu: between(0.004, 0.012), vv: between(-0.012, -0.004), phase: rand() * 1000 });
  }

  let lite = false;  // ambient glows off, when the device is struggling

  return {
    setLite(on) {
      lite = on;
      for (const c of candles) c.glow.setVisible(!on);
      for (const f of flies) f.halo.setVisible(!on);
    },

    // Everything goes red while a Blood Moon is up.
    setBloodMoon(on) {
      ground.setTint(on ? BLOOD_TINT : NIGHT_TINT);
      for (const c of candles) {
        c.glow.setTint(on ? BLOOD_LIGHT : CANDLE_LIGHT);
        c.flame.setTint(on ? 0xff7060 : 0xffffff);
      }
      for (const f of flies) f.halo.setTint(on ? BLOOD_FLY_GLOW : FLY_GLOW);
    },

    // `walkers`: things moving about, which brush the hairs aside; `calm`: reduce motion.
    update(time, delta, camera, walkers = [], calm = false) {
      const view = camera.worldView;
      if (!calm) macro.setAlpha(0.86 + 0.14 * Math.sin(time * 0.0006));
      for (const h of hairs) {
        const { prop } = h;
        if (prop.x < view.x - 80 || prop.x > view.right + 80 || prop.y < view.y - 80 || prop.y > view.bottom + 80) continue;
        const by = walkers.find((w) => Math.abs(w.x - prop.x) < 55 && Math.abs(w.y - prop.y) < 40);
        if (by) h.push += ((by.x < prop.x ? 0.35 : -0.35) - h.push) * 0.2;
        else h.push *= 0.94;
        const air = calm ? 0 : 0.045 * Math.sin(time * 0.0011 + h.phase) + 0.02 * Math.sin(time * 0.0031 + h.phase * 2);
        prop.setRotation(h.rest + air + h.push);
      }
      for (const c of candles) {
        // Lights well off screen aren't drawn at all.
        const near = !(c.x < view.x - GLOW_SIZE || c.x > view.right + GLOW_SIZE || c.y < view.y - GLOW_SIZE || c.y > view.bottom + GLOW_SIZE);
        c.glow.setVisible(near && !lite);
        if (!near) continue;
        const flicker = 0.88 + 0.08 * Math.sin(time * 0.011 + c.phase) + 0.05 * Math.sin(time * 0.037 + c.phase * 2.3);
        c.glow.setScale((GLOW_SIZE / 256) * (0.96 + 0.04 * flicker)).setAlpha(0.42 * flicker);
        c.flame.setScale((11 / 64) * (0.9 + 0.1 * flicker), (11 / 64) * flicker);
      }

      for (const f of flies) {
        const t = time * 0.0006 * f.speed + f.phase;
        const x = f.x + f.rx * Math.sin(t) + 6 * Math.sin(t * 7.3);
        const y = f.y + f.ry * Math.cos(t * 1.3) + 5 * Math.cos(t * 6.1);
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.004 + f.phase);
        f.halo.setPosition(x, y).setAlpha(0.35 + 0.35 * pulse);
        f.core.setPosition(x, y).setAlpha(0.6 + 0.4 * pulse);
      }

      // Spores live in screen-relative coordinates and wrap, so there are always some on screen.
      for (const s of spores) {
        s.u = (s.u + (s.vu * delta) / 1000 + 1) % 1;
        s.v = (s.v + (s.vv * delta) / 1000 + 1) % 1;
        const sway = 0.01 * Math.sin(time * 0.001 + s.phase);
        s.mote.setPosition(view.x + (s.u + sway) * view.width, view.y + s.v * view.height);
      }
    },
  };
}
