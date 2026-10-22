import Phaser from 'phaser';
import { strayPosition } from '@hptm/shared';
import { textResolution } from '../display.js';
import { FONT } from './layout.js';

// Strays: characters loose in the world (see STRAYS in @hptm/shared). The
// server sends each one's current leg; this walks them along it. A little
// smaller than players and without a name, so they don't read as people. The
// day's featured stray glows gold until you've caught it.
const SIZE = 54;
const GOLD = 0xffcf5a;

export function createStraysView(scene) {
  const views = new Map();  // stray id → { stray, container, image, glow, label, x, y, moving }
  let caught = false;

  function make(stray) {
    const shadow = scene.add.image(0, 0, 'world:glow').setTint(0x000000).setAlpha(0.55).setDisplaySize(40, 12);
    const glow = scene.add.image(0, -SIZE * 0.45, 'world:glow').setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(150 / 256).setVisible(false);
    const image = scene.add.image(0, 0, `char:${stray.characterId}`).setOrigin(0.5, 1);
    image.setScale(SIZE / image.width);
    const label = scene.add.text(0, 6, "Today's stray", {
      fontFamily: FONT, fontSize: '13px', color: '#ffd77a', resolution: textResolution(),
    }).setOrigin(0.5, 0).setShadow(0, 1, '#000', 4, false, true).setVisible(false);
    const at = strayPosition(stray, Date.now());
    const container = scene.add.container(at.x, at.y, [shadow, glow, image, label]).setAlpha(0);
    scene.tweens.add({ targets: container, alpha: 1, duration: 600 });
    return { stray, container, image, glow, label, x: at.x, y: at.y, moving: false, facing: 1 };
  }

  function dress(view) {
    const lit = view.stray.featured && !caught;
    view.glow.setVisible(lit);
    view.label.setVisible(lit);
  }

  return {
    // `strays` from the state; `caughtToday`: I've had today's already.
    sync(strays = [], caughtToday = false) {
      caught = caughtToday;
      const seen = new Set();
      for (const stray of strays) {
        seen.add(stray.id);
        let view = views.get(stray.id);
        if (!view) {
          view = make(stray);
          views.set(stray.id, view);
        }
        view.stray = stray;
        dress(view);
      }
      for (const [id, view] of views) {
        if (seen.has(id)) continue;
        views.delete(id);
        scene.tweens.add({ targets: view.container, alpha: 0, duration: 500, onComplete: () => view.container.destroy() });
      }
    },

    update(time, now) {
      for (const view of views.values()) {
        const at = strayPosition(view.stray, now);
        if (at.x !== view.x) view.facing = at.x > view.x ? 1 : -1;
        view.x = at.x;
        view.y = at.y;
        view.moving = at.moving;
        view.container.setPosition(at.x, at.y).setDepth(at.y + 1);
        view.image.setFlipX(view.facing < 0);
        // A slower, lazier hop than a player's.
        if (at.moving) view.image.y = -Math.abs(Math.sin(time * 0.011 + view.stray.id)) * 4;
        else if (!scene.tweens.isTweening(view.image)) view.image.y = 0;
        if (view.glow.visible) view.glow.setAlpha(0.45 + 0.25 * Math.sin(time * 0.004 + view.stray.id));
      }
    },

    // The stray under a tap, if any (the one in front wins).
    at(x, y) {
      let best = null;
      for (const view of views.values()) {
        if (Math.abs(x - view.x) < SIZE * 0.4 && y < view.y + 8 && y > view.y - SIZE) {
          if (!best || view.y > best.y) best = view;
        }
      }
      return best;
    },

    // For the occasional line said out loud, like everyone else on screen.
    speakers(onScreen) {
      return [...views.values()]
        .filter((v) => onScreen(v.x, v.y))
        .map((v) => ({ id: v.stray.characterId, follow: v.container, height: SIZE }));
    },

    featured() {
      return [...views.values()].find((v) => v.stray.featured) ?? null;
    },

    // Somewhere for a critter or a hair to react to.
    positions() {
      return [...views.values()].map((v) => v.container);
    },

    hop(view) {
      scene.tweens.add({ targets: view.image, y: -12, duration: 130, yoyo: true, ease: 'Quad.out' });
    },
  };
}
