import Phaser from 'phaser';
import { DEEP_LANDMARKS, DEEP_REGIONS, deepRegionAt } from '@hptm/shared';
import { VEIN, groundCast, veinPath } from './backdrop.js';
import { DEPTH, WORLD_H, WORLD_W, seededRandom, track } from './layout.js';

// Under the Skin (deep.js in @hptm/shared), as drawn: raw muscle for ground,
// fat, clots, marrow and gut lying about by region, arteries that throb out
// from the Heart on every beat, and blood cells drifting through. It has no
// sky: no day or night, no weather, a dim red light everywhere.

// Its art (tools/deep.py), loaded the first time someone goes down: most
// players never do, and needn't download it.
export const DEEP_TEXTURES = [
  'deep-ground', 'deep-plot-0', 'deep-plot-1', 'deep-plot-2',
  'fat-0', 'fat-1', 'clot-0', 'clot-1', 'marrow-0', 'marrow-1', 'coil-0', 'knot', 'heart',
];
let loadingDeep = null;
export function loadDeep(scene) {
  loadingDeep ??= new Promise((resolve) => {
    const base = import.meta.env.BASE_URL;
    const missing = DEEP_TEXTURES.filter((name) => !scene.textures.exists(`world:${name}`));
    if (!missing.length) return resolve();
    for (const name of missing) scene.load.image(`world:${name}`, `${base}world/${name}.webp`);
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
  return loadingDeep;
}

// The Heart's beat, lub-dub, once every HEARTBEAT_MS: 0..1, peaking on each beat.
export const HEARTBEAT_MS = 1150;
export function heartPulse(time) {
  const t = (((time % HEARTBEAT_MS) + HEARTBEAT_MS) % HEARTBEAT_MS) / HEARTBEAT_MS;
  const beat = (at, width) => Math.exp(-(((t - at) / width) ** 2));
  return Math.min(1, beat(0.06, 0.05) + 0.65 * beat(0.27, 0.05));
}

export const DEEP_TINT = 0xa08c88;       // the ground's light down here: dim, a little warm
const BLOOD_TINT = 0xb07070;             // under a Blood Moon (it reaches even in here)
const REGION_TINTS = { veins: 0x9a6a8a, gut: 0xe0a0a0, fat: 0xf0d8a0, marrow: 0xe0d4c0 };
const PROPS = [
  { keys: ['clot-0', 'clot-1'], count: 90, size: [16, 30] },
  { keys: ['fat-0', 'fat-1'], count: 45, size: [26, 50] },
];
const REGION_PROPS = [
  { region: 'veins', keys: ['clot-0', 'clot-1'], count: 70, size: [26, 48] },
  { region: 'gut', keys: ['coil-0'], count: 26, size: [90, 160], spin: true },
  { region: 'fat', keys: ['fat-0', 'fat-1'], count: 150, size: [40, 90] },
  { region: 'marrow', keys: ['marrow-0', 'marrow-1'], count: 46, size: [60, 120], spin: true },
];
const LANDMARK_CLEARANCE = 190;
const ARTERY = { tint: 0xd04858, alpha: 0.75, wave: 0.9 };  // the pulse travels out at about a px per ms
const WARM = { count: 34, size: 380, tint: 0xff5a48, alpha: 0.2 };
const CELLS = 46;   // red blood cells drifting through whatever's on screen
const CELL = 320;   // see backdrop.js: still things are shown a cell at a time near the view
const CULL_MARGIN = 220;

export function createDeepBackdrop(scene) {
  const stopTracking = track(scene);
  const rand = seededRandom(4242);
  const between = (a, b) => a + (b - a) * rand();
  const cells = new Map();
  const still = (image) => {
    const key = `${Math.floor(image.x / CELL)},${Math.floor(image.y / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(image.setVisible(false));
    return image;
  };
  let shown = [];
  let shownRange = '';

  const GROUND_TILE = 512;
  const ground = scene.add.tileSprite(0, 0, 64, 64, 'world:deep-ground')
    .setOrigin(0).setTileScale(0.5).setTint(DEEP_TINT).setDepth(DEPTH.ground);
  ground.updateTileTexture();
  const coverView = (view) => {
    const x = Math.max(0, Math.floor(view.x / GROUND_TILE) * GROUND_TILE);
    const y = Math.max(0, Math.floor(view.y / GROUND_TILE) * GROUND_TILE);
    const w = Math.max(1, Math.min(WORLD_W, Math.ceil(view.right / GROUND_TILE) * GROUND_TILE) - x);
    const h = Math.max(1, Math.min(WORLD_H, Math.ceil(view.bottom / GROUND_TILE) * GROUND_TILE) - y);
    if (ground.x !== x || ground.y !== y) ground.setPosition(x, y);
    if (ground.width !== w || ground.height !== h) ground.setSize(w, h);
  };
  const macro = groundCast(scene, 'deep-cast', REGION_TINTS, DEEP_REGIONS);

  const clear = (x, y) => Object.values(DEEP_LANDMARKS).every((l) => Math.hypot(x - l.x, y - l.y) > LANDMARK_CLEARANCE);
  const place = (key, x, y, size, spin) => {
    const prop = still(scene.add.image(x, y, `world:${key}`).setTint(DEEP_TINT).setDepth(DEPTH.decor));
    prop.setScale(size / prop.width);
    if (spin) prop.setRotation(rand() * Math.PI * 2);
    return prop;
  };
  for (const { keys, count, size, spin } of PROPS) {
    for (let i = 0; i < count; i++) {
      const x = between(0, WORLD_W);
      const y = between(0, WORLD_H);
      if (clear(x, y)) place(keys[Math.floor(rand() * keys.length)], x, y, between(...size), spin);
    }
  }
  for (const { region, keys, count, size, spin } of REGION_PROPS) {
    for (let placed = 0, tries = 0; placed < count && tries < count * 40; tries++) {
      const x = 30 + rand() * (WORLD_W - 60);
      const y = 30 + rand() * (WORLD_H - 60);
      if (deepRegionAt(x, y) !== region || !clear(x, y)) continue;
      placed++;
      place(keys[Math.floor(rand() * keys.length)], x, y, between(...size), spin);
    }
  }

  // Arteries: from the Heart to the Knot and out to each region, branching,
  // each piece knowing how far it is from the Heart, so a beat runs out along them.
  const heart = DEEP_LANDMARKS.heart;
  const knot = DEEP_LANDMARKS.knot;
  const arteries = [];
  const veinRand = seededRandom(99);
  const drawArtery = (points, from, to, start = 0) => {
    let along = start;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      along += Math.hypot(b.x - a.x, b.y - a.y);
      const width = from + (to - from) * (i / points.length);
      const piece = still(scene.add.image((a.x + b.x) / 2, (a.y + b.y) / 2, 'world:vein').setTint(ARTERY.tint).setAlpha(ARTERY.alpha)
        .setRotation(Math.atan2(b.y - a.y, b.x - a.x)).setDisplaySize(VEIN.step * 1.6, width / 0.32).setDepth(DEPTH.decor - 1));
      arteries.push({ piece, along, height: piece.displayHeight });
    }
    return along;
  };
  const fromHeart = (x, y, stopShort = 0) => {
    const angle = Math.atan2(y - heart.y, x - heart.x);
    const length = Math.hypot(x - heart.x, y - heart.y) - stopShort;
    return [heart.x + Math.cos(angle) * 110, heart.y + Math.sin(angle) * 110, heart.x + Math.cos(angle) * length, heart.y + Math.sin(angle) * length];
  };
  drawArtery(veinPath(veinRand, ...fromHeart(knot.x, knot.y, 150)), 26, 18);
  for (const region of Object.keys(REGION_TINTS)) {
    const { x, y } = DEEP_REGIONS[region];
    const points = veinPath(veinRand, ...fromHeart(x, y, -220));
    const length = drawArtery(points, 24, 8);
    for (let b = 0; b < 3; b++) {
      const k = 0.3 + 0.2 * b + veinRand() * 0.1;
      const at = points[Math.floor(points.length * k)];
      const along = Math.atan2(y - heart.y, x - heart.x);
      const angle = along + (veinRand() < 0.5 ? -1 : 1) * (0.5 + veinRand() * 0.6);
      const reach = 180 + veinRand() * 260;
      drawArtery(veinPath(veinRand, at.x, at.y, at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach), 12, 4, length * k);
    }
  }

  // Warm pockets of light, where the flesh glows.
  const warm = [];
  for (let i = 0; i < WARM.count; i++) {
    const x = between(0, WORLD_W);
    const y = between(0, WORLD_H);
    const glow = scene.add.image(x, y, 'world:glow').setTint(WARM.tint).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.light).setDisplaySize(WARM.size, WARM.size).setAlpha(0);
    warm.push({ x, y, glow, phase: rand() * 1000 });
  }

  // Blood cells, drifting and turning over, in screen-relative coordinates
  // that wrap (as the skin's spores do), so there are always a few in view.
  const drift = [];
  for (let i = 0; i < CELLS; i++) {
    const mote = scene.add.image(0, 0, 'world:drop-blood').setDepth(DEPTH.spores).setAlpha(between(0.35, 0.75));
    const size = between(5, 11);
    mote.setDisplaySize(size, size * between(0.5, 0.9));
    drift.push({ mote, size, u: rand(), v: rand(), vu: between(0.004, 0.012), vv: between(-0.01, 0.01), spin: between(-1, 1), phase: rand() * 1000 });
  }

  let lite = false;
  const made = stopTracking();

  return {
    setLite(on) {
      lite = on;
      for (const w of warm) w.glow.setVisible(!on);
    },
    destroy() {
      for (const object of made) object.destroy();
    },
    // No sky down here: always the same dim red light.
    setDaylight() {},
    glowLevel: () => 1.05,
    setWind() {},
    setBloodMoon(on) {
      ground.setTint(on ? BLOOD_TINT : DEEP_TINT);
    },

    update(time, delta, camera, walkers, calm = false) {
      const view = camera.worldView;
      coverView(view);
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
      // The whole place swells a little on each beat.
      if (!calm) macro.setAlpha(0.84 + 0.1 * heartPulse(time));
      // Each beat runs out along the arteries from the Heart.
      for (const a of arteries) {
        if (!a.piece.visible) continue;
        const pulse = calm ? 0 : heartPulse(time - a.along / ARTERY.wave);
        a.piece.setAlpha(ARTERY.alpha * (0.75 + 0.35 * pulse));
        a.piece.displayHeight = a.height * (1 + 0.22 * pulse);
      }
      for (const w of warm) {
        const near = !(w.x < view.x - WARM.size || w.x > view.right + WARM.size || w.y < view.y - WARM.size || w.y > view.bottom + WARM.size);
        w.glow.setVisible(near && !lite);
        if (near && !lite) w.glow.setAlpha(WARM.alpha * (0.8 + 0.2 * Math.sin(time * 0.0012 + w.phase)));
      }
      for (const c of drift) {
        if (!calm) {
          c.u = (c.u + (c.vu * delta) / 1000 + 1) % 1;
          c.v = (c.v + (c.vv * delta) / 1000 + 1) % 1;
        }
        const sway = 0.012 * Math.sin(time * 0.0009 + c.phase);
        c.mote.setPosition(view.x + (c.u + sway) * view.width, view.y + c.v * view.height);
        if (!calm) c.mote.setRotation(c.phase + time * 0.0007 * c.spin);
      }
    },
  };
}

// The Knot, where the Navel comes out underneath (the way back up), with the
// skin's light falling down through it; and the Heart, beating away.
const KNOT_SIZE = 340;
const HEART_SIZE = 300;
const HEART_LINES = ['Ba-dum. Ba-dum.', 'It beats a little faster. It likes you.', 'Warm. Very warm. Slightly sticky.', 'Every beat sends a shiver down the arteries.'];
export { HEART_LINES };

export function createDeepLandmarks(scene) {
  const stopTracking = track(scene);
  const knotAt = DEEP_LANDMARKS.knot;
  const knot = scene.add.image(knotAt.x, knotAt.y, 'world:knot').setTint(DEEP_TINT).setDepth(DEPTH.decor + 2);
  knot.setScale(KNOT_SIZE / knot.width);
  const shaft = scene.add.image(knotAt.x, knotAt.y, 'world:glow').setTint(0xffe2b0).setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.light).setDisplaySize(130, 130).setAlpha(0.7);
  const halo = scene.add.image(knotAt.x, knotAt.y, 'world:glow').setTint(0xffb080).setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.light).setDisplaySize(520, 520).setAlpha(0.22);
  // Dust turning in the light that comes down.
  const motes = Array.from({ length: 10 }, (_, i) => ({
    image: scene.add.image(knotAt.x, knotAt.y, 'world:spore').setTint(0xfff0d0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.spores).setScale(4 / 32),
    phase: i / 10,
    r: 10 + Math.random() * 40,
    a: Math.random() * Math.PI * 2,
  }));

  const heartAt = DEEP_LANDMARKS.heart;
  const baseY = heartAt.y + 90;
  const heartGlow = scene.add.image(heartAt.x, heartAt.y, 'world:glow').setTint(0xff3020).setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.light).setDisplaySize(620, 620).setAlpha(0.2);
  const heart = scene.add.image(heartAt.x, baseY, 'world:heart').setOrigin(0.5, 0.86).setTint(0xc4b0aa).setDepth(baseY);
  const heartScale = HEART_SIZE / heart.width;
  heart.setScale(heartScale);
  let heaveUntil = 0;
  let skipUntil = 0;
  const made = stopTracking();

  return {
    destroy() {
      for (const object of made) object.destroy();
    },
    setStatue() {},
    statue: () => null,
    setBloodMoon(on) {
      heartGlow.setTint(on ? 0xff1010 : 0xff3020);
    },

    update(time, walkers, calm) {
      const pulse = calm ? 0 : heartPulse(time);
      const skip = time < skipUntil ? 0.5 : 1;   // poked: it skips a beat or two
      heart.setScale(heartScale * (1 + 0.05 * pulse * skip), heartScale * (1 + 0.035 * pulse * skip));
      heartGlow.setAlpha(0.14 + 0.18 * pulse * skip);
      const heave = time < heaveUntil ? 0.06 * Math.sin(time * 0.03) * ((heaveUntil - time) / 900) : 0;
      if (!calm) knot.setScale((KNOT_SIZE / knot.width) * (1 + 0.01 * Math.sin(time * 0.0008) + heave));
      shaft.setAlpha(0.6 + 0.12 * Math.sin(time * 0.002));
      for (const m of motes) {
        const k = ((time * 0.00012 + m.phase) % 1);
        const a = m.a + time * 0.0003;
        m.image.setPosition(knotAt.x + Math.cos(a) * m.r, knotAt.y + Math.sin(a) * m.r * 0.6 - k * 90).setAlpha(Math.sin(k * Math.PI) * 0.8);
      }
    },

    at(x, y) {
      if (Math.abs(x - knotAt.x) < 70 && Math.abs(y - knotAt.y) < 60) return 'knot';
      if (Math.abs(x - heartAt.x) < HEART_SIZE * 0.42 && y < baseY + 10 && y > baseY - HEART_SIZE * 0.9) return 'heart';
      return null;
    },

    heave(time, ms = 900) {
      heaveUntil = time + ms;
      return { x: knotAt.x, y: knotAt.y };
    },

    poke(time) {
      skipUntil = time + 2400;
      return { x: heartAt.x, y: baseY - HEART_SIZE * 0.45 };
    },
  };
}

// Where a plot's art comes from on each layer.
export const plotTexture = (layer, variant) => (layer === 'deep' ? `world:deep-plot-${variant}` : `world:plot-${variant}`);
