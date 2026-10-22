import { BLACKHEADS, REACH } from '@hptm/shared';
import { spotInRegion } from './regionSpot.js';
import { clearOfPlots, present } from './spots.js';

const CLEARANCE = 150;  // px from the patch's middle to the nearest plot
const HEAD_CLEARANCE = 30;  // and from each blackhead (a tap on one mustn't land on someone's crop)
const SPACING = 34;     // px between blackheads
const SQUEEZE_GAP_MS = BLACKHEADS.holdMs - 80;  // a finger held on one, allowing for the network

// Blackheads (see BLACKHEADS in @hptm/shared): a patch of them in the Armpit.
// Each squeezes out once, to whoever's finger got there first. Counted by save.
export function createBlackheads(room, scale, done) {
  let patch = null;

  function finish(now) {
    const { x, y, squeezers } = patch;
    patch = null;
    done(now);
    room.finishBlackheads({ x, y, squeezers });
    room.markDirty();
  }

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      const spot = spotInRegion(room, 'armpit', CLEARANCE);
      const count = Math.min(BLACKHEADS.count.max, BLACKHEADS.count.base + BLACKHEADS.count.perPlayer * players.length);
      const heads = [];
      for (let tries = 0; heads.length < count && tries < count * 30; tries++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * BLACKHEADS.spread;
        const x = Math.round(spot.x + Math.cos(angle) * dist);
        const y = Math.round(spot.y + Math.sin(angle) * dist * 0.75);
        if (!clearOfPlots(room, x, y, HEAD_CLEARANCE)) continue;
        if (heads.every((h) => Math.hypot(h.x - x, h.y - y) >= SPACING)) heads.push({ id: heads.length, x, y, by: null });
      }
      patch = {
        x: Math.round(spot.x), y: Math.round(spot.y), heads,
        expiresAt: now + BLACKHEADS.lastsMs * scale,
        squeezers: new Map(),  // profile id → blackheads squeezed
      };
      room.announce('Blackheads are clogging up the Armpit! Hold on one to squeeze it out.', 'boss');
      room.markDirty();
      return true;
    },

    view() {
      return patch && {
        kind: 'blackheads', x: patch.x, y: patch.y, expiresAt: patch.expiresAt,
        heads: patch.heads.map(({ id, x, y, by }) => ({ id, x, y, done: Boolean(by) })),
      };
    },

    tick(now) {
      if (!patch || now < patch.expiresAt) return;
      // Whatever was squeezed still counts (the fertilizer's made); the rest close over.
      room.announce('The rest of the Blackheads sank back into their pores.', 'boss');
      finish(now);
    },

    // True if that one came out for them.
    squeeze(player, id, now) {
      const head = patch && Number.isInteger(id) ? patch.heads[id] : null;
      if (!head || head.by || Math.hypot(player.x - head.x, player.y - head.y) > REACH) return false;
      if (now - (player.lastSqueezeAt ?? 0) < SQUEEZE_GAP_MS) return false;
      player.lastSqueezeAt = now;
      head.by = player.profileId;
      patch.squeezers.set(player.profileId, (patch.squeezers.get(player.profileId) ?? 0) + 1);
      room.squeezedBlackhead(player, { id });
      if (patch.heads.every((h) => h.by)) finish(now);
      else room.markDirty();
      return true;
    },
  };
}
