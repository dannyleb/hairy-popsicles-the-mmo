import { GASH, REACH } from '@hptm/shared';
import { pick } from './roll.js';
import { clearOfPlots, present, spotNear } from './spots.js';

const CLEARANCE = 50;      // px from any point along it to the nearest plot
const PICK_GAP_MS = 200;
const ALONG = [-0.5, -0.25, 0, 0.25, 0.5];  // points checked along its length for a clear spot

// The Gash (see GASH in @hptm/shared): a wound with crumbs of crust along it.
// `room.pickedCrumb(player, ...)` pays for each; `room.finishGash(...)` for a clean one.
export function createGash(room, scale, done) {
  let gash = null;

  function along(x, y, angle, t) {
    return { x: x + Math.cos(angle) * GASH.length * t, y: y + Math.sin(angle) * GASH.length * t };
  }

  function credit(id, n = 1) {
    gash.pickers.set(id, (gash.pickers.get(id) ?? 0) + n);
  }

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      const angle = (Math.random() - 0.5) * Math.PI * 0.6;  // more across than up and down, as it looks best
      const fits = (x, y) => ALONG.every((t) => {
        const p = along(x, y, angle, t);
        return clearOfPlots(room, p.x, p.y, CLEARANCE);
      });
      const spot = spotNear(pick(players), { dist: [240, 360], margin: GASH.length / 2 + 40, fits });
      const count = Math.min(GASH.crumbs.max, GASH.crumbs.base + GASH.crumbs.perPlayer * players.length);
      const crumbs = [];
      for (let i = 0; i < count; i++) {
        const t = -0.44 + 0.88 * ((i + 0.2 + Math.random() * 0.6) / count);
        const p = along(spot.x, spot.y, angle, t);
        const off = (Math.random() - 0.5) * 12;
        crumbs.push({
          id: i,
          x: Math.round(p.x - Math.sin(angle) * off),
          y: Math.round(p.y + Math.cos(angle) * off),
          // A deep one needs two players, so only when there could be two.
          deep: players.length > 1 && i % GASH.deepEvery === 2,
          loose: null,  // { by, until }: someone's working at it
          picked: false,
        });
      }
      gash = {
        x: Math.round(spot.x), y: Math.round(spot.y), angle, crumbs,
        expiresAt: now + GASH.lastsMs * scale,
        pickers: new Map(),  // player id → crumbs picked
      };
      room.announce('A Gash has torn open! Pick the crust out of it.', 'boss');
      room.markDirty();
      return true;
    },

    view() {
      if (!gash) return null;
      const crumbs = gash.crumbs.filter((c) => !c.picked).map(({ id, x, y, deep, loose }) => ({ id, x, y, deep, loose: loose?.until ?? 0 }));
      return { kind: 'gash', x: gash.x, y: gash.y, angle: gash.angle, length: GASH.length, crumbs, total: gash.crumbs.length, expiresAt: gash.expiresAt };
    },

    position: () => gash,

    tick(now) {
      if (!gash || now < gash.expiresAt) return;
      room.announce('The Gash crusted over by itself.', 'boss');
      gash = null;
      done(now);
      room.markDirty();
    },

    renamePlayer(oldId, newId) {
      if (!gash) return;
      if (gash.pickers.has(oldId)) {
        credit(newId, gash.pickers.get(oldId));
        gash.pickers.delete(oldId);
      }
    },

    // { picked, deep, helper } once it's out; { loosened } for the first hand on a deep one; null for nothing.
    pick(player, id, now) {
      const crumb = gash && Number.isInteger(id) ? gash.crumbs[id] : null;
      if (!crumb || crumb.picked || Math.hypot(player.x - crumb.x, player.y - crumb.y) > REACH) return null;
      if (now - (player.lastPickAt ?? 0) < PICK_GAP_MS) return null;
      player.lastPickAt = now;
      // (Hands by save: leaving and coming back as a new connection isn't a second pair.)
      if (crumb.deep && (!crumb.loose || now > crumb.loose.until || crumb.loose.by === player.profileId)) {
        crumb.loose = { by: player.profileId, until: now + GASH.looseMs };
        room.markDirty();
        return { loosened: true };
      }
      crumb.picked = true;
      const helper = crumb.deep ? Object.values(room.players).find((p) => p.profileId === crumb.loose.by) ?? null : null;
      credit(player.id);
      if (helper) credit(helper.id);
      room.pickedCrumb(player, { id: crumb.id, deep: crumb.deep, helper });
      if (gash.crumbs.every((c) => c.picked)) {
        const { x, y, angle, pickers } = gash;
        gash = null;
        done(now);
        room.finishGash({ x, y, angle, pickers });
      }
      room.markDirty();
      return { picked: true, deep: crumb.deep, helper };
    },
  };
}
