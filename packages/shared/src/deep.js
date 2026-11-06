import { WORLD_PX } from './constants.js';
import { HOLE_ORDER, holesFor, levelForHole } from './progression.js';
import { LANDMARKS, NAVEL_REACH, REGIONS, isReservedPlot, placeLandmarks, regionAt } from './regions.js';

// Under the Skin: a second layer of the world, under the skin, reached by
// climbing down the Navel from level DEEP.level (and back up through the Knot,
// where the Navel comes out underneath). It's the same size, on the same plot
// grid, with its own places, landmarks and seeds, and everyone keeps a plot in
// each. Crops grow slower down here but pay double XP (it's where levels 16-25
// are earned), more scraps, and twice the shinies. A Legendary comes up rooted:
// a neighbor can loosen it for you, or it works loose by itself after a while.
// Chat, announcements and the Itch reach both layers; world events, strays and
// weather stay up on the skin.
export const DEEP = {
  level: 15,
  name: 'Under the Skin',
  growSlower: 1.5,
  xp: 2,
  scraps: 1.5,
  shiny: 2,
  rootedFrom: 'legendary',  // this rarity and up come up rooted
  rootMs: 2 * 60_000,       // a rooted crop works loose by itself this long after it ripens
  loosen: { scraps: 12, xp: 40 },  // for loosening a neighbor's
  travelMs: 2500,           // the least time between climbs, either way
};

const MID = WORLD_PX / 2;
export const DEEP_REGIONS = {
  knot: { name: 'The Knot', line: 'Where the Navel is tied off, from the inside.', x: MID, y: MID },
  veins: { name: 'The Veinwood', line: 'Listen to them pump.', x: MID * 0.5, y: MID * 0.5 },
  gut: { name: 'The Gut', line: 'Warm, loud, rumbling.', x: MID * 1.5, y: MID * 0.5 },
  fat: { name: 'The Fat Fields', line: 'Soft, yellow, wobbly.', x: MID * 0.5, y: MID * 1.5 },
  marrow: { name: 'The Marrow Pits', line: 'Down to the bone.', x: MID * 1.5, y: MID * 1.5 },
};

export function deepRegionAt(x, y) {
  if (Math.hypot(x - MID, y - MID) < NAVEL_REACH) return 'knot';
  const westOf = MID + 160 * Math.sin((y / WORLD_PX) * Math.PI * 2.4 + 1.9);
  const northOf = MID + 160 * Math.sin((x / WORLD_PX) * Math.PI * 3.1 + 0.4);
  if (y < northOf) return x < westOf ? 'veins' : 'gut';
  return x < westOf ? 'fat' : 'marrow';
}

// The Knot is right under the Navel; the Heart beats off to the east.
export const DEEP_LANDMARKS = {
  knot: { plots: [9, 9, 2, 2] },
  heart: { plots: [13, 9, 2, 2] },
};
const DEEP_RESERVED = placeLandmarks(DEEP_LANDMARKS);

// Each layer's places: its regions, landmarks, plots nobody can farm, and the
// landmark that's the way through to the other layer.
export const PLACES = {
  surface: { regions: REGIONS, regionAt, landmarks: LANDMARKS, isReserved: isReservedPlot, door: 'navel', other: 'deep' },
  deep: { regions: DEEP_REGIONS, regionAt: deepRegionAt, landmarks: DEEP_LANDMARKS, isReserved: (key) => DEEP_RESERVED.has(key), door: 'knot', other: 'surface' },
};
export const isLayer = (layer) => layer === 'surface' || layer === 'deep';

// Holes Under the Skin: three at DEEP.level, one more each level until all
// nine are open at 21.
export const deepHolesFor = (level) => (level < DEEP.level ? 0 : Math.min(HOLE_ORDER.length, 3 + level - DEEP.level));
export const holeOpenIn = (layer, slot, level) => HOLE_ORDER.indexOf(slot) < (layer === 'deep' ? deepHolesFor(level) : holesFor(level));
export const levelForHoleIn = (layer, slot) => (layer === 'deep' ? Math.max(DEEP.level, DEEP.level - 2 + HOLE_ORDER.indexOf(slot)) : levelForHole(slot));
