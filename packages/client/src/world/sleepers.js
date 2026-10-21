import { textResolution } from '../display.js';
import { isPal } from '../ui/pals.js';
import { FONT, PLOT_PIXELS } from './layout.js';

// Players who are away nap beside the plot the world is keeping for them:
// lying on their side, breathing, with a z drifting up now and then. Even with
// few people online, the world shows who lives here.
const SIZE = 64;
const Z_EVERY = [1600, 2600];

export function createSleepers(scene) {
  const sleepers = new Map();  // plot key → { container, image, label, name, x, y, nextZ, phase }
  const style = (size, color) => ({ fontFamily: FONT, fontSize: `${size}px`, color, resolution: textResolution() });

  function make(key, plot) {
    const [px, py] = key.split(',').map(Number);
    // At the plot's front edge, toward the right, out of the way of its holes.
    const x = px * PLOT_PIXELS + PLOT_PIXELS * 0.7;
    const y = (py + 1) * PLOT_PIXELS + 16;
    const shadow = scene.add.image(0, 0, 'world:glow').setTint(0x000000).setAlpha(0.5).setDisplaySize(58, 12);
    // Lying on their side: the texture's feet are at its bottom, so it tips over onto its back edge.
    const image = scene.add.image(0, -4, `char:${plot.ownerAvatar}`).setOrigin(0.5, 0.75).setRotation(-Math.PI / 2 + 0.12)
      .setTint(0xe6d8d8);
    image.setScale(SIZE / image.width);
    const label = scene.add.text(0, 10, '', style(13, '#d9b8a8')).setOrigin(0.5, 0).setShadow(0, 1, '#000', 3, false, true).setAlpha(0.85);
    const container = scene.add.container(x, y, [shadow, image, label]).setDepth(y).setAlpha(0);
    scene.tweens.add({ targets: container, alpha: 1, duration: 800 });
    return { container, image, label, name: null, x, y: y - SIZE * 0.35, nextZ: 0, phase: Math.random() * 1000, avatar: plot.ownerAvatar };
  }

  function puff(sleeper, time) {
    sleeper.nextZ = time + Z_EVERY[0] + Math.random() * (Z_EVERY[1] - Z_EVERY[0]);
    const z = scene.add.text(sleeper.x - 8, sleeper.y - 10, 'z', style(14 + Math.random() * 6, '#e9d6c8'))
      .setOrigin(0.5).setAlpha(0).setDepth(sleeper.container.depth + 1);
    scene.tweens.add({ targets: z, alpha: 0.8, duration: 300 });
    scene.tweens.add({
      targets: z, x: z.x + 18 + Math.random() * 10, y: z.y - 34, scale: 1.4, alpha: 0, delay: 300, duration: 1500,
      onComplete: () => z.destroy(),
    });
  }

  return {
    sync(plots) {
      const seen = new Set();
      for (const [key, plot] of Object.entries(plots)) {
        if (!plot.away || !plot.ownerAvatar) continue;
        seen.add(key);
        let sleeper = sleepers.get(key);
        if (sleeper && sleeper.avatar !== plot.ownerAvatar) {
          sleeper.container.destroy();
          sleeper = null;
        }
        if (!sleeper) {
          sleeper = make(key, plot);
          sleepers.set(key, sleeper);
        }
        const name = `${isPal(plot.ownerPid) ? '♥ ' : ''}${plot.ownerName}`;
        if (sleeper.name !== name) {
          sleeper.name = name;
          sleeper.label.setText(`${name} · asleep`);
        }
      }
      for (const [key, sleeper] of sleepers) {
        if (seen.has(key)) continue;
        sleepers.delete(key);
        scene.tweens.add({ targets: sleeper.container, alpha: 0, duration: 400, onComplete: () => sleeper.container.destroy() });
      }
    },

    // Breathing, and the odd z, for those on screen.
    update(time, view, calm) {
      for (const sleeper of sleepers.values()) {
        if (!view.contains(sleeper.x, sleeper.y)) continue;
        const breath = calm ? 0 : Math.sin(time * 0.0016 + sleeper.phase);
        sleeper.image.setScale((SIZE / sleeper.image.width) * (1 + 0.035 * breath), (SIZE / sleeper.image.width) * (1 - 0.02 * breath));
        if (!calm && time > sleeper.nextZ) puff(sleeper, time);
      }
    },

    // The plot key of whoever's asleep under a tap.
    at(x, y) {
      for (const [key, sleeper] of sleepers) {
        if (Math.abs(x - sleeper.container.x) < SIZE * 0.6 && Math.abs(y - sleeper.container.y + 10) < 24) return key;
      }
      return null;
    },
  };
}
