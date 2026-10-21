// Day and night, and the weather, both from the clock: every screen agrees
// without the server saying anything. A day is short enough to see one through
// in a sitting. Weather changes every few minutes, picked from the window's
// number, and fades in and out at the edges of its window.
export const SKY = { dayMs: 20 * 60_000, weatherMs: 6 * 60_000, fadeMs: 25_000 };

export const WEATHER = {
  clear: { share: 0.5, line: null },
  dandruff: { share: 0.2, line: 'Dandruff is falling.' },
  fog: { share: 0.15, line: 'A sweaty fog rolls in.' },
  wind: { share: 0.15, line: 'An itchy wind picks up.' },
};

// How light it is: 1 at midday, 0 at midnight, with dusk and dawn between.
export function daylight(now) {
  const phase = (((now % SKY.dayMs) + SKY.dayMs) % SKY.dayMs) / SKY.dayMs;
  return Math.min(1, Math.max(0, 0.5 + 0.9 * Math.cos(phase * Math.PI * 2)));
}

// The same few random numbers for a window, wherever they're asked for.
function windowRandom(index) {
  let a = (index * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// { kind, strength (0..1, fading at the window's edges), angle (the wind's, in radians) }.
export function weatherAt(now) {
  const index = Math.floor(now / SKY.weatherMs);
  const rand = windowRandom(index);
  let pick = rand();
  let kind = 'clear';
  for (const [name, { share }] of Object.entries(WEATHER)) {
    if (pick < share) {
      kind = name;
      break;
    }
    pick -= share;
  }
  const into = now - index * SKY.weatherMs;
  const strength = kind === 'clear' ? 0 : Math.min(1, into / SKY.fadeMs, (SKY.weatherMs - into) / SKY.fadeMs);
  return { kind, strength, angle: rand() * Math.PI * 2 };
}
