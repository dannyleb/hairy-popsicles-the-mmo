import Phaser from 'phaser';
import { textResolution } from '../display.js';
import { DEPTH, FONT } from './layout.js';

const GRAVITY = 520;  // px/s² for flying goo

// Short-lived effects: goo flying, numbers floating up, rings, puddles left behind.
export function createFx(scene) {
  function droplets(x, y, { count = 8, key = 'drop-pus', speed = [90, 220], size = [6, 12], up = 0.9, depth = DEPTH.flies - 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const drop = scene.add.image(x, y, `world:${key}`).setDepth(depth);
      drop.setScale(Phaser.Math.FloatBetween(...size) / drop.width);
      // Mostly upward, then falling back down.
      const angle = -Math.PI / 2 + Phaser.Math.FloatBetween(-1.4, 1.4) * up;
      const v = Phaser.Math.FloatBetween(...speed);
      const vx = Math.cos(angle) * v;
      const vy = Math.sin(angle) * v;
      const life = Phaser.Math.Between(450, 750);
      scene.tweens.addCounter({
        from: 0,
        to: life / 1000,
        duration: life,
        onUpdate: (tween) => {
          const t = tween.getValue();
          drop.setPosition(x + vx * t, y + vy * t + 0.5 * GRAVITY * t * t);
          drop.setAlpha(1 - (t * 1000) / life);
        },
        onComplete: () => drop.destroy(),
      });
    }
  }

  function float(x, y, text, { color = '#ffe8d6', size = 18, delay = 0, rise = 46 } = {}) {
    const label = scene.add.text(x, y, text, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      stroke: '#1a0a0d',
      strokeThickness: 4,
      resolution: textResolution(),
    }).setOrigin(0.5, 1).setDepth(DEPTH.bubbles + 1).setAlpha(0);
    scene.tweens.add({ targets: label, alpha: 1, duration: 120, delay });
    scene.tweens.add({
      targets: label,
      y: y - rise,
      duration: 1100,
      delay,
      ease: 'Cubic.out',
      onComplete: () => scene.tweens.add({ targets: label, alpha: 0, duration: 250, onComplete: () => label.destroy() }),
    });
  }

  function ring(x, y, { color = 0xffe2a0, size = 90, duration = 450 } = {}) {
    const glow = scene.add.image(x, y, 'world:glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.light).setScale(0.05).setAlpha(0.9);
    scene.tweens.add({
      targets: glow,
      scale: size / 256,
      alpha: 0,
      duration,
      ease: 'Cubic.out',
      onComplete: () => glow.destroy(),
    });
  }

  // Goo left on the ground that slowly soaks in.
  function puddle(x, y, size = 120, key = 'pus-0') {
    const stain = scene.add.image(x, y, `world:${key}`).setDepth(DEPTH.decor + 1).setAlpha(0);
    stain.setScale(size / stain.width).setRotation(Math.random() * Math.PI * 2);
    scene.tweens.add({ targets: stain, alpha: 0.9, duration: 200 });
    scene.tweens.add({ targets: stain, alpha: 0, delay: 14_000, duration: 6000, onComplete: () => stain.destroy() });
  }

  // A quick squash and stretch, as if squeezed.
  function squish(target, baseX, baseY, amount = 0.2) {
    scene.tweens.add({
      targets: target,
      scaleX: baseX * (1 + amount),
      scaleY: baseY * (1 - amount),
      duration: 70,
      yoyo: true,
      ease: 'Quad.out',
      onComplete: () => target.setScale(baseX, baseY),
    });
  }

  // A gold glint drifting up off something shiny.
  function sparkle(x, y) {
    const glint = scene.add.image(x, y, 'world:spore').setTint(0xffe08a).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.flies - 1).setScale(Phaser.Math.FloatBetween(5, 9) / 32);
    scene.tweens.add({
      targets: glint,
      y: y - Phaser.Math.Between(14, 30),
      alpha: 0,
      scale: glint.scale * 0.4,
      duration: Phaser.Math.Between(600, 900),
      ease: 'Sine.out',
      onComplete: () => glint.destroy(),
    });
  }

  // A mote left behind someone walking as a Rare or better: it hangs, then fades.
  // `depth` is the walker's, so motes sit just behind them, over the ground and plots.
  function trail(x, y, tint, size = 7, depth = DEPTH.flies - 1) {
    const mote = scene.add.image(x + Phaser.Math.Between(-8, 8), y + Phaser.Math.Between(-6, 4), 'world:spore')
      .setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth)
      .setScale(Phaser.Math.FloatBetween(size * 0.7, size * 1.3) / 32).setAlpha(0.9);
    scene.tweens.add({
      targets: mote,
      y: mote.y - Phaser.Math.Between(4, 12),
      alpha: 0,
      scale: mote.scale * 0.3,
      duration: Phaser.Math.Between(700, 1100),
      ease: 'Sine.in',
      onComplete: () => mote.destroy(),
    });
  }

  // One drop of a Pus Rain, falling somewhere on screen.
  function rainDrop(view) {
    const x = view.x + Math.random() * view.width;
    const y = view.y + view.height * (0.1 + Math.random() * 0.9);
    const drop = scene.add.image(x, y - 300, 'world:drop-pus').setDepth(DEPTH.flies - 1).setAlpha(0.75);
    const size = Phaser.Math.FloatBetween(4, 8) / drop.width;
    drop.setScale(size, size * 2.2);
    scene.tweens.add({
      targets: drop,
      y,
      duration: 360,
      ease: 'Quad.in',
      onComplete: () => {
        drop.destroy();
        droplets(x, y, { count: 2, speed: [30, 70], size: [2, 4], depth: DEPTH.decor + 2 });
      },
    });
  }

  return { droplets, float, ring, puddle, squish, sparkle, trail, rainDrop };
}
