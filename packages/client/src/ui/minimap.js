import { LANDMARKS, REGIONS, WORLD_EVENT, WORLD_PX, PLOT_SIZE, TILE_SIZE, regionAt } from '@hptm/shared';
import { el, iconButton } from './dom.js';

const SIZE = 92;  // CSS px
const PLOT_PX = PLOT_SIZE * TILE_SIZE;
const EVENT_COLORS = { scab: '#d08a50', gash: '#ff6a7a', tick: '#c8a0f0', ingrown: '#e8b080', blackheads: '#e8e070', lint: '#c8d4f0' };
const REGION_COLORS = { navel: [74, 34, 38], scalp: [34, 22, 28], armpit: [48, 44, 26], freckles: [58, 32, 22], warts: [46, 24, 38] };
// Brighter, for the big map, where the regions are what you're looking at.
const MAP_COLORS = { navel: [128, 62, 68], scalp: [70, 50, 80], armpit: [100, 98, 50], freckles: [128, 78, 48], warts: [104, 56, 88] };
const MAP_MAX = 560;  // CSS px, the big map's largest size
const MAP_REFRESH_MS = 400;

// The regions, drawn once: each pixel the color of where it is.
function regionMap(size, colors = REGION_COLORS) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gr, b] = colors[regionAt(((x + 0.5) / size) * WORLD_PX, ((y + 0.5) / size) * WORLD_PX)];
      const i = (y * size + x) * 4;
      image.data.set([r, gr, b, 215], i);
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

// The big map: the world with every place named, opened from the minimap. Tap
// anywhere on it to walk there. It keeps up with the world while it's open.
function createWorldMap({ onTravel }) {
  const root = el('div', 'world-map');
  root.hidden = true;
  const panel = el('div', 'world-map-panel');
  const header = el('div', 'overlay-header');
  const canvas = el('canvas', 'world-map-canvas');
  const hint = el('p', 'world-map-hint', 'Tap anywhere to walk there.');
  header.append(el('h2', null, 'Map'), iconButton('overlay-close', 'close', 'Close', () => close()));
  panel.append(header, canvas, hint);
  root.append(panel);
  document.body.append(root);
  const g = canvas.getContext('2d');
  const regions = regionMap(200, MAP_COLORS);  // drawn big and smooth, so the borders blur softly
  let size = 0;
  let last = null;  // the latest draw()'s arguments, to draw with on opening
  let timer = null;

  function close() {
    root.hidden = true;
    clearInterval(timer);
  }
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
  canvas.addEventListener('click', (event) => {
    const box = canvas.getBoundingClientRect();
    onTravel(((event.clientX - box.left) / box.width) * WORLD_PX, ((event.clientY - box.top) / box.height) * WORLD_PX);
    close();
  });

  // Labels keep out of each other's way: each tries below its spot, then
  // above, right and left, and takes the first place that's free.
  let placed = [];
  const label = (text, x, y, { font = '15px "Patrick Hand", system-ui, sans-serif', color = '#ffe8d6', gap = 14, fixed = false } = {}) => {
    g.font = font;
    const w = g.measureText(text).width + 6;
    const h = parseInt(font.match(/(\d+)px/)[1], 10) + 2;
    const spots = fixed ? [[x, y]] : [[x, y + gap], [x, y - gap], [x + w / 2 + gap * 0.7, y], [x - w / 2 - gap * 0.7, y]];
    const free = (cx, cy) => placed.every((r) => Math.abs(r.x - cx) * 2 > r.w + w || Math.abs(r.y - cy) * 2 > r.h + h);
    const inside = (cx, cy) => cx - w / 2 >= 0 && cx + w / 2 <= size && cy - h / 2 >= 0 && cy + h / 2 <= size;
    const [lx, ly] = spots.find(([cx, cy]) => free(cx, cy) && inside(cx, cy)) ?? spots[0];
    placed.push({ x: lx, y: ly, w, h });
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20, 8, 10, 0.85)';
    g.strokeText(text, lx, ly);
    g.fillStyle = color;
    g.fillText(text, lx, ly);
  };
  const dot = (x, y, r, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  function draw() {
    if (!last) return;
    const { state, myId, view, time, stray } = last;
    const k = size / WORLD_PX;
    g.clearRect(0, 0, size, size);
    g.imageSmoothingEnabled = true;
    g.drawImage(regions, 0, 0, size, size);
    if (state.bloodMoon) {
      g.fillStyle = 'rgba(120, 8, 18, 0.35)';
      g.fillRect(0, 0, size, size);
    }

    // Plots: mine light, the rest darker, nappers' darker still.
    const plotPx = PLOT_PX * k;
    let mine = null;
    for (const [key, plot] of Object.entries(state.plots)) {
      const [px, py] = key.split(',').map(Number);
      if (plot.ownerId === myId) mine = [px, py];
      g.fillStyle = plot.ownerId === myId ? '#f3c8a8' : plot.away ? 'rgba(70, 36, 42, 0.85)' : 'rgba(150, 76, 86, 0.9)';
      g.fillRect(px * plotPx + 1, py * plotPx + 1, plotPx - 2, plotPx - 2);
    }

    // The places' names go down first; everything else finds room around them.
    placed = [];
    const big = Math.round(Math.max(18, size / 17));
    for (const [id, region] of Object.entries(REGIONS)) {
      if (id === 'navel') continue;
      label(region.name, region.x * k, region.y * k, { font: `${big}px "Rubik Wet Paint", "Patrick Hand", cursive`, fixed: true });
      label(region.line, region.x * k, region.y * k + big * 0.85, { font: '13px "Patrick Hand", system-ui, sans-serif', color: '#e9b9a0', fixed: true });
    }

    // Landmarks.
    const [nx, ny] = [LANDMARKS.navel.x * k, LANDMARKS.navel.y * k];
    g.strokeStyle = '#f0c0a8';
    g.lineWidth = 2;
    for (const r of [9, 5]) {
      g.beginPath();
      g.arc(nx, ny, r, 0, Math.PI * 2);
      g.stroke();
    }
    const [ex, ey] = [LANDMARKS.eye.x * k, LANDMARKS.eye.y * k];
    g.fillStyle = '#f2ece4';
    g.beginPath();
    g.ellipse(ex, ey, 11, 6, 0, 0, Math.PI * 2);
    g.fill();
    dot(ex, ey, 3.5, '#3a7a34');
    const [sx, sy] = [LANDMARKS.statue.x * k, LANDMARKS.statue.y * k];
    g.fillStyle = '#e4dccb';
    g.fillRect(sx - 6, sy - 3, 12, 10);
    dot(sx, sy - 7, 4, '#c8bfae');

    // Everyone here, and what I can see now.
    for (const p of Object.values(state.players)) {
      if (p.id !== myId) dot(p.x * k, p.y * k, 3, p.away ? 'rgba(255, 200, 190, 0.4)' : '#ffc4b4');
    }
    g.strokeStyle = 'rgba(255, 232, 214, 0.6)';
    g.lineWidth = 1.5;
    g.strokeRect(view.x * k, view.y * k, view.width * k, view.height * k);

    // What's going on: the world event, today's stray. And me, on top.
    const happening = state.boss ? { kind: 'boil', x: state.boss.x, y: state.boss.y } : state.event;
    if (happening) dot(happening.x * k, happening.y * k, 5 + Math.sin(time / 180) * 1.5, EVENT_COLORS[happening.kind] ?? '#ff5a4a');
    if (stray) dot(stray.x * k, stray.y * k, 4.5, `rgba(255, 207, 90, ${0.7 + 0.3 * Math.sin(time / 240)})`);
    const me = state.players[myId];
    if (me) {
      dot(me.x * k, me.y * k, 6, 'rgba(20, 8, 10, 0.8)');
      dot(me.x * k, me.y * k, 4.5, '#ffffff');
    }

    // Their labels, most important first.
    const bold = (n) => `bold ${n}px "Patrick Hand", system-ui, sans-serif`;
    if (me) label('You', me.x * k, me.y * k, { font: bold(14), gap: 13 });
    if (happening) label(WORLD_EVENT.names[happening.kind], happening.x * k, happening.y * k, { font: bold(15), color: '#ffd0c0' });
    if (stray) label("Today's stray", stray.x * k, stray.y * k, { font: '13px "Patrick Hand", system-ui, sans-serif', color: '#ffd77a', gap: 12 });
    label('The Navel', nx, ny, { font: bold(15), gap: 20 });
    label('The Eye', ex, ey, { font: bold(15), gap: 17 });
    label(state.statue ? `Statue of ${state.statue.name}` : 'The statue', sx, sy, { font: bold(14), gap: -20 });
    if (mine) label('Your plot', (mine[0] + 0.5) * plotPx, (mine[1] + 0.5) * plotPx, { font: '13px "Patrick Hand", system-ui, sans-serif', color: '#ffe0c8', gap: plotPx / 2 + 8 });
  }

  return {
    open() {
      // As big as the screen allows, sharp on high-density screens.
      // (The screen's edge, less the backdrop's and the panel's padding.)
      size = Math.floor(Math.min(MAP_MAX, window.innerWidth - 56, window.innerHeight - 150));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      root.hidden = false;
      draw();
      clearInterval(timer);
      timer = setInterval(draw, MAP_REFRESH_MS);
    },
    isOpen: () => !root.hidden,
    update(args) {
      last = args;
    },
  };
}

// The whole world at a glance: its regions and landmarks, plots, players, the
// boss, today's stray. Tap it for the big map.
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
  const regions = regionMap(Math.round(SIZE * dpr));
  const big = createWorldMap({ onTravel });
  // A corner mark, so it reads as something to open.
  root.append(el('span', 'minimap-expand', '⤢'));
  root.addEventListener('click', () => big.open());

  return {
    root,
    isOpen: big.isOpen,
    // `stray`: where today's featured stray is, while it's still to be caught.
    draw(state, myId, view, time, stray = null) {
      big.update({ state, myId, view, time, stray });
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
