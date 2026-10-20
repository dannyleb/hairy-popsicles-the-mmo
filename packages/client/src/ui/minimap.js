import { WORLD_PX, PLOT_SIZE, TILE_SIZE } from '@hptm/shared';
import { el } from './dom.js';

const SIZE = 92;  // CSS px
const PLOT_PX = PLOT_SIZE * TILE_SIZE;

// The whole world at a glance: plots, players, the boss. Tap it to walk there.
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

  canvas.addEventListener('click', (event) => {
    const box = canvas.getBoundingClientRect();
    onTravel(((event.clientX - box.left) / box.width) * WORLD_PX, ((event.clientY - box.top) / box.height) * WORLD_PX);
  });

  return {
    root,
    draw(state, myId, view, time) {
      g.clearRect(0, 0, SIZE, SIZE);
      g.fillStyle = state.bloodMoon ? 'rgba(70, 8, 14, 0.85)' : 'rgba(40, 18, 22, 0.8)';
      g.fillRect(0, 0, SIZE, SIZE);

      for (const [key, plot] of Object.entries(state.plots)) {
        const [px, py] = key.split(',').map(Number);
        g.fillStyle = plot.ownerId === myId ? '#e9b9a0' : '#8e4a52';
        g.fillRect(px * PLOT_PX * k + 0.5, py * PLOT_PX * k + 0.5, PLOT_PX * k - 1, PLOT_PX * k - 1);
      }

      g.strokeStyle = 'rgba(255, 232, 214, 0.55)';
      g.lineWidth = 1;
      g.strokeRect(view.x * k, view.y * k, view.width * k, view.height * k);

      if (state.boss) {
        const pulse = 3 + Math.sin(time / 180) * 1.2;
        g.fillStyle = '#ff5a4a';
        g.beginPath();
        g.arc(state.boss.x * k, state.boss.y * k, pulse, 0, Math.PI * 2);
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
