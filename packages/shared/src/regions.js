import { PLOT_SIZE, TILE_SIZE, WORLD_PX } from './constants.js';

// The world's places. The Navel is the middle; around it the skin changes from
// one quarter to the next. Their borders wander a little so they don't look
// ruled. Landmarks stand on blocks of plots nobody can claim.
const MID = WORLD_PX / 2;
const PLOT_PX = PLOT_SIZE * TILE_SIZE;
const NAVEL_REACH = 210;  // px from the middle that still counts as the Navel

export const REGIONS = {
  navel: { name: 'The Navel', line: 'The middle of everything.', x: MID, y: MID },
  scalp: { name: 'The Scalp', line: 'A forest of hairs.', x: MID * 0.5, y: MID * 0.5 },
  armpit: { name: 'The Armpit', line: 'Warm, damp and gurgling.', x: MID * 1.5, y: MID * 0.5 },
  freckles: { name: 'Freckle Flats', line: 'Wide open skin, spotted all over.', x: MID * 0.5, y: MID * 1.5 },
  warts: { name: 'Wart Hills', line: 'Lumpy country.', x: MID * 1.5, y: MID * 1.5 },
};

export function regionAt(x, y) {
  if (Math.hypot(x - MID, y - MID) < NAVEL_REACH) return 'navel';
  const westOf = MID + 140 * Math.sin((y / WORLD_PX) * Math.PI * 3 + 0.7);
  const northOf = MID + 140 * Math.sin((x / WORLD_PX) * Math.PI * 2.6 + 2.1);
  if (y < northOf) return x < westOf ? 'scalp' : 'armpit';
  return x < westOf ? 'freckles' : 'warts';
}

// Each on [first plot x, first plot y, width, height] in plots; x and y are its middle in px.
export const LANDMARKS = {
  navel: { plots: [9, 9, 2, 2] },
  statue: { plots: [9, 7, 2, 2] },
  eye: { plots: [13, 9, 2, 2] },
};
const RESERVED = new Set();
for (const landmark of Object.values(LANDMARKS)) {
  const [x0, y0, w, h] = landmark.plots;
  landmark.x = (x0 + w / 2) * PLOT_PX;
  landmark.y = (y0 + h / 2) * PLOT_PX;
  for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) RESERVED.add(`${x},${y}`);
}

// A plot key ('x,y') under a landmark, where nobody can farm.
export const isReservedPlot = (key) => RESERVED.has(key);
