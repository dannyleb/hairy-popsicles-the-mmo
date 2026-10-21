import { LANDMARKS } from '@hptm/shared';
import { sfx } from './sfx.js';

// Quiet sounds of wherever you are, under the music: the world's heartbeat near
// the Navel, gurgles in the Armpit, hairs rustling in the Scalp, things
// chirping at night, and gusts while an itchy wind blows. Each just plays
// now and then (sfx stays silent while sound is off).
const HEART = { reach: 900, every: 1150 };

export function createAmbience() {
  const next = { heart: 0, gurgle: 0, rustle: 0, chirp: 0, gust: 0 };
  const after = (min, max) => min + Math.random() * (max - min);

  return {
    // `at`: where I am; `region`: its id; `light`: daylight 0..1; `weather`: from weatherAt.
    update(time, { at, region, light, weather }) {
      const toNavel = Math.hypot(at.x - LANDMARKS.navel.x, at.y - LANDMARKS.navel.y);
      if (toNavel < HEART.reach && time > next.heart) {
        next.heart = time + HEART.every;
        sfx.heartbeat((1 - toNavel / HEART.reach) ** 1.5);
      }
      if (region === 'armpit' && time > next.gurgle) {
        next.gurgle = time + after(2500, 6000);
        sfx.gurgle(0.35 + Math.random() * 0.3);
      }
      if (region === 'scalp' && time > next.rustle) {
        next.rustle = time + after(700, 1600);
        sfx.rustle(0.6 + Math.random() * 0.6);
      }
      if (light < 0.35 && time > next.chirp) {
        next.chirp = time + after(1800, 5000);
        sfx.chirp((0.35 - light) / 0.35 * (0.5 + Math.random() * 0.5));
      }
      if (weather.kind === 'wind' && weather.strength > 0 && time > next.gust) {
        next.gust = time + after(900, 2200);
        sfx.gust(weather.strength * (0.6 + Math.random() * 0.5));
      }
    },
  };
}
