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

// The world's light. The ground and what lies on it are drawn darker than the
// characters, so they're what you look at (and candlelight shows), in a warm
// light like the one in the characters' renders.
export const NIGHT_TINT = 0x9c8a80;
// Plots and world events, in that same light but a touch brighter, so they
// read as things to tap without glowing out of the world.
export const EVENT_TINT = 0xb2a296;

// A colour (0xRRGGBB) seen in a tint, as the GPU multiplies them.
export function inLight(color, tint = EVENT_TINT) {
  const channel = (shift) => Math.round((((color >> shift) & 255) * ((tint >> shift) & 255)) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

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

// A world event's bar (The Boil's health, The Tick's grip, the hair coming out):
// `k` (0-1) of it filled in `color`, centred on x, its bottom edge at `top`.
export const BAR_H = 9;
const BAR_W = 110;
export function drawBar(g, x, top, k, color) {
  g.clear();
  g.fillStyle(0x1a0a0d, 0.85).fillRoundedRect(x - BAR_W / 2 - 2, top - BAR_H - 2, BAR_W + 4, BAR_H + 4, 5);
  g.fillStyle(color, 1).fillRoundedRect(x - BAR_W / 2, top - BAR_H, Math.max(2, BAR_W * k), BAR_H, 4);
}
