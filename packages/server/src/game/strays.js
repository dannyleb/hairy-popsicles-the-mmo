import { CHARACTERS, STRAYS, WORLD_PX, strayPosition } from '@hptm/shared';
import { pick } from './roll.js';

const between = ([a, b]) => a + Math.random() * (b - a);
const inside = (v) => Math.min(WORLD_PX - STRAYS.margin, Math.max(STRAYS.margin, v));

// The world's strays (see STRAYS in @hptm/shared). The server only decides
// each leg; clients work out the walking from it, so the strays cost a state
// update every few seconds, not every frame.
export function createStrays(room) {
  const strays = new Map();
  let nextId = 1;
  let featured = null;   // character id of the day's featured stray
  let nextSwap = Date.now() + STRAYS.swapMs;

  function leg(stray, now) {
    const from = strayPosition(stray, now);
    const angle = Math.random() * Math.PI * 2;
    const distance = between(STRAYS.leg);
    const x1 = Math.round(inside(from.x + Math.cos(angle) * distance));
    const y1 = Math.round(inside(from.y + Math.sin(angle) * distance));
    const walk = (Math.hypot(x1 - from.x, y1 - from.y) / STRAYS.speed) * 1000;
    Object.assign(stray, {
      x0: Math.round(from.x), y0: Math.round(from.y), x1, y1,
      t0: now, t1: Math.round(now + walk), next: Math.round(now + walk + between(STRAYS.pauseMs)),
    });
  }

  function add(characterId, isFeatured, now) {
    const x = Math.round(inside(Math.random() * WORLD_PX));
    const y = Math.round(inside(Math.random() * WORLD_PX));
    const stray = { id: nextId++, characterId, featured: isFeatured, x0: x, y0: y, x1: x, y1: y, t0: now, t1: now, next: now + between(STRAYS.pauseMs) };
    strays.set(stray.id, stray);
    return stray;
  }

  // Any character but the featured one, and not one already out.
  function another() {
    const out = new Set([...strays.values()].map((s) => s.characterId));
    return pick(CHARACTERS.filter((c) => c.id !== featured && !out.has(c.id))).id;
  }

  return {
    view() {
      return [...strays.values()].map(({ id, characterId, featured: f, x0, y0, x1, y1, t0, t1 }) => ({ id, characterId, featured: f, x0, y0, x1, y1, t0, t1 }));
    },

    // Keeps them walking; a new day brings a new featured stray.
    tick(now, featuredToday) {
      let changed = false;
      if (featured !== featuredToday) {
        for (const [id, s] of strays) if (s.featured || s.characterId === featuredToday) strays.delete(id);
        featured = featuredToday;
        add(featured, true, now);
        changed = true;
      }
      while (strays.size < STRAYS.count) {
        add(another(), false, now);
        changed = true;
      }
      if (now >= nextSwap) {
        nextSwap = now + STRAYS.swapMs;
        const others = [...strays.values()].filter((s) => !s.featured);
        if (others.length) {
          strays.delete(pick(others).id);
          add(another(), false, now);
          changed = true;
        }
      }
      for (const stray of strays.values()) {
        if (now < stray.next) continue;
        leg(stray, now);
        changed = true;
      }
      if (changed) room.markDirty();
    },

    // The featured stray, if `at` is within `reach` of where it is now.
    featuredNear(id, at, reach, now) {
      const stray = strays.get(id);
      if (!stray?.featured) return null;
      const { x, y } = strayPosition(stray, now);
      return Math.hypot(at.x - x, at.y - y) <= reach ? stray : null;
    },
  };
}
