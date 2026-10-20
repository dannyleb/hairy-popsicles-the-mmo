import { PLOT_SIZE, REACH, TILE_SIZE, WORLD_PX } from '@hptm/shared';
import { pick } from './roll.js';

const PLOT_PX = PLOT_SIZE * TILE_SIZE;

// The Boil: a giant pustule that swells up near someone every few minutes.
// Everyone nearby taps it; when it bursts, everyone who hit it gets paid.
const BOSS = {
  firstMs: 45_000,
  everyMs: 4 * 60_000,
  lastsMs: 150_000,
  baseHp: 25,
  hpPerPlayer: 20,
  hitCooldownMs: 110,
  critChance: 0.1,
  critDamage: 3,
  margin: 160,
  spotTries: 16,
  plotClearance: 90,  // px between the boss's middle and the nearest plot edge
};

export function createBoss(room, scale) {
  let boss = null;
  let nextAt = Date.now() + BOSS.firstMs * scale;
  let hpDirty = false;

  function overPlot(x, y) {
    return Object.keys(room.plots).some((key) => {
      const [px, py] = key.split(',').map(Number);
      const dx = Math.max(px * PLOT_PX - x, 0, x - (px + 1) * PLOT_PX);
      const dy = Math.max(py * PLOT_PX - y, 0, y - (py + 1) * PLOT_PX);
      return Math.hypot(dx, dy) < BOSS.plotClearance;
    });
  }

  function spawn(now) {
    // Players whose connection dropped don't count: they can't help pop it.
    const players = Object.values(room.players).filter((p) => !p.away);
    if (!players.length) {
      nextAt = now + 30_000 * scale;
      return;
    }
    const near = pick(players);
    const clamp = (v) => Math.min(WORLD_PX - BOSS.margin, Math.max(BOSS.margin, v));
    // Somewhere near them, but not sitting on anyone's plot, where it would hide their crops.
    let spot = null;
    for (let i = 0; i < BOSS.spotTries && !spot?.clear; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 220 + Math.random() * 120;
      const x = clamp(near.x + Math.cos(angle) * dist);
      const y = clamp(near.y + Math.sin(angle) * dist);
      spot = { x, y, clear: !overPlot(x, y) };
    }
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
  }

  function burst(now) {
    const ranked = [...boss.damage.entries()].sort((a, b) => b[1] - a[1]);
    const [topId] = ranked[0];
    for (const [id, damage] of ranked) {
      const player = room.players[id];
      if (!player) continue;
      const reward = {
        damage,
        top: id === topId,
        scraps: Math.min(80, 8 + 2 * damage),
        xp: 20 + 2 * damage,
        seeds: damage >= 3 ? (id === topId ? 2 : 1) : 0,
      };
      room.rewardBoss(player, reward);
    }
    room.broadcast('bossPopped', { x: boss.x, y: boss.y });
    room.announce(`The Boil burst! ${room.players[topId]?.name ?? 'Someone'} squeezed hardest.`, 'boss');
    boss = null;
    nextAt = now + BOSS.everyMs * scale;
    room.markDirty();
  }

  return {
    view() {
      return boss && { x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, expiresAt: boss.expiresAt };
    },

    tick(now) {
      if (!boss && now >= nextAt) spawn(now);
      else if (boss && now >= boss.expiresAt) {
        room.broadcast('bossGone', {});
        room.announce('The Boil sank back under the skin.', 'boss');
        boss = null;
        nextAt = now + BOSS.everyMs * scale;
        room.markDirty();
      }
    },

    // HP changes go out as their own small message rather than a full state broadcast.
    takeHpUpdate() {
      if (!hpDirty || !boss) return null;
      hpDirty = false;
      return { hp: boss.hp, maxHp: boss.maxHp };
    },

    hit(player, now) {
      if (!boss) return 0;
      if (Math.hypot(player.x - boss.x, player.y - boss.y) > REACH) return 0;
      if (now - player.lastHitAt < BOSS.hitCooldownMs) return 0;
      player.lastHitAt = now;
      const damage = Math.random() < BOSS.critChance ? BOSS.critDamage : 1;
      boss.hp = Math.max(0, boss.hp - damage);
      boss.damage.set(player.id, (boss.damage.get(player.id) ?? 0) + damage);
      hpDirty = true;
      if (boss.hp === 0) burst(now);
      return damage;
    },
  };
}
