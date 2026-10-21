import { DEPTH } from './layout.js';

// A wet smear left on the skin every so often by everyone walking about,
// drying off over half a minute: where people (and strays) have been lately.
// A fixed pool of images, reused oldest first.
const POOL = 90;
const EVERY_PX = 30;
const LIFE_MS = 30_000;
const ALPHA = 0.75;
const SIZE = 22;

export function createTrails(scene) {
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const image = scene.add.image(-100, -100, 'world:smear').setDepth(DEPTH.decor + 1).setVisible(false);
    image.setScale(SIZE / image.width, (SIZE * 1.3) / image.height);
    pool.push({ image, at: 0 });
  }
  let next = 0;
  const last = new Map();  // walker → where it last left a smear

  function drop(x, y, angle, time) {
    const smear = pool[next];
    next = (next + 1) % POOL;
    smear.at = time;
    smear.image.setPosition(x, y).setRotation(angle).setAlpha(ALPHA).setVisible(true);
  }

  return {
    // `walkers`: things that move about ({ x, y } objects, the same ones each frame).
    update(time, walkers, view, enabled) {
      for (const smear of pool) {
        if (!smear.image.visible) continue;
        const age = time - smear.at;
        if (age > LIFE_MS) smear.image.setVisible(false);
        else smear.image.setAlpha(ALPHA * (1 - age / LIFE_MS) ** 1.5);
      }
      if (!enabled) return;
      for (const walker of walkers) {
        const prev = last.get(walker);
        if (!prev) {
          last.set(walker, { x: walker.x, y: walker.y });
          continue;
        }
        const dx = walker.x - prev.x;
        const dy = walker.y - prev.y;
        const moved = Math.hypot(dx, dy);
        if (moved < EVERY_PX) continue;
        if (moved < 200 && view.contains(walker.x, walker.y)) drop(walker.x, walker.y - 2, Math.atan2(dy, dx) + Math.PI / 2, time);
        prev.x = walker.x;
        prev.y = walker.y;
      }
      for (const walker of last.keys()) if (!walker.active) last.delete(walker);
    },
  };
}
