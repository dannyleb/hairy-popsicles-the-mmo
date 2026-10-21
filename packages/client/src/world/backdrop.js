import Phaser from 'phaser';
import { LANDMARKS, REGIONS, regionAt } from '@hptm/shared';
import { DEPTH, NIGHT_TINT, PLOT_PIXELS, WORLD_H, WORLD_W, seededRandom } from './layout.js';

// Art from tools/world.py, all lit from the upper left like the character renders.
const PROPS = [
  { keys: ['pimple-0', 'pimple-1', 'pimple-2'], count: 220, size: [12, 24] },
  { keys: ['pustule'], count: 24, size: [24, 34] },
  { keys: ['mole-0', 'mole-1'], count: 40, size: [14, 22] },
  { keys: ['hair-0', 'hair-1', 'hair-2', 'hair-3'], count: 110, size: [80, 140], spin: true },
  { keys: ['slime-0', 'slime-1'], count: 16, size: [60, 120] },
  { keys: ['pus-0'], count: 9, size: [50, 90] },
];

// Each region's own look: a cast over its ground, and props found only there.
const REGION_TINTS = { scalp: 0x8c80a6, armpit: 0xc4cc72, freckles: 0xffbc84, warts: 0xa47896 };
const REGION_PROPS = [
  { region: 'scalp', keys: ['hair-0', 'hair-1', 'hair-2', 'hair-3'], count: 170, size: [110, 190], spin: true },
  { region: 'armpit', keys: ['slime-0', 'slime-1'], count: 12, size: [90, 170], steam: true },
  { region: 'armpit', keys: ['pus-0'], count: 4, size: [60, 100] },
  { region: 'freckles', keys: ['freckle-0', 'freckle-1', 'freckle-2'], count: 320, size: [20, 60], tint: 0xffd8c0 },
  { region: 'warts', keys: ['wart-0', 'wart-1'], count: 50, size: [30, 72] },
];
const LANDMARK_CLEARANCE = 170;  // px around a landmark kept free of region props

export const WORLD_TEXTURES = [
  'ground', 'ground-macro', 'plot-0', 'plot-1', 'plot-2', 'candle', 'flame', 'glow', 'spore',
  'boil', 'scab', 'drop-pus', 'drop-blood',
  'mite-0', 'mite-1', 'flea', 'worm-head', 'worm-body', 'smear',
  'freckle-0', 'freckle-1', 'freckle-2', 'wart-0', 'wart-1', 'navel', 'eye-socket', 'eye-ball', 'eye-iris', 'eye-lid', 'vein', 'plinth',
  ...PROPS.flatMap((p) => p.keys),
];

const BLOOD_TINT = 0xa07476;  // the same, under a Blood Moon
const CANDLE_LIGHT = 0xffa65c;
const BLOOD_LIGHT = 0xff3a2a;
const FLY_GLOW = 0xc8ff60;
const BLOOD_FLY_GLOW = 0xff6a50;
// Day and night (see daylight in @hptm/shared) are two layers over the ground
// and plots, under the lights and everyone standing about: a cool shade that
// deepens toward midnight, and a warm lift toward midday.
const NIGHT_SHADE = { tint: 0x524e86, alpha: 0.6 };
const DAY_LIFT = { tint: 0x74583e, alpha: 0.6 };
const CANDLE_CHANCE = 0.2;    // share of plot-grid corners with a candle
const CANDLE_WIDTH = 22;
const GLOW_SIZE = 340;
const FLIES = 36;
const SPORES = 45;
// Veins under the skin, from the Navel out to each region and landmark.
const VEIN = { step: 26, tint: 0x8a76b0, alpha: 0.55 };
// Phaser draws everything in a scene every frame, on screen or not, so the
// ground's still things are grouped into cells and only the cells near the
// view are shown. CULL_MARGIN covers the biggest of them (a long hair).
const CELL = 320;
const CULL_MARGIN = 220;
// Steam off the Armpit's sweat pools.
const STEAM = { count: 18, every: 380, lifeMs: 2800, rise: 80 };

// Through the world's veins: points every VEIN.step px from one place to another, wandering a little.
function veinPath(rand, x0, y0, x1, y1) {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(length / VEIN.step));
  const nx = -(y1 - y0) / length;
  const ny = (x1 - x0) / length;
  const waves = [[rand() * 6, 1 + rand() * 2, 30 + rand() * 30], [rand() * 6, 4 + rand() * 4, 6 + rand() * 8]];
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // No wander at the ends, so a vein starts and stops where it should.
    const sway = Math.sin(t * Math.PI) * waves.reduce((sum, [phase, freq, amp]) => sum + amp * Math.sin(t * Math.PI * freq + phase), 0);
    points.push({ x: x0 + (x1 - x0) * t + nx * sway, y: y0 + (y1 - y0) * t + ny * sway });
  }
  return points;
}

export function createBackdrop(scene) {
  const rand = seededRandom(1337);
  const between = (a, b) => a + (b - a) * rand();
  const cells = new Map();  // 'cx,cy' → the still things in that cell
  const still = (image) => {
    const key = `${Math.floor(image.x / CELL)},${Math.floor(image.y / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(image.setVisible(false));
    return image;
  };
  let shown = [];   // keys of the cells on show
  let shownRange = '';

  const ground = scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'world:ground')
    .setOrigin(0).setTileScale(0.5).setTint(NIGHT_TINT).setDepth(DEPTH.ground);
  // A big soft color drift stretched over the world, so the ground tile's repeat doesn't show.
  // It deepens and fades very slowly: the skin breathing.
  const macro = scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'world:ground-macro')
    .setOrigin(0).setTileScale(8).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH.macro);

  // A soft cast of color over each region's ground; the Navel glows faintly warm.
  for (const [region, tint] of Object.entries(REGION_TINTS)) {
    const { x, y } = REGIONS[region];
    scene.add.image(x, y, 'world:glow').setTint(tint).setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDisplaySize(2600, 2600).setDepth(DEPTH.macro + 1);
  }
  scene.add.image(LANDMARKS.navel.x, LANDMARKS.navel.y, 'world:glow').setTint(0xff9a70).setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(0.16).setDisplaySize(760, 760).setDepth(DEPTH.decor + 6);

  const hairs = [];
  for (const { keys, count, size, spin } of PROPS) {
    for (let i = 0; i < count; i++) {
      const key = keys[Math.floor(rand() * keys.length)];
      const prop = still(scene.add.image(between(0, WORLD_W), between(0, WORLD_H), `world:${key}`)
        .setTint(NIGHT_TINT).setDepth(DEPTH.decor));
      prop.setScale(between(...size) / prop.width);
      if (spin) {
        prop.setRotation(between(0, Math.PI * 2));
        hairs.push({ prop, rest: prop.rotation, push: 0, phase: rand() * 1000 });
      }
    }
  }

  // Props of each region, only where that region is (and not on a landmark).
  // Their own random sequence, so the rest of the world's scatter stays put.
  const regionRand = seededRandom(2025);
  const pools = [];  // the Armpit's sweat pools, which steam
  const clear = (x, y) => Object.values(LANDMARKS).every((l) => Math.hypot(x - l.x, y - l.y) > LANDMARK_CLEARANCE);
  for (const { region, keys, count, size, spin, steam, tint = NIGHT_TINT } of REGION_PROPS) {
    for (let placed = 0, tries = 0; placed < count && tries < count * 40; tries++) {
      const x = 30 + regionRand() * (WORLD_W - 60);
      const y = 30 + regionRand() * (WORLD_H - 60);
      if (regionAt(x, y) !== region || !clear(x, y)) continue;
      placed++;
      const key = keys[Math.floor(regionRand() * keys.length)];
      const prop = still(scene.add.image(x, y, `world:${key}`).setTint(tint).setDepth(DEPTH.decor));
      prop.setScale((size[0] + (size[1] - size[0]) * regionRand()) / prop.width);
      if (spin) {
        prop.setRotation(regionRand() * Math.PI * 2);
        hairs.push({ prop, rest: prop.rotation, push: 0, phase: regionRand() * 1000 });
      }
      if (steam) pools.push({ x, y, r: prop.displayWidth * 0.3 });
    }
  }

  // Veins: a big one from the Navel out to the middle of each region, with a
  // few branches off it, and a smaller one to the Eye.
  const veinRand = seededRandom(77);
  const navel = LANDMARKS.navel;
  const drawVein = (points, from, to) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const width = from + (to - from) * (i / points.length);
      still(scene.add.image((a.x + b.x) / 2, (a.y + b.y) / 2, 'world:vein').setTint(VEIN.tint).setAlpha(VEIN.alpha)
        .setRotation(Math.atan2(b.y - a.y, b.x - a.x)).setDisplaySize(VEIN.step * 1.6, width / 0.32).setDepth(DEPTH.decor - 1));
    }
  };
  const fromNavel = (x, y, stopShort) => {
    const angle = Math.atan2(y - navel.y, x - navel.x);
    const length = Math.hypot(x - navel.x, y - navel.y) - stopShort;
    return [navel.x + Math.cos(angle) * 120, navel.y + Math.sin(angle) * 120, navel.x + Math.cos(angle) * length, navel.y + Math.sin(angle) * length];
  };
  for (const region of Object.keys(REGION_TINTS)) {
    const { x, y } = REGIONS[region];
    const points = veinPath(veinRand, ...fromNavel(x, y, -260));
    drawVein(points, 15, 5);
    for (let b = 0; b < 3; b++) {
      const at = points[Math.floor(points.length * (0.3 + 0.2 * b + veinRand() * 0.1))];
      const along = Math.atan2(y - navel.y, x - navel.x);
      const angle = along + (veinRand() < 0.5 ? -1 : 1) * (0.5 + veinRand() * 0.6);
      const length = 160 + veinRand() * 220;
      drawVein(veinPath(veinRand, at.x, at.y, at.x + Math.cos(angle) * length, at.y + Math.sin(angle) * length), 8, 3);
    }
  }
  drawVein(veinPath(veinRand, ...fromNavel(LANDMARKS.eye.x, LANDMARKS.eye.y, 150)), 11, 8);

  // Candles stand at the corners of the plot grid, like markers between fields
  // (but not in the middle of a landmark).
  const candles = [];
  const candleScale = CANDLE_WIDTH / 96;
  const onLandmark = (i, j) => Object.values(LANDMARKS).some(({ plots: [x0, y0, w, h] }) => i > x0 && i < x0 + w && j > y0 && j < y0 + h);
  for (let i = 0; i <= WORLD_W / PLOT_PIXELS; i++) {
    for (let j = 0; j <= WORLD_H / PLOT_PIXELS; j++) {
      if (rand() > CANDLE_CHANCE || onLandmark(i, j)) continue;
      const x = i * PLOT_PIXELS + between(-6, 6);
      const y = j * PLOT_PIXELS + between(-6, 6);
      const glow = scene.add.image(x, y - 18, 'world:glow')
        .setTint(CANDLE_LIGHT).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.light);
      still(scene.add.image(x, y, 'world:candle').setOrigin(0.5, 0.86).setScale(candleScale).setDepth(y));
      const flame = still(scene.add.image(x, y - 25, 'world:flame')
        .setOrigin(0.5, 0.85).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 0.5));
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

  const steam = [];
  for (let i = 0; i < STEAM.count; i++) {
    steam.push({ wisp: scene.add.image(0, 0, 'world:glow').setTint(0xf2eee0).setVisible(false).setDepth(DEPTH.flies - 1), at: 0, x: 0, y: 0, drift: 0 });
  }
  let nextSteam = 0;
  let nextWisp = 0;

  const sky = (tint, mode) => scene.add.image(0, 0, '__WHITE').setOrigin(0).setDisplaySize(WORLD_W, WORLD_H)
    .setTint(tint).setBlendMode(mode).setDepth(DEPTH.light - 1).setAlpha(0);
  const shade = sky(NIGHT_SHADE.tint, Phaser.BlendModes.MULTIPLY);
  const lift = sky(DAY_LIFT.tint, Phaser.BlendModes.SCREEN);
  // The Canvas renderer (no WebGL) can't tint: the layers would be plain white.
  const tints = scene.sys.game.renderer.type === Phaser.WEBGL;
  let glowLevel = 1;  // how strongly lights show: brighter in the dark
  const wind = { strength: 0, angle: 0 };

  let lite = false;  // ambient glows off, when the device is struggling

  return {
    setLite(on) {
      lite = on;
      for (const c of candles) c.glow.setVisible(!on);
      for (const f of flies) f.halo.setVisible(!on);
    },

    // Everything goes red while a Blood Moon is up.
    // 1 at midday, 0 at midnight.
    setDaylight(light) {
      shade.setAlpha(NIGHT_SHADE.alpha * (1 - light)).setVisible(tints && light < 0.99);
      lift.setAlpha(DAY_LIFT.alpha * light).setVisible(tints && light > 0.01);
      glowLevel = 0.55 + 0.75 * (1 - light);
    },

    // How much lights show, for others drawing their own (plots' candles).
    glowLevel: () => glowLevel,

    setWind(strength, angle) {
      wind.strength = strength;
      wind.angle = angle;
    },

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
      // Show the cells near the view, hide the rest (only when that changes).
      const x0 = Math.floor((view.x - CULL_MARGIN) / CELL);
      const x1 = Math.floor((view.right + CULL_MARGIN) / CELL);
      const y0 = Math.floor((view.y - CULL_MARGIN) / CELL);
      const y1 = Math.floor((view.bottom + CULL_MARGIN) / CELL);
      const range = `${x0},${x1},${y0},${y1}`;
      if (range !== shownRange) {
        shownRange = range;
        for (const key of shown) for (const image of cells.get(key)) image.setVisible(false);
        shown = [];
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const key = `${cx},${cy}`;
            if (!cells.has(key)) continue;
            shown.push(key);
            for (const image of cells.get(key)) image.setVisible(true);
          }
        }
      }
      if (!calm) macro.setAlpha(0.86 + 0.14 * Math.sin(time * 0.0006));
      for (const h of hairs) {
        const { prop } = h;
        if (prop.x < view.x - 80 || prop.x > view.right + 80 || prop.y < view.y - 80 || prop.y > view.bottom + 80) continue;
        const by = walkers.find((w) => Math.abs(w.x - prop.x) < 55 && Math.abs(w.y - prop.y) < 40);
        if (by) h.push += ((by.x < prop.x ? 0.35 : -0.35) - h.push) * 0.2;
        else h.push *= 0.94;
        const air = calm ? 0 : 0.045 * Math.sin(time * 0.0011 + h.phase) + 0.02 * Math.sin(time * 0.0031 + h.phase * 2);
        // In a wind the hairs swing round toward the way it blows, in gusts.
        const gust = wind.strength && !calm ? wind.strength * (0.35 + 0.15 * Math.sin(time * 0.003 + h.phase)) * Math.sin(wind.angle - h.rest) : 0;
        prop.setRotation(h.rest + air + h.push + gust);
      }
      for (const c of candles) {
        // Lights well off screen aren't drawn at all.
        const near = !(c.x < view.x - GLOW_SIZE || c.x > view.right + GLOW_SIZE || c.y < view.y - GLOW_SIZE || c.y > view.bottom + GLOW_SIZE);
        c.glow.setVisible(near && !lite);
        if (!near) continue;
        const flicker = 0.88 + 0.08 * Math.sin(time * 0.011 + c.phase) + 0.05 * Math.sin(time * 0.037 + c.phase * 2.3);
        c.glow.setScale((GLOW_SIZE / 256) * (0.96 + 0.04 * flicker)).setAlpha(Math.min(1, 0.42 * flicker * glowLevel));
        c.flame.setScale((11 / 64) * (0.9 + 0.1 * flicker), (11 / 64) * flicker);
      }

      for (const f of flies) {
        const t = time * 0.0006 * f.speed + f.phase;
        const x = f.x + f.rx * Math.sin(t) + 6 * Math.sin(t * 7.3);
        const y = f.y + f.ry * Math.cos(t * 1.3) + 5 * Math.cos(t * 6.1);
        const near = x > view.x - 40 && x < view.right + 40 && y > view.y - 40 && y < view.bottom + 40;
        f.core.setVisible(near);
        f.halo.setVisible(near && !lite);
        if (!near) continue;
        const pulse = 0.55 + 0.45 * Math.sin(time * 0.004 + f.phase);
        f.halo.setPosition(x, y).setAlpha(Math.min(1, (0.35 + 0.35 * pulse) * glowLevel));
        f.core.setPosition(x, y).setAlpha(0.6 + 0.4 * pulse);
      }

      // A wisp of steam off a sweat pool on screen, now and then.
      if (!calm && !lite && time > nextSteam) {
        nextSteam = time + STEAM.every;
        const onScreen = pools.filter((p) => p.x > view.x - 60 && p.x < view.right + 60 && p.y > view.y - 60 && p.y < view.bottom + 60);
        if (onScreen.length) {
          const pool = onScreen[Math.floor(Math.random() * onScreen.length)];
          const s = steam[nextWisp];
          nextWisp = (nextWisp + 1) % steam.length;
          Object.assign(s, { at: time, x: pool.x + (Math.random() - 0.5) * pool.r * 2, y: pool.y + (Math.random() - 0.5) * pool.r, drift: (Math.random() - 0.5) * 30 });
          s.wisp.setVisible(true);
        }
      }
      for (const s of steam) {
        if (!s.wisp.visible) continue;
        const k = (time - s.at) / STEAM.lifeMs;
        if (k >= 1) {
          s.wisp.setVisible(false);
          continue;
        }
        s.wisp.setPosition(s.x + s.drift * k + 6 * Math.sin(time * 0.002 + s.x), s.y - STEAM.rise * k)
          .setDisplaySize(50 + 110 * k, 50 + 110 * k).setAlpha(0.3 * Math.sin(k * Math.PI));
      }

      // Spores live in screen-relative coordinates and wrap, so there are always some on screen.
      for (const s of spores) {
        const blow = calm ? 0 : wind.strength * 0.12;
        s.u = (s.u + ((s.vu + Math.cos(wind.angle) * blow) * delta) / 1000 + 1) % 1;
        s.v = (s.v + ((s.vv + Math.sin(wind.angle) * blow) * delta) / 1000 + 1) % 1;
        const sway = 0.01 * Math.sin(time * 0.001 + s.phase);
        s.mote.setPosition(view.x + (s.u + sway) * view.width, view.y + s.v * view.height);
      }
    },
  };
}
