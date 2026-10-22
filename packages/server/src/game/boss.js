import { REACH } from '@hptm/shared';
import { pick } from './roll.js';
import { clearOfPlots, present, spotNear } from './spots.js';
import { addTo } from './tally.js';

// The Boil: a giant pustule that swells up near someone (when it's its turn
// among the world events). Everyone nearby taps it; when it bursts, everyone
// who hit it gets paid.
const BOSS = {
  lastsMs: 150_000,
  baseHp: 25,
  hpPerPlayer: 20,
  hitCooldownMs: 110,
  critChance: 0.1,
  critDamage: 3,
  plotClearance: 90,  // px between the boss's middle and the nearest plot edge
};

// `done(now)`: called when it's over, either way.
export function createBoss(room, scale, done) {
  let boss = null;
  let hpDirty = false;

  // Returns whether it could start (someone has to be here to pop it).
  function start(now) {
    // Players whose connection dropped don't count: they can't help pop it.
    const players = present(room);
    if (!players.length) return false;
    // Somewhere near one of them, but not sitting on anyone's plot, where it would hide their crops.
    const spot = spotNear(pick(players), { fits: (x, y) => clearOfPlots(room, x, y, BOSS.plotClearance) });
    const maxHp = BOSS.baseHp + BOSS.hpPerPlayer * players.length;
    boss = {
      x: spot.x,
      y: spot.y,
      hp: maxHp,
      maxHp,
      expiresAt: now + BOSS.lastsMs * scale,
      damage: new Map(),
    };
    room.announce('A Boil is swelling! Go pop it.', 'boss');
    room.markDirty();
    return true;
  }

  function burst(now) {
    const ranked = [...boss.damage.entries()].sort((a, b) => b[1] - a[1]);
    const [topId] = ranked[0];
    const { x, y } = boss;
    // Over before anyone's paid, so a slip in paying can't leave it stuck on.
    boss = null;
    done(now);
    for (const [id, damage] of ranked) {
      const player = room.players[id];
      if (!player) continue;
      const reward = {
        damage,
        top: id === topId,
        scraps: Math.min(80, 8 + 2 * damage),
        xp: Math.min(100, 20 + 2 * damage),
        seeds: damage >= 3 ? (id === topId ? 2 : 1) : 0,
      };
      room.rewardBoss(player, reward);
    }
    room.broadcast('bossPopped', { x, y });
    room.announce(`The Boil burst! ${room.players[topId]?.name ?? 'Someone'} squeezed hardest.`, 'boss');
    room.markDirty();
  }

  return {
    start,

    view() {
      return boss && { x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, expiresAt: boss.expiresAt };
    },

    tick(now) {
      if (boss && now >= boss.expiresAt) {
        room.broadcast('bossGone', {});
        room.announce('The Boil sank back under the skin.', 'boss');
        boss = null;
        done(now);
        room.markDirty();
      }
    },

    // HP changes go out as their own small message rather than a full state broadcast.
    takeHpUpdate() {
      if (!hpDirty || !boss) return null;
      hpDirty = false;
      return { hp: boss.hp, maxHp: boss.maxHp };
    },

    // A player who reloaded carries on under a new session id; so does their damage.
    renamePlayer(oldId, newId) {
      if (!boss?.damage.has(oldId)) return;
      addTo(boss.damage, newId, boss.damage.get(oldId));
      boss.damage.delete(oldId);
    },

    hit(player, now) {
      if (!boss) return 0;
      if (Math.hypot(player.x - boss.x, player.y - boss.y) > REACH) return 0;
      if (now - player.lastHitAt < BOSS.hitCooldownMs) return 0;
      player.lastHitAt = now;
      const damage = Math.random() < BOSS.critChance ? BOSS.critDamage : 1;
      boss.hp = Math.max(0, boss.hp - damage);
      addTo(boss.damage, player.id, damage);
      hpDirty = true;
      if (boss.hp === 0) burst(now);
      return damage;
    },
  };
}
