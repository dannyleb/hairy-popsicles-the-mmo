import { CHARACTERS, CHARACTER_BY_ID, RARITIES, RARITY_ORDER } from '@hptm/shared';
import { bigSpriteUrl, spriteUrl } from './dom.js';

// A picture of your album to post anywhere: who you play as, your level and
// title, and every character (silhouettes for the ones still to find).
const W = 1080;
const H = 1350;
const GAME_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;

function load(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

// Draw an image fitted into a box, keeping its shape.
function fit(ctx, image, x, y, size) {
  const scale = Math.min(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
}

// The same image as a flat silhouette (works where canvas filters don't).
function silhouette(image, color) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function drawShareCard({ name, title, level, avatar, collection, shinies, nameColor }) {
  await Promise.all([
    document.fonts.load('96px "Rubik Wet Paint"'),
    document.fonts.load('48px "Patrick Hand"'),
  ]).catch(() => {});
  const order = [...CHARACTERS].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
  const [hero, ...sprites] = await Promise.all([load(bigSpriteUrl(avatar)), ...order.map((c) => load(spriteUrl(c.id)))]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const background = ctx.createRadialGradient(W / 2, 420, 60, W / 2, 520, 900);
  background.addColorStop(0, '#4a1f26');
  background.addColorStop(1, '#120609');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e9b9a0';
  ctx.font = '92px "Rubik Wet Paint", "Patrick Hand", cursive';
  ctx.fillText('Hairy Popsicles', W / 2, 130);

  // The character you play as, glowing in its rarity's color (gold if shiny).
  const rarity = RARITIES[CHARACTER_BY_ID[avatar].rarity];
  const glow = shinies[avatar] ? '#ffcf5a' : rarity.color;
  if (hero) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 60;
    fit(ctx, hero, W / 2 - 230, 170, 460);
    ctx.restore();
  }

  ctx.fillStyle = nameColor ?? '#ffe8d6';
  ctx.font = '76px "Patrick Hand", system-ui, sans-serif';
  ctx.fillText(name, W / 2, 712);
  ctx.fillStyle = '#c9b2a4';
  ctx.font = '42px "Patrick Hand", system-ui, sans-serif';
  const owned = CHARACTERS.filter((c) => collection[c.id]).length;
  const shinyCount = Object.keys(shinies).length;
  const line = [`Level ${level}`, title, `${owned}/${CHARACTERS.length} grown`, shinyCount ? `${shinyCount} shiny` : null].filter(Boolean).join('  ·  ');
  ctx.fillText(line, W / 2, 772);

  // Every character: 9 to a row, rarity-colored rings, silhouettes for the unfound.
  const cell = 116;
  const cols = 9;
  order.forEach((c, i) => {
    // Rows are centered, so a short last row sits in the middle.
    const inRow = Math.min(cols, order.length - Math.floor(i / cols) * cols);
    const x = (W - inRow * cell) / 2 + (i % cols) * cell;
    const y = 820 + Math.floor(i / cols) * cell;
    const have = Boolean(collection[c.id]);
    ctx.fillStyle = have ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 6, y + 6, cell - 12, cell - 12, 20);
    else ctx.rect(x + 6, y + 6, cell - 12, cell - 12);
    ctx.fill();
    ctx.strokeStyle = have ? (shinies[c.id] ? '#ffcf5a' : RARITIES[c.rarity].color) : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = have ? 4 : 2;
    ctx.stroke();
    const sprite = sprites[i];
    if (sprite) fit(ctx, have ? sprite : silhouette(sprite, '#2a1418'), x + 14, y + 14, cell - 28);
  });

  ctx.fillStyle = '#e9b9a0';
  ctx.font = '40px "Patrick Hand", system-ui, sans-serif';
  ctx.fillText('Grow your own, free, on your phone:', W / 2, H - 84);
  ctx.fillStyle = '#f3d27a';
  ctx.fillText(GAME_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - 36);
  return canvas;
}

// Share sheet with the picture where the phone supports it; otherwise download it.
export async function shareAlbum(player) {
  const canvas = await drawShareCard(player);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], 'my-hairy-popsicles.png', { type: 'image/png' });
  const text = `I've grown ${CHARACTERS.filter((c) => player.collection[c.id]).length} of ${CHARACTERS.length} in Hairy Popsicles. Come grow some with me.`;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text, url: GAME_URL });
      return 'shared';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return 'downloaded';
}
