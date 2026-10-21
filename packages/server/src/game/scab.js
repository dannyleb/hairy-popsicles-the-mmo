import { REACH, SCAB } from '@hptm/shared';
import { pick } from './roll.js';
import { clearOfPlots, present, spotNear } from './spots.js';

const CLEARANCE = 110;  // px from its middle to the nearest plot
const PEEL_GAP_MS = SCAB.holdMs - 150;  // a finger held on it for holdMs, allowing for the network

// The Scab (see SCAB in @hptm/shared). Each piece is 0 while it's on, 1 once
// peeled when dry, 2 if it was torn off early. `room.peeledScab(player, piece)`
// pays for each piece; `room.finishScab(...)` for the whole thing.
export function createScab(room, scale, done) {
  let scab = null;

  function finish(now, last) {
    const { x, y, peelers } = scab;
    scab = null;
    room.finishScab({ x, y, last, peelers });
    done(now);
    room.markDirty();
  }

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      const spot = spotNear(pick(players), { fits: (x, y) => clearOfPlots(room, x, y, CLEARANCE) });
      scab = {
        x: Math.round(spot.x),
        y: Math.round(spot.y),
        pieces: Array(SCAB.pieces).fill(0),
        ripeAt: now + SCAB.ripeMs * scale,
        expiresAt: now + SCAB.lastsMs * scale,
        peelers: new Map(),  // player id → pieces peeled
      };
      room.announce('A Scab has crusted over! Let it dry, then hold on it to peel.', 'boss');
      room.markDirty();
      return true;
    },

    view() {
      return scab && { kind: 'scab', x: scab.x, y: scab.y, pieces: scab.pieces, ripeAt: scab.ripeAt, expiresAt: scab.expiresAt };
    },

    position: () => scab,

    tick(now) {
      if (!scab || now < scab.expiresAt) return;
      room.announce('The Scab flaked off on its own.', 'boss');
      scab = null;
      done(now);
      room.markDirty();
    },

    renamePlayer(oldId, newId) {
      if (!scab?.peelers.has(oldId)) return;
      scab.peelers.set(newId, (scab.peelers.get(newId) ?? 0) + scab.peelers.get(oldId));
      scab.peelers.delete(oldId);
    },

    // A piece off, from the side they're standing on: { piece, torn, last }, or null.
    peel(player, now) {
      if (!scab || Math.hypot(player.x - scab.x, player.y - scab.y) > REACH) return null;
      if (now - (player.lastPeelAt ?? 0) < PEEL_GAP_MS) return null;
      const side = Math.atan2(player.y - scab.y, player.x - scab.x);
      let piece = -1;
      let best = Infinity;
      scab.pieces.forEach((state, i) => {
        if (state) return;
        const middle = ((i + 0.5) / SCAB.pieces) * Math.PI * 2;
        const off = Math.abs(Math.atan2(Math.sin(middle - side), Math.cos(middle - side)));
        if (off < best) {
          best = off;
          piece = i;
        }
      });
      if (piece < 0) return null;
      player.lastPeelAt = now;
      const torn = now < scab.ripeAt;
      scab.pieces[piece] = torn ? 2 : 1;
      scab.peelers.set(player.id, (scab.peelers.get(player.id) ?? 0) + 1);
      const at = { x: scab.x, y: scab.y };
      const last = !scab.pieces.includes(0);
      room.peeledScab(player, { piece, torn, at });
      if (last) finish(now, player);
      else room.markDirty();
      return { piece, torn, last };
    },
  };
}
