import { PLOT_PX, WORLD_HEIGHT_PLOTS, WORLD_WIDTH_PLOTS } from '@hptm/shared';

export const WORLD_W = WORLD_WIDTH_PLOTS * PLOT_PX;
export const WORLD_H = WORLD_HEIGHT_PLOTS * PLOT_PX;

// Must match HOLE_OFFSET in tools/world.py, which draws the holes into the plot art.
export const HOLE_OFFSET = 7;
// The plot art overhangs its plot so the puckered rim sits outside the tiles.
export const PLOT_ART_SIZE = 176;

// Things standing on the ground are depth-sorted by y (0..WORLD_H); everything else sits above or below that range.
export const DEPTH = {
  ground: -10000,
  macro: -9990,
  decor: -9000,
  plot: -8000,
  light: -7000,
  flies: 60_000,
  spores: 61_000,
  bubbles: 70_000,
};

// Darkens the ground and what lies on it, so candlelight and the characters stand out.
export const NIGHT_TINT = 0x9a8c90;

export const FONT = '"Patrick Hand", system-ui, sans-serif';

// Same scatter of props for every player.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
