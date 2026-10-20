export const TILE_SIZE = 48;
export const PLOT_SIZE = 3; // tiles per side — each plot is PLOT_SIZE x PLOT_SIZE
export const WORLD_WIDTH_PLOTS = 20;
export const WORLD_HEIGHT_PLOTS = 20;
export const WORLD_PX = WORLD_WIDTH_PLOTS * PLOT_SIZE * TILE_SIZE;

export const STARTING_CURRENCY = 20;
export const CURRENCY_NAME = 'scraps';
export const NAME_MAX = 20;

// How close you have to be to squeeze a neighbor's crop or hit the boss.
export const REACH = 190;
// Each squeeze takes this share off a crop's remaining grow time; a crop can be squeezed this many times.
export const TEND_SHARE = 0.25;
export const TEND_MAX = 3;
export const TEND_SCRAPS = 3;
