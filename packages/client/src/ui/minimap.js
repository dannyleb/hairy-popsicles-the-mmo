import { LANDMARKS, WORLD_PX, PLOT_SIZE, TILE_SIZE, regionAt } from '@hptm/shared';
import { el } from './dom.js';

const SIZE = 92;  // CSS px
const PLOT_PX = PLOT_SIZE * TILE_SIZE;
const EVENT_COLORS = { scab: '#d08a50', gash: '#ff6a7a', tick: '#c8a0f0' };
const REGION_COLORS = { navel: [74, 34, 38], scalp: [34, 22, 28], armpit: [48, 44, 26], freckles: [58, 32, 22], warts: [46, 24, 38] };

// The regions, drawn once: each pixel the color of where it is.
function regionMap(dpr) {
  const size = Math.round(SIZE * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gr, b] = REGION_COLORS[regionAt(((x + 0.5) / size) * WORLD_PX, ((y + 0.5) / size) * WORLD_PX)];
      const i = (y * size + x) * 4;
      image.data.set([r, gr, b, 215], i);
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

// The whole world at a glance: its regions and landmarks, plots, players, the
// boss, today's stray. Tap it to walk there.
export function createMinimap({ onTravel }) {
  const root = el('div', 'minimap');
  const canvas = el('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  root.append(canvas);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const k = SIZE / WORLD_PX;
  const regions = regionMap(dpr);

  canvas.addEventListener('click', (event) => {
    const box = canvas.getBoundingClientRect();
    onTravel(((event.clientX - box.left) / box.width) * WORLD_PX, ((event.clientY - box.top) / box.height) * WORLD_PX);
  });

  return {
    root,
    // `stray`: where today's featured stray is, while it's still to be caught.
    draw(state, myId, view, time, stray = null) {
      g.clearRect(0, 0, SIZE, SIZE);
      g.drawImage(regions, 0, 0, SIZE, SIZE);
      if (state.bloodMoon) {
        g.fillStyle = 'rgba(110, 6, 16, 0.5)';
        g.fillRect(0, 0, SIZE, SIZE);
      }

      // Landmarks: the Navel, the Eye, the statue.
      g.strokeStyle = 'rgba(233, 185, 160, 0.9)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(LANDMARKS.navel.x * k, LANDMARKS.navel.y * k, 3, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#f2ece4';
      g.beginPath();
      g.ellipse(LANDMARKS.eye.x * k, LANDMARKS.eye.y * k, 3.4, 1.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a6a30';
      g.fillRect(LANDMARKS.eye.x * k - 0.8, LANDMARKS.eye.y * k - 0.8, 1.6, 1.6);
      g.fillStyle = '#d9cfbc';
      g.fillRect(LANDMARKS.statue.x * k - 1.2, LANDMARKS.statue.y * k - 1, 2.4, 3.4);

      for (const [key, plot] of Object.entries(state.plots)) {
        const [px, py] = key.split(',').map(Number);
        g.fillStyle = plot.ownerId === myId ? '#e9b9a0' : plot.away ? '#5a3238' : '#8e4a52';
        g.fillRect(px * PLOT_PX * k + 0.5, py * PLOT_PX * k + 0.5, PLOT_PX * k - 1, PLOT_PX * k - 1);
      }

      g.strokeStyle = 'rgba(255, 232, 214, 0.55)';
      g.lineWidth = 1;
      g.strokeRect(view.x * k, view.y * k, view.width * k, view.height * k);

      g.fillStyle = '#e8e070';
      for (const d of state.drops ?? []) g.fillRect(d.x * k - 0.75, d.y * k - 0.75, 1.5, 1.5);

      if (state.event) {
        const pulse = 3 + Math.sin(time / 180) * 1.2;
        g.fillStyle = EVENT_COLORS[state.event.kind] ?? '#ff5a4a';
        g.beginPath();
        g.arc(state.event.x * k, state.event.y * k, pulse, 0, Math.PI * 2);
        g.fill();
      }

      if (state.boss) {
        const pulse = 3 + Math.sin(time / 180) * 1.2;
        g.fillStyle = '#ff5a4a';
        g.beginPath();
        g.arc(state.boss.x * k, state.boss.y * k, pulse, 0, Math.PI * 2);
        g.fill();
      }

      if (stray) {
        g.fillStyle = `rgba(255, 207, 90, ${0.65 + 0.35 * Math.sin(time / 240)})`;
        g.beginPath();
        g.arc(stray.x * k, stray.y * k, 2.6, 0, Math.PI * 2);
        g.fill();
      }

      const players = Object.values(state.players);
      for (const p of players) {
        const mine = p.id === myId;
        g.fillStyle = mine ? '#ffffff' : p.away ? 'rgba(255, 200, 190, 0.35)' : '#ffc4b4';
        g.beginPath();
        g.arc(p.x * k, p.y * k, mine ? 2.6 : 1.8, 0, Math.PI * 2);
        g.fill();
      }

      // How many people are here: the first thing that makes it feel like an MMO.
      g.font = '12px "Patrick Hand", system-ui, sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillStyle = 'rgba(255, 232, 214, 0.85)';
      g.fillText(`${players.length} here`, SIZE - 4, SIZE - 2);
    },
  };
}
