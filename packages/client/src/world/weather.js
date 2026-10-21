import Phaser from 'phaser';
import { DEPTH } from './layout.js';

// The weather (weatherAt in @hptm/shared), drawn over whatever is on screen:
// flakes of dandruff drifting down, banks of sweaty fog, and streaks of an
// itchy wind. Everything lives in screen-relative coordinates (0..1 across
// the view) and wraps, so there's always some in view and none anywhere else.
const FLAKES = 110;
const FOG_BANKS = 7;
const STREAKS = 16;

export function createWeather(scene) {
  const flakes = [];
  for (let i = 0; i < FLAKES; i++) {
    // Flat, ragged-ish flakes: a soft dot squashed a little, each at its own angle.
    const size = 6 + Math.random() * 8;
    const image = scene.add.image(0, 0, 'world:spore').setTint(0xf6f0e6).setDepth(DEPTH.spores + 1)
      .setScale(size / 32, (size * 0.7) / 32).setRotation(Math.random() * Math.PI).setVisible(false);
    flakes.push({ image, u: Math.random(), v: Math.random(), fall: 0.03 + Math.random() * 0.04, phase: Math.random() * 1000, size });
  }
  const banks = [];
  for (let i = 0; i < FOG_BANKS; i++) {
    const image = scene.add.image(0, 0, 'world:glow').setTint(0xe4e6d2).setDepth(DEPTH.flies + 10).setVisible(false);
    banks.push({ image, u: Math.random(), v: Math.random(), drift: (Math.random() - 0.5) * 0.012, size: 0.9 + Math.random() * 0.6 });
  }
  const streaks = [];
  for (let i = 0; i < STREAKS; i++) {
    const image = scene.add.image(0, 0, '__WHITE').setTint(0xfff0e0).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.spores + 2).setVisible(false);
    streaks.push({ image, u: Math.random(), v: Math.random(), speed: 0.5 + Math.random() * 0.5, length: 30 + Math.random() * 50 });
  }
  const hide = (list) => {
    for (const { image } of list) if (image.visible) image.setVisible(false);
  };

  return {
    // `weather`: from weatherAt; `calm`: reduce motion; `lite`: a struggling device.
    update(time, delta, view, weather, calm, lite) {
      const { kind, strength, angle } = weather;
      const dt = Math.min(delta, 100) / 1000;
      const at = (u, v) => [view.x + u * view.width, view.y + v * view.height];

      if (kind === 'dandruff' && strength > 0) {
        const count = lite ? FLAKES / 2 : FLAKES;
        flakes.forEach((f, i) => {
          if (i >= count) return f.image.setVisible(false);
          f.v = (f.v + f.fall * dt * (calm ? 0.4 : 1) + 1) % 1;
          const sway = calm ? 0 : 0.012 * Math.sin(time * 0.0012 + f.phase);
          const [x, y] = at((f.u + sway + 1) % 1, f.v);
          f.image.setPosition(x, y).setAlpha(0.85 * strength).setVisible(true);
        });
      } else hide(flakes);

      if (kind === 'fog' && strength > 0) {
        const count = lite ? FOG_BANKS / 2 : FOG_BANKS;
        banks.forEach((b, i) => {
          if (i >= count) return b.image.setVisible(false);
          b.u = (b.u + b.drift * dt + 1) % 1;
          const [x, y] = at(b.u * 1.4 - 0.2, b.v * 1.4 - 0.2);
          const size = view.width * b.size;
          b.image.setPosition(x, y).setDisplaySize(size, size * 0.7).setAlpha(0.34 * strength).setVisible(true);
        });
      } else hide(banks);

      if (kind === 'wind' && strength > 0 && !calm) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        for (const s of streaks) {
          s.u = (s.u + dx * s.speed * dt + 1) % 1;
          s.v = (s.v + dy * s.speed * dt * (view.width / view.height) + 1) % 1;
          const [x, y] = at(s.u, s.v);
          s.image.setPosition(x, y).setRotation(angle).setDisplaySize(s.length, 1.5)
            .setAlpha(0.22 * strength * (0.6 + 0.4 * Math.sin(time * 0.004 + s.length))).setVisible(true);
        }
      } else hide(streaks);
    },
  };
}
