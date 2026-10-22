import { INGROWN, REACH } from '@hptm/shared';
import { spotInRegion } from './regionSpot.js';
import { present } from './spots.js';
import { addTo } from './tally.js';

const CLEARANCE = 80;     // px from its middle to the nearest plot
const LATE_MS = 600;      // a tug may arrive this long after its beat (the trip here)

// Ingrown Hair (see INGROWN in @hptm/shared), always in the Scalp. Beats fall
// every beatMs from when it came up; a tug names the beat it was on (the
// client judges the timing, as it's the one that sees the beat) and counts if
// that beat is now or just gone and the player hasn't tugged on it yet. A slip
// (a tap off the beat) lets the hair back one, at most once a beat for each
// player (so nobody can hold it in by mashing). Counted by save.
export function createIngrown(room, scale, done) {
  let hair = null;

  function finish(now, last) {
    const { x, y, tuggers } = hair;
    hair = null;
    done(now);
    room.finishIngrown({ x, y, last, tuggers });
    room.markDirty();
  }

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      const spot = spotInRegion(room, 'scalp', CLEARANCE);
      hair = {
        x: Math.round(spot.x),
        y: Math.round(spot.y),
        startAt: now,
        need: INGROWN.tugs.base + INGROWN.tugs.perPlayer * players.length,
        pulled: 0,
        expiresAt: now + INGROWN.lastsMs * scale,
        tuggers: new Map(),   // profile id → tugs
        lastBeat: new Map(),  // profile id → the last beat they tugged on
        lastSlip: new Map(),  // profile id → the last beat they slipped on
      };
      room.announce('An Ingrown Hair is bulging up in the Scalp! Tug it out in time with its throb.', 'boss');
      room.markDirty();
      return true;
    },

    view() {
      return hair && {
        kind: 'ingrown', x: hair.x, y: hair.y, startAt: hair.startAt, beatMs: INGROWN.beatMs,
        progress: hair.pulled / hair.need, expiresAt: hair.expiresAt,
      };
    },

    tick(now) {
      if (!hair || now < hair.expiresAt) return;
      room.announce('The Ingrown Hair curled back under the skin.', 'boss');
      hair = null;
      done(now);
      room.markDirty();
    },

    // { tugged } or { slipped }, or null for nothing.
    tug(player, { beat, miss }, now) {
      if (!hair || Math.hypot(player.x - hair.x, player.y - hair.y) > REACH) return null;
      // A slip takes back one of your own tugs, so nobody can hold the hair in
      // for everyone else.
      if (miss === true) {
        const beatNow = Math.round((now - hair.startAt) / INGROWN.beatMs);
        const own = hair.tuggers.get(player.profileId) ?? 0;
        if (own <= 0 || (hair.lastSlip.get(player.profileId) ?? -1) >= beatNow) return null;
        hair.lastSlip.set(player.profileId, beatNow);
        hair.tuggers.set(player.profileId, own - 1);
        hair.pulled = Math.max(0, hair.pulled - 1);
        room.markDirty();
        return { slipped: true };
      }
      if (!Number.isInteger(beat) || beat < 1) return null;
      const at = hair.startAt + beat * INGROWN.beatMs;
      if (now < at - INGROWN.window - 100 || now > at + INGROWN.window + LATE_MS) return null;
      if ((hair.lastBeat.get(player.profileId) ?? 0) >= beat) return null;
      hair.lastBeat.set(player.profileId, beat);
      addTo(hair.tuggers, player.profileId);
      hair.pulled += 1;
      if (hair.pulled >= hair.need) finish(now, player);
      else room.markDirty();
      return { tugged: true };
    },
  };
}
