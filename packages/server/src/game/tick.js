import { PLOT_SIZE, REACH, TICK, TILE_SIZE } from '@hptm/shared';
import { pick } from './roll.js';
import { clearOfPlots, present, spotNear } from './spots.js';

const PLOT_PX = PLOT_SIZE * TILE_SIZE;
const PRY_GAP_MS = 250;

// The Tick (see TICK in @hptm/shared). It latches on beside the plot with the
// most growing crops of anyone here; those crops near it stop growing while it
// feeds (their wait gets longer by however long it fed, when it comes off).
export function createTick(room, scale, done) {
  let tick = null;

  // Crops of players who are here, within its reach: [{ crop, owner }].
  function fedOn(now) {
    const crops = [];
    for (const [key, plot] of Object.entries(room.plots)) {
      const owner = room.players[plot.ownerId];
      if (!owner || owner.away) continue;
      const [px, py] = key.split(',').map(Number);
      plot.slots.forEach((crop, slot) => {
        if (!crop || crop.readyAt <= now) return;
        const x = px * PLOT_PX + (slot % PLOT_SIZE + 0.5) * TILE_SIZE;
        const y = py * PLOT_PX + (Math.floor(slot / PLOT_SIZE) + 0.5) * TILE_SIZE;
        if (Math.hypot(x - tick.x, y - tick.y) <= TICK.reach) crops.push({ crop, owner });
      });
    }
    return crops;
  }

  function finish(now, pried) {
    const fed = now - tick.attachedAt;
    for (const { crop, owner } of fedOn(now)) {
      crop.readyAt += fed;
      owner.saveDirty = true;
    }
    const { x, y, pries } = tick;
    tick = null;
    room.finishTick({ x, y, pries, pried, fedMs: fed });
    const players = present(room).length;
    // Pried off by one player alone, with others around to help: the head stays in.
    const headIn = pried && pries.size < 2 && players > 1;
    if (headIn) room.announce("The Tick's head broke off in the skin. It'll be back soon.", 'boss');
    done(now, headIn ? { again: 'tick' } : undefined);
    room.markDirty();
  }

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      // The plot with the most growing crops of anyone here, or else just near someone.
      let target = null;
      let most = 0;
      for (const [key, plot] of Object.entries(room.plots)) {
        const owner = room.players[plot.ownerId];
        if (!owner || owner.away) continue;
        const growing = plot.slots.filter((c) => c && c.readyAt > now).length;
        if (growing > most) {
          most = growing;
          const [px, py] = key.split(',').map(Number);
          target = { x: (px + 0.5) * PLOT_PX, y: (py + 0.5) * PLOT_PX };
        }
      }
      const spot = target
        ? spotNear(target, { dist: [110, 150], margin: 80, fits: (x, y) => clearOfPlots(room, x, y, 22) })
        : spotNear(pick(players), { dist: [200, 300], fits: (x, y) => clearOfPlots(room, x, y, 60) });
      tick = {
        x: Math.round(spot.x),
        y: Math.round(spot.y),
        need: TICK.pry.base + TICK.pry.perPlayer * players.length,
        pried: 0,
        attachedAt: now,
        expiresAt: now + TICK.lastsMs * scale,
        hands: new Map(),  // player id → when they last pried
        pries: new Map(),  // player id → pries
      };
      room.announce('A Tick has latched on! Crops near it stop growing until it is pried off.', 'boss');
      room.markDirty();
      return true;
    },

    view() {
      if (!tick) return null;
      const now = Date.now();
      const hands = [...tick.hands.values()].filter((t) => now - t <= TICK.crowdMs).length;
      return { kind: 'tick', x: tick.x, y: tick.y, progress: tick.pried / tick.need, hands, attachedAt: tick.attachedAt, expiresAt: tick.expiresAt };
    },

    position: () => tick,

    tick(now) {
      if (!tick) return;
      if (now >= tick.expiresAt) {
        room.announce('The Tick drank its fill and dropped off. The crops near it lost time.', 'boss');
        finish(now, false);
      } else if ([...tick.hands.values()].some((t) => now - t > TICK.crowdMs && now - t < TICK.crowdMs + 1500)) {
        room.markDirty();  // someone's hand just came off it: the count of hands changed
      }
    },

    renamePlayer(oldId, newId) {
      if (!tick) return;
      for (const map of [tick.hands, tick.pries]) {
        if (!map.has(oldId)) continue;
        map.set(newId, map.get(oldId));
        map.delete(oldId);
      }
    },

    // A pry: worth one for each player who's pried just now. Returns that, or 0.
    pry(player, now) {
      if (!tick || Math.hypot(player.x - tick.x, player.y - tick.y) > REACH) return 0;
      if (now - (tick.hands.get(player.id) ?? 0) < PRY_GAP_MS) return 0;
      tick.hands.set(player.id, now);
      tick.pries.set(player.id, (tick.pries.get(player.id) ?? 0) + 1);
      const crowd = [...tick.hands.values()].filter((t) => now - t <= TICK.crowdMs).length;
      tick.pried += crowd;
      if (tick.pried >= tick.need) {
        room.announce('The Tick came off!', 'boss');
        finish(now, true);
      } else room.markDirty();
      return crowd;
    },
  };
}
