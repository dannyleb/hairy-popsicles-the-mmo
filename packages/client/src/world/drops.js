import Phaser from 'phaser';
import { LANDMARKS } from '@hptm/shared';
import { DEPTH } from './layout.js';

const SIZE = 22;
const GOLD_SIZE = 30;
const LINT_SIZE = 26;
const GRAB_RADIUS = 34;
const FALL = 240;   // globs drop in from this far above where they land

// The globs of a Pus Rain: they fall in, wobble where they landed, and fly off
// to whoever grabs them. Blood from a torn scab is spilled the same way, and
// navel lint is coughed out of the Navel (the special ball glinting).
export function createDropsView(scene, fx) {
  const globs = new Map();

  function remove(id) {
    const glob = globs.get(id);
    if (!glob) return null;
    globs.delete(id);
    glob.glow.destroy();
    scene.tweens.killTweensOf(glob.image);
    return glob;
  }

  return {
    sync(drops = []) {
      const seen = new Set();
      for (const d of drops) {
        seen.add(d.id);
        if (globs.has(d.id)) continue;
        if (d.lint) {
          const glow = scene.add.image(d.x, d.y, 'world:glow').setTint(d.prize ? 0xffcf5a : 0xb8c8f0)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.light).setScale((d.prize ? 110 : 56) / 256).setAlpha(0);
          const image = scene.add.image(LANDMARKS.navel.x, LANDMARKS.navel.y, 'world:lint').setDepth(d.y).setRotation(Math.random() * 6);
          const scale = (d.prize ? LINT_SIZE * 1.3 : LINT_SIZE) / image.width;
          image.setScale(scale * 0.4);
          const glob = { image, glow, gold: d.prize, x: d.x, y: d.y, scale, landed: false, phase: Math.random() * 1000, lint: true };
          globs.set(d.id, glob);
          // Coughed up and out: an arc from the Navel to where it lands.
          const lift = { k: 0 };
          scene.tweens.add({
            targets: lift, k: 1, duration: 500 + Math.random() * 300, ease: 'Sine.out',
            onUpdate: () => image.setPosition(
              LANDMARKS.navel.x + (d.x - LANDMARKS.navel.x) * lift.k,
              LANDMARKS.navel.y + (d.y - LANDMARKS.navel.y) * lift.k - Math.sin(lift.k * Math.PI) * 90,
            ).setScale(scale * (0.4 + 0.6 * lift.k)),
            onComplete: () => {
              glob.landed = true;
              scene.tweens.add({ targets: glow, alpha: d.prize ? 0.7 : 0.35, duration: 200 });
            },
          });
          continue;
        }
        // Gold ones are worth more; blood ones spilled from a scab torn off too soon.
        const glow = scene.add.image(d.x, d.y, 'world:glow').setTint(d.gold ? 0xffcf5a : d.blood ? 0xff5a4a : 0xd8ff70)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.light).setScale((d.gold ? 100 : 64) / 256).setAlpha(0);
        const image = scene.add.image(d.x, d.y - FALL, d.blood ? 'world:drop-blood' : 'world:drop-pus').setOrigin(0.5, 0.8).setDepth(d.y);
        const scale = (d.gold ? GOLD_SIZE : SIZE) / image.width;
        image.setScale(scale * 0.8, scale * 1.3);
        const glob = { image, glow, gold: d.gold, x: d.x, y: d.y, scale, landed: false, phase: Math.random() * 1000 };
        globs.set(d.id, glob);
        scene.tweens.add({
          targets: image,
          y: d.y,
          duration: 420,
          ease: 'Quad.in',
          onComplete: () => {
            glob.landed = true;
            image.setScale(scale);
            fx.droplets(d.x, d.y - 4, { count: 3, speed: [40, 90], size: [3, 6] });
            scene.tweens.add({ targets: glow, alpha: 0.55, duration: 200 });
          },
        });
      }
      // Soaked into the skin (expired) without anyone grabbing them.
      for (const id of [...globs.keys()]) {
        if (seen.has(id)) continue;
        const glob = remove(id);
        scene.tweens.add({ targets: glob.image, alpha: 0, scaleY: 0, duration: 500, onComplete: () => glob.image.destroy() });
      }
    },

    // Someone grabbed it: it flies to them.
    grabbed(id, to) {
      const glob = remove(id);
      if (!glob) return;
      scene.tweens.add({
        targets: glob.image,
        x: to.x,
        y: to.y - 40,
        scale: glob.scale * 0.4,
        alpha: 0.2,
        duration: 260,
        ease: 'Cubic.in',
        onComplete: () => glob.image.destroy(),
      });
    },

    // The glob under a tap, if any (gold ones are easier to hit).
    at(x, y) {
      let best = null;
      for (const [id, glob] of globs) {
        const d = Math.hypot(x - glob.x, y - (glob.y - 8));
        if (d < GRAB_RADIUS * (glob.gold ? 1.3 : 1) && (!best || d < best.d)) best = { id, d, x: glob.x, y: glob.y };
      }
      return best;
    },

    update(time) {
      for (const glob of globs.values()) {
        if (!glob.landed) continue;
        const wobble = Math.sin(time * 0.006 + glob.phase);
        if (!glob.lint) glob.image.setScale(glob.scale * (1 + 0.06 * wobble), glob.scale * (1 - 0.06 * wobble));
        glob.glow.setAlpha(0.4 + 0.2 * wobble);
        if (glob.gold && Math.random() < 0.04) fx.sparkle(glob.x + Phaser.Math.Between(-10, 10), glob.y - 12);
      }
    },
  };
}
