export const TILE_SIZE = 48;
export const PLOT_SIZE = 3; // tiles per side — each plot is PLOT_SIZE x PLOT_SIZE
export const WORLD_WIDTH_PLOTS = 20;
export const WORLD_HEIGHT_PLOTS = 20;
export const WORLD_PX = WORLD_WIDTH_PLOTS * PLOT_SIZE * TILE_SIZE;
export const PLOT_PX = PLOT_SIZE * TILE_SIZE;  // a plot's side

// The middle of a hole in a plot ("x,y" in plots): slots run across, then down.
export function slotCenter(plotKey, slot) {
  const [px, py] = plotKey.split(',').map(Number);
  return { x: px * PLOT_PX + (slot % PLOT_SIZE + 0.5) * TILE_SIZE, y: py * PLOT_PX + (Math.floor(slot / PLOT_SIZE) + 0.5) * TILE_SIZE };
}

export const STARTING_CURRENCY = 20;
export const NAME_MAX = 20;

// How close you have to be to squeeze a neighbor's crop or hit the boss.
export const REACH = 190;
// Each squeeze takes this share off a crop's remaining grow time; a crop can be squeezed this many times.
export const TEND_SHARE = 0.25;
export const TEND_MAX = 3;
export const TEND_SCRAPS = 3;

// Walking isn't simulated step by step: you arrive after this long, the same on
// every screen and on the server. Grabbing, squeezing and hitting only count once
// you've arrived, so whoever is nearest gets there first.
export const travelMs = (distance) => Math.min(1400, Math.max(150, distance * 2.5));
export const ARRIVAL_SLACK_MS = 150;  // allowance for network jitter
