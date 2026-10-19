export const TILE_SIZE = 32;
export const PLOT_SIZE = 4; // tiles per side — each plot is PLOT_SIZE x PLOT_SIZE
export const WORLD_WIDTH_PLOTS = 20;
export const WORLD_HEIGHT_PLOTS = 20;

export const STARTING_CURRENCY = 20;
export const CURRENCY_NAME = 'scraps';

// Placeholder economy — rename/rebalance once real art + theme pass lands.
export const ITEM_DEFS = {
  wart_sprout: { id: 'wart_sprout', name: 'Wart Sprout', cost: 5, growMs: 60_000, yieldMin: 3, yieldMax: 6 },
  pus_bloom: { id: 'pus_bloom', name: 'Pus Bloom', cost: 15, growMs: 5 * 60_000, yieldMin: 10, yieldMax: 18 },
  popsicle_sapling: { id: 'popsicle_sapling', name: 'Popsicle Sapling', cost: 40, growMs: 30 * 60_000, yieldMin: 35, yieldMax: 60 },
};
