import { WORLD_H, WORLD_W, seededRandom } from './layout.js';

// Little things living on the skin, just for looks (nobody's scores change):
// mites trundling in loops that scatter from anyone walking near, fleas that
// sit and then spring off, and now and then a great pale worm crawling right
// across the world. The worm's route comes from the shared clock, so everyone
// sees it in the same place at the same time.
const MITES = 42;
const FLEAS = 20;
const MITE_SIZE = 19;
const FLEA_SIZE = 15;
const SCARE = 75;             // px: anyone this close sends them off
const FLEE_SPEED = 150;       // px/s
const SQUISHED_MS = 25_000;   // a squished one comes back after this
const MARGIN = 160;           // updated when this near the view

const WORM = {
  periodMs: 5 * 60_000,       // one crossing in each of these
  crawlMs: 100_000,           // how long a crossing takes
  length: 1500,               // px from one end of its route to the other
  segments: 16,
  gap: 17,                    // px between segments
  size: 34,
};

export function createCritters(scene) {
  const rand = seededRandom(4242);
  const between = (a, b) => a + (b - a) * rand();
  const inWorld = (v, max) => Math.min(max - 30, Math.max(30, v));

  const mites = [];
  for (let i = 0; i < MITES; i++) {
    const image = scene.add.image(0, 0, 'world:mite-0').setVisible(false);
    image.setScale(MITE_SIZE / image.width);
    mites.push({
      image, homeX: between(60, WORLD_W - 60), homeY: between(60, WORLD_H - 60),
      r: between(18, 46), w: between(0.00035, 0.0008), phase: rand() * 1000,
      offX: 0, offY: 0, fleeX: 0, fleeY: 0, fleeUntil: 0, squishedUntil: 0, x: 0, y: 0, frame: 0,
    });
  }

  const fleas = [];
  for (let i = 0; i < FLEAS; i++) {
    const image = scene.add.image(0, 0, 'world:flea').setVisible(false);
    image.setScale(FLEA_SIZE / image.width);
    const x = between(60, WORLD_W - 60);
    const y = between(60, WORLD_H - 60);
    fleas.push({ image, x, y, fromX: x, fromY: y, toX: x, toY: y, hopAt: 0, hopUntil: 0, nextHop: between(1000, 6000), squishedUntil: 0 });
  }

  const worm = [];
  for (let i = 0; i < WORM.segments; i++) {
    const image = scene.add.image(0, 0, i === 0 ? 'world:worm-head' : 'world:worm-body').setVisible(false);
    const taper = 1 - 0.45 * (i / (WORM.segments - 1)) ** 1.5;
    image.setScale((WORM.size * taper) / image.width);
    worm.push(image);
  }

  const near = (x, y, view) => x > view.x - MARGIN && x < view.right + MARGIN && y > view.y - MARGIN && y < view.bottom + MARGIN;
  const scaredBy = (x, y, walkers) => walkers.find((w) => Math.abs(w.x - x) < SCARE && Math.abs(w.y - y) < SCARE);

  function updateMite(m, time, delta, walkers, calm) {
    const t = time * m.w + m.phase;
    const baseX = m.homeX + m.r * Math.cos(t);
    const baseY = m.homeY + m.r * Math.sin(t * 1.3);
    const scared = scaredBy(m.x, m.y, walkers);
    if (scared && time > m.fleeUntil - 300) {
      const angle = Math.atan2(m.y - scared.y, m.x - scared.x) + (Math.random() - 0.5) * 0.6;
      m.fleeX = Math.cos(angle) * FLEE_SPEED;
      m.fleeY = Math.sin(angle) * FLEE_SPEED;
      m.fleeUntil = time + 700;
    }
    if (time < m.fleeUntil) {
      m.offX += (m.fleeX * delta) / 1000;
      m.offY += (m.fleeY * delta) / 1000;
    } else {
      // Wander back home bit by bit.
      m.offX *= 0.996;
      m.offY *= 0.996;
    }
    const x = inWorld(baseX + m.offX, WORLD_W);
    const y = inWorld(baseY + m.offY, WORLD_H);
    const dx = x - m.x;
    const dy = y - m.y;
    m.x = x;
    m.y = y;
    // Legs step faster when it runs.
    const fast = time < m.fleeUntil;
    const frame = calm ? 0 : Math.floor(time / (fast ? 60 : 140)) % 2;
    if (frame !== m.frame) {
      m.frame = frame;
      m.image.setTexture(frame ? 'world:mite-1' : 'world:mite-0');
    }
    m.image.setPosition(x, y).setDepth(y).setVisible(true);
    if (dx || dy) m.image.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
  }

  function updateFlea(f, time, walkers) {
    if (time >= f.hopUntil) {
      f.x = f.toX;
      f.y = f.toY;
      const scared = scaredBy(f.x, f.y, walkers);
      if (scared || time > f.nextHop) {
        const angle = scared ? Math.atan2(f.y - scared.y, f.x - scared.x) + (Math.random() - 0.5) * 0.8 : Math.random() * Math.PI * 2;
        const distance = scared ? 70 + Math.random() * 60 : 30 + Math.random() * 50;
        Object.assign(f, {
          fromX: f.x, fromY: f.y,
          toX: inWorld(f.x + Math.cos(angle) * distance, WORLD_W), toY: inWorld(f.y + Math.sin(angle) * distance, WORLD_H),
          hopAt: time, hopUntil: time + 380, nextHop: time + 2500 + Math.random() * 5000,
        });
      }
    }
    let x = f.x;
    let y = f.y;
    let lift = 0;
    if (time < f.hopUntil) {
      const k = (time - f.hopAt) / (f.hopUntil - f.hopAt);
      x = f.fromX + (f.toX - f.fromX) * k;
      y = f.fromY + (f.toY - f.fromY) * k;
      lift = Math.sin(k * Math.PI) * 32;
      f.image.setRotation(Math.atan2(f.toY - f.fromY, f.toX - f.fromX) + Math.PI / 2);
    }
    f.image.setPosition(x, y - lift).setDepth(y).setVisible(true)
      .setScale((FLEA_SIZE / f.image.width) * (1 + lift / 60));
  }

  // The worm's route this period, the same on every screen.
  function wormRoute(period) {
    const r = seededRandom(period * 7919 + 13);
    const angle = r() * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Start so the route runs through the middle part of the world.
    const cx = WORLD_W / 2 + (r() - 0.5) * WORLD_W * 0.4;
    const cy = WORLD_H / 2 + (r() - 0.5) * WORLD_H * 0.4;
    return { x0: cx - dx * WORM.length / 2, y0: cy - dy * WORM.length / 2, dx, dy, wiggle: r() * 10 };
  }

  function wormAt(route, s) {
    const along = s * WORM.length;
    const sway = 70 * Math.sin(s * Math.PI * 5 + route.wiggle);
    return { x: route.x0 + route.dx * along - route.dy * sway, y: route.y0 + route.dy * along + route.dx * sway };
  }

  function updateWorm(now, view) {
    const period = Math.floor(now / WORM.periodMs);
    const into = now - period * WORM.periodMs;
    const crawling = into < WORM.crawlMs;
    const route = crawling && wormRoute(period);
    const head = crawling && wormAt(route, into / WORM.crawlMs);
    const show = crawling && Math.abs(head.x - view.centerX) < view.width / 2 + 600 && Math.abs(head.y - view.centerY) < view.height / 2 + 600;
    for (let i = 0; i < worm.length; i++) {
      const image = worm[i];
      if (!show) {
        image.setVisible(false);
        continue;
      }
      // Each segment follows the head along the route, a little behind.
      const s = into / WORM.crawlMs - (i * WORM.gap) / WORM.length;
      const at = wormAt(route, s);
      const ahead = wormAt(route, s + 0.002);
      // A ripple running down the body as it crawls.
      const squeeze = 1 + 0.12 * Math.sin(now * 0.008 - i * 0.9);
      image.setPosition(at.x, at.y).setDepth(at.y).setVisible(s > 0)
        .setRotation(Math.atan2(ahead.y - at.y, ahead.x - at.x) + Math.PI / 2);
      image.scaleY = image.scaleX * squeeze;
    }
  }

  return {
    // `walkers`: things moving about that scare them ({ x, y }); `now`: the shared clock.
    update(time, delta, now, view, walkers, calm) {
      const dt = Math.min(delta, 100);
      for (const m of mites) {
        const visible = time > m.squishedUntil && near(m.homeX, m.homeY, view);
        if (visible) updateMite(m, time, dt, walkers, calm);
        else m.image.setVisible(false);
      }
      for (const f of fleas) {
        const visible = time > f.squishedUntil && near(f.x, f.y, view);
        if (visible) updateFlea(f, time, walkers);
        else f.image.setVisible(false);
      }
      updateWorm(now, view);
    },

    // A mite or flea under a tap: squished (gone a while), and where it was.
    squishAt(x, y, time) {
      for (const c of [...mites, ...fleas]) {
        if (!c.image.visible) continue;
        if (Math.abs(c.image.x - x) < 16 && Math.abs(c.image.y - y) < 16) {
          c.squishedUntil = time + SQUISHED_MS;
          c.image.setVisible(false);
          return { x: c.image.x, y: c.image.y };
        }
      }
      return null;
    },

    // The worm under a tap, if it's crawling here: where its head is.
    wormAt(x, y) {
      for (const image of worm) {
        if (image.visible && Math.abs(image.x - x) < 22 && Math.abs(image.y - y) < 22) return { x: worm[0].x, y: worm[0].y };
      }
      return null;
    },
  };
}
