import { ITCH, itchTarget } from '@hptm/shared';
import { pick } from './roll.js';
import { addTo } from './tally.js';

// The Itch: a goal for the whole world at once. Progress comes from the same
// actions as quests (see the room's progress()); helpers are counted by save,
// so leaving and coming back keeps your share.
export function createItch(room, scale) {
  let itch = null;  // { id, kind, target, progress, endsAt, helpers: Map<profileId, count> }
  let lastId = 0;
  let nextAt = Date.now() + ITCH.firstMs * scale;

  const active = () => Object.values(room.players).filter((p) => !p.away);

  function end(now) {
    itch = null;
    nextAt = now + ITCH.restMs * scale;
    room.markDirty();
  }

  return {
    view() {
      return itch && { id: itch.id, kind: itch.kind, target: itch.target, progress: itch.progress, endsAt: itch.endsAt };
    },

    // How much this player has put in to the current itch (tagged with which one it is).
    share(profileId) {
      return itch && { id: itch.id, count: itch.helpers.get(profileId) ?? 0 };
    },

    tick(now) {
      if (!itch && now >= nextAt) {
        const players = active();
        if (!players.length) {
          nextAt = now + 30_000 * scale;
          return;
        }
        const kind = pick(Object.keys(ITCH.kinds));
        const target = itchTarget(kind, players.length);
        itch = { id: ++lastId, kind, target, progress: 0, endsAt: now + ITCH.lastsMs * scale, helpers: new Map() };
        room.announce(`The Itch! ${ITCH.kinds[kind].text(target)} to scratch it.`, 'itch');
        room.markDirty();
      } else if (itch && now >= itch.endsAt) {
        room.announce('The Itch fades, unscratched. Next time.', 'itch');
        end(now);
      }
    },

    // Called for every quest-kind action. When this one scratches it, returns
    // who helped (profile id → how much) so the room can pay and announce them.
    progress(player, kind, amount) {
      if (!itch || itch.kind !== kind || Date.now() >= itch.endsAt) return null;
      itch.progress = Math.min(itch.target, itch.progress + amount);
      addTo(itch.helpers, player.profileId, amount);
      room.markDirty();
      if (itch.progress < itch.target) return null;
      const { helpers } = itch;
      end(Date.now());
      return helpers;
    },
  };
}
