import Phaser from 'phaser';
import { textResolution } from '../display.js';
import { settings } from '../settings.js';
import { DEPTH, FONT } from './layout.js';

const SIZE = 170;           // on-screen width at full health
const SWELL = 0.3;          // it swells this much bigger as it nears bursting
const BAR_W = 110;
const BAR_H = 9;
const HIT_RADIUS = 80;

// The Boil, as everyone sees it: swelling up out of the skin, throbbing,
// squishing when hit, and bursting all over the place.
export function createBossView(scene, fx) {
  let boss = null;     // { x, y, hp, maxHp }
  let sprite = null;
  let bar = null;
  let label = null;
  let glow = null;
  let baseScale = 1;
  let squishUntil = 0;

  function health() {
    return boss ? boss.hp / boss.maxHp : 1;
  }

  function spawn() {
    glow = scene.add.image(boss.x, boss.y - 30, 'world:glow').setTint(0xff4a30).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.light).setAlpha(0).setScale(420 / 256);
    sprite = scene.add.image(boss.x, boss.y, 'world:boil').setOrigin(0.5, 0.62).setDepth(boss.y + 30);
    baseScale = SIZE / sprite.width;
    sprite.setScale(0);
    scene.tweens.add({ targets: sprite, scale: baseScale, duration: 1400, ease: 'Back.out' });
    scene.tweens.add({ targets: glow, alpha: 0.5, duration: 1400 });
    bar = scene.add.graphics().setDepth(DEPTH.bubbles - 1);
    label = scene.add.text(boss.x, boss.y, 'The Boil', {
      fontFamily: FONT, fontSize: '16px', color: '#ffd9c0', stroke: '#1a0a0d', strokeThickness: 4, resolution: textResolution(),
    }).setOrigin(0.5, 1).setDepth(DEPTH.bubbles - 1);
    fx.droplets(boss.x, boss.y, { count: 10, key: 'drop-blood', speed: [60, 140] });
  }

  function clear() {
    for (const thing of [sprite, bar, label, glow]) {
      if (!thing) continue;
      scene.tweens.killTweensOf(thing);
      thing.destroy();
    }
    sprite = bar = label = glow = null;
  }

  function sink() {
    if (!sprite) return clear();
    const dying = [sprite, bar, label, glow];
    sprite = bar = label = glow = null;
    boss = null;
    scene.tweens.killTweensOf(dying);
    scene.tweens.add({
      targets: dying,
      alpha: 0,
      scaleY: 0,
      duration: 1200,
      ease: 'Cubic.in',
      onComplete: () => dying.forEach((d) => d.destroy()),
    });
  }

  return {
    sync(next) {
      // A different boil than the one shown (we missed its end while disconnected).
      if (next && boss && (next.x !== boss.x || next.y !== boss.y)) {
        clear();
        boss = null;
      }
      if (next && !boss) {
        boss = { ...next };
        spawn();
      } else if (next) {
        boss.hp = next.hp;
        boss.maxHp = next.maxHp;
      } else if (boss) {
        // 'bossPopped' and 'bossGone' normally end it first; this covers missing them.
        sink();
      }
    },

    setHp(hp, maxHp) {
      if (!boss) return;
      boss.hp = hp;
      boss.maxHp = maxHp;
    },

    contains(x, y) {
      return Boolean(boss && sprite && Math.hypot(x - boss.x, y - (boss.y - 30)) < HIT_RADIUS * (1 + SWELL * (1 - health())));
    },

    position() {
      return boss && { x: boss.x, y: boss.y };
    },

    // My own tap landing: instant feedback before the server's hp update arrives.
    hit() {
      if (!sprite) return;
      squishUntil = scene.time.now + 140;
      fx.droplets(boss.x + Phaser.Math.Between(-30, 30), boss.y - 50, { count: 3, speed: [80, 180], size: [5, 9] });
    },

    pop(x, y) {
      clear();
      boss = null;
      if (!settings.get('calm')) {
        scene.cameras.main.shake(380, 0.012);
        scene.cameras.main.flash(180, 255, 220, 140);
      }
      fx.droplets(x, y - 40, { count: 46, speed: [160, 420], size: [8, 18], up: 1.4 });
      fx.droplets(x, y - 40, { count: 16, key: 'drop-blood', speed: [120, 300], size: [6, 12], up: 1.4 });
      fx.ring(x, y - 30, { color: 0xffd070, size: 520, duration: 700 });
      fx.puddle(x, y, 230);
      fx.puddle(x + 70, y + 30, 120);
      fx.puddle(x - 80, y - 10, 100);
    },

    sink,

    update(time) {
      if (!sprite || !boss) return;
      const swell = baseScale * (1 + SWELL * (1 - health()));
      const throb = 1 + 0.03 * Math.sin(time * 0.006) + 0.015 * Math.sin(time * 0.017);
      const squished = time < squishUntil;
      if (!scene.tweens.isTweening(sprite)) {
        sprite.setScale(swell * throb * (squished ? 1.12 : 1), swell * throb * (squished ? 0.84 : 1));
      }
      // Redder and angrier as it nears bursting.
      const anger = 1 - health();
      sprite.setTint(Phaser.Display.Color.GetColor(255, Math.round(255 - 70 * anger), Math.round(255 - 90 * anger)));
      glow.setAlpha(0.35 + 0.25 * anger + 0.1 * Math.sin(time * 0.008));

      const top = boss.y - sprite.displayHeight * 0.62 - 10;
      label.setPosition(boss.x, top - BAR_H - 4);
      bar.clear();
      bar.fillStyle(0x1a0a0d, 0.85).fillRoundedRect(boss.x - BAR_W / 2 - 2, top - BAR_H - 2, BAR_W + 4, BAR_H + 4, 5);
      bar.fillStyle(health() > 0.3 ? 0xf6c25b : 0xff5a3c, 1).fillRoundedRect(boss.x - BAR_W / 2, top - BAR_H, Math.max(2, BAR_W * health()), BAR_H, 4);
    },
  };
}
