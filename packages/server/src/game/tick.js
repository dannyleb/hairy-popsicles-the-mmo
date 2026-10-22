import { PLOT_PX, REACH, TICK, tickFeedsOn } from '@hptm/shared';
import { pick } from './roll.js';
import { clearOfPlots, present, spotNear } from './spots.js';
import { addTo } from './tally.js';

const PRY_GAP_MS = 250;
const NEARBY = 800;  // px: anyone this close could have come and helped pry

// The Tick (see TICK in @hptm/shared). It latches on beside the plot with the
// most growing crops of anyone here, and those crops near it stop growing
// while it feeds: every second it's on, their wait gets a second longer.
// Hands and pries are counted by save, so a player can't be two pairs of hands.
export function createTick(room, scale, done) {
  let tick = null;

  const fedOn = (since) => tickFeedsOn(room.plots, room.players, tick, since);

  // Hold back what grew since the last feed (a crop planted since then, only since it went in).
  function feed(now) {
    const since = tick.fedTo;
    tick.fedTo = now;
    for (const { crop, owner } of fedOn(since)) {
      crop.readyAt += now - Math.max(since, crop.plantedAt);
      owner.saveDirty = true;
    }
    room.markDirty();
  }

  function finish(now, pried) {
    feed(now);
    const { x, y, pries } = tick;
    tick = null;
    // Pried off by one player alone, with others nearby who could have helped: the head stays in.
    const prier = pried && pries.size === 1 ? [...pries.keys()][0] : null;
    const headIn = Boolean(prier) && present(room).some((p) => p.profileId !== prier && Math.hypot(p.x - x, p.y - y) < NEARBY);
    if (headIn) room.announce("The Tick's head broke off in the skin. It'll be back soon.", 'boss');
    done(now, headIn ? { again: 'tick' } : undefined);
    room.finishTick({ x, y, pries, pried, headIn });
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
        fedTo: now,
        expiresAt: now + TICK.lastsMs * scale,
        hands: new Map(),  // profile id → when they last pried
        pries: new Map(),  // profile id → pries
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
      } else {
        feed(now);  // (which also sends the count of hands, as hands come off it)
      }
    },

    // A pry: worth one for each player who's pried just now. Returns that, or 0.
    pry(player, now) {
      if (!tick || Math.hypot(player.x - tick.x, player.y - tick.y) > REACH) return 0;
      if (now - (tick.hands.get(player.profileId) ?? 0) < PRY_GAP_MS) return 0;
      tick.hands.set(player.profileId, now);
      addTo(tick.pries, player.profileId);
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
