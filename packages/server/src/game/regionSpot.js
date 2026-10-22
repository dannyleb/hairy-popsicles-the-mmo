import { REGIONS, regionAt } from '@hptm/shared';
import { clearOfPlots, spotNear } from './spots.js';

// Somewhere clear of plots inside a region, as near its middle as can be found
// (or its very middle, if it's farmed edge to edge).
export function spotInRegion(room, region, clearance) {
  const fits = (x, y) => regionAt(x, y) === region && clearOfPlots(room, x, y, clearance);
  for (const dist of [[0, 220], [150, 480], [350, 800]]) {
    const spot = spotNear(REGIONS[region], { dist, margin: 140, tries: 24, fits });
    if (spot.clear) return spot;
  }
  return { x: REGIONS[region].x, y: REGIONS[region].y, clear: false };
}
