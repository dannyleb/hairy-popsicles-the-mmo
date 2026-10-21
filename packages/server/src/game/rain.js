import { REACH, WORLD_PX } from '@hptm/shared';
import { pick } from './roll.js';

// Pus Rain: every few minutes, globs of pus rain down around whoever's
// online, and everyone races to grab them. Something to do while crops grow.
const RAIN = {
  firstMs: 90_000,
  everyMs: 5 * 60_000,
  lastsMs: 45_000,
  perTick: 2,          // new globs each second while it rains
  startBurst: 4,       // globs dropped around each player when it starts
  maxDrops: 40,
  lifeMs: 18_000,
  spread: 360,
  margin: 40,
  goldChance: 0.06,
  value: 2,
  goldValue: 10,
};

export function createRain(room, scale) {
  let rain = null;
  let nextAt = Date.now() + RAIN.firstMs * scale;
  const drops = new Map();
  let nextId = 1;

  function dropNear(player, now) {
    if (drops.size >= RAIN.maxDrops) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * RAIN.spread;
    const clamp = (v) => Math.min(WORLD_PX - RAIN.margin, Math.max(RAIN.margin, v));
    const gold = Math.random() < RAIN.goldChance;
    const id = nextId++;
    drops.set(id, {
      id,
      x: Math.round(clamp(player.x + Math.cos(angle) * dist)),
      y: Math.round(clamp(player.y + Math.sin(angle) * dist)),
      gold,
      expiresAt: now + RAIN.lifeMs,
    });
  }

  const active = () => Object.values(room.players).filter((p) => !p.away);

  return {
    view() {
      return rain && { endsAt: rain.endsAt };
    },

    drops() {
      return [...drops.values()].map(({ id, x, y, gold, blood }) => ({ id, x, y, gold, blood }));
    },

    // Globs of blood spilled from something torn open (a scab peeled too soon), for anyone to grab.
    spill(x, y, count) {
      const now = Date.now();
      const clamp = (v) => Math.min(WORLD_PX - RAIN.margin, Math.max(RAIN.margin, v));
      for (let i = 0; i < count && drops.size < RAIN.maxDrops; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 90;
        const id = nextId++;
        drops.set(id, {
          id, x: Math.round(clamp(x + Math.cos(angle) * dist)), y: Math.round(clamp(y + Math.sin(angle) * dist)),
          gold: false, blood: true, expiresAt: now + RAIN.lifeMs,
        });
      }
      room.markDirty();
    },

    tick(now) {
      let changed = false;
      for (const [id, drop] of drops) {
        if (now >= drop.expiresAt) {
          drops.delete(id);
          changed = true;
        }
      }
      if (!rain && now >= nextAt) {
        const players = active();
        if (!players.length) {
          nextAt = now + 30_000 * scale;
        } else {
          rain = { endsAt: now + RAIN.lastsMs * scale };
          for (const p of players) for (let i = 0; i < RAIN.startBurst; i++) dropNear(p, now);
          room.announce('Pus Rain! Grab the globs before they soak in.', 'rain');
          changed = true;
        }
      } else if (rain && now >= rain.endsAt) {
        rain = null;
        nextAt = now + RAIN.everyMs * scale;
        changed = true;
      } else if (rain) {
        const players = active();
        for (let i = 0; i < RAIN.perTick && players.length; i++) dropNear(pick(players), now);
        changed = true;
      }
      if (changed) room.markDirty();
    },

    // Returns what the glob was worth, or 0 if it's gone or out of reach.
    grab(player, id) {
      const drop = drops.get(id);
      if (!drop || Math.hypot(player.x - drop.x, player.y - drop.y) > REACH) return 0;
      drops.delete(id);
      room.broadcast('grabbed', { id, by: player.id });
      room.markDirty();
      return drop.gold ? RAIN.goldValue : RAIN.value;
    },
  };
}
