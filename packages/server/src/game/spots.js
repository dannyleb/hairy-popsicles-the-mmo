import { LANDMARKS, PLOT_SIZE, TILE_SIZE, WORLD_PX } from '@hptm/shared';

const PLOT_PX = PLOT_SIZE * TILE_SIZE;

// px from a point to a rectangle of plots ([x, y, width, height] in plots).
function distanceToBlock(x, y, [px, py, w, h]) {
  const dx = Math.max(px * PLOT_PX - x, 0, x - (px + w) * PLOT_PX);
  const dy = Math.max(py * PLOT_PX - y, 0, y - (py + h) * PLOT_PX);
  return Math.hypot(dx, dy);
}

// Nothing to hide here: no plot (whose crops it would cover) or landmark within `clearance` px.
export function clearOfPlots(room, x, y, clearance) {
  for (const key of Object.keys(room.plots)) {
    const [px, py] = key.split(',').map(Number);
    if (distanceToBlock(x, y, [px, py, 1, 1]) < clearance) return false;
  }
  return Object.values(LANDMARKS).every(({ plots }) => distanceToBlock(x, y, plots) >= clearance);
}

// Somewhere a world event can appear near a player: a few tries at a clear
// spot, else the last one tried. `fits(x, y)` says whether a spot is clear.
export function spotNear(near, { dist = [220, 340], margin = 160, tries = 16, fits }) {
  const clamp = (v) => Math.min(WORLD_PX - margin, Math.max(margin, v));
  let spot = null;
  for (let i = 0; i < tries && !spot?.clear; i++) {
    const angle = Math.random() * Math.PI * 2;
    const d = dist[0] + Math.random() * (dist[1] - dist[0]);
    const x = clamp(near.x + Math.cos(angle) * d);
    const y = clamp(near.y + Math.sin(angle) * d);
    spot = { x, y, clear: fits(x, y) };
  }
  return spot;
}

// Players who are actually here (not dropped and waiting to reconnect).
export const present = (room) => Object.values(room.players).filter((p) => !p.away);
