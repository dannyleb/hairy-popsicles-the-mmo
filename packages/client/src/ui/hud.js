import { CHARACTERS, CHARACTER_BY_ID, RARITIES, SEED_COST } from '@hptm/shared';
import { el } from './dom.js';
import './hud.css';

const TOAST_MS = 2600;
const MAX_TOASTS = 3;

const spriteUrl = (id) => `${import.meta.env.BASE_URL}characters/small/${id}.webp`;

export function createHud({ onWear }) {
  const status = el('div', 'hud-status');
  const help = el('p', 'hud-help', `Tap to walk. Tap empty ground to claim a plot, then tap its holes to plant seeds (${SEED_COST} scraps).`);
  const albumButton = el('button', 'hud-album-button');
  const album = el('div', 'album');
  album.hidden = true;
  const header = el('div', 'album-header');
  const title = el('h2');
  const close = el('button', 'album-close', '✕');
  close.setAttribute('aria-label', 'Close album');
  header.append(title, close);
  const grid = el('div', 'album-grid');
  album.append(header, el('p', 'album-hint', 'Tap a character you have grown to play as it.'), grid);
  const toasts = el('div', 'toasts');
  document.body.append(status, help, albumButton, album, toasts);

  albumButton.addEventListener('click', () => { album.hidden = false; });
  close.addEventListener('click', () => { album.hidden = true; });

  const cards = new Map();
  for (const character of CHARACTERS) {
    const card = el('button', 'album-card');
    card.disabled = true;
    const img = el('img');
    img.src = spriteUrl(character.id);
    img.alt = '';
    img.loading = 'lazy';
    const name = el('span', 'album-name');
    const meta = el('span', 'album-meta');
    meta.style.color = RARITIES[character.rarity].color;
    card.append(img, name, meta);
    card.addEventListener('click', () => {
      onWear(character.id);
      album.hidden = true;
    });
    grid.append(card);
    cards.set(character.id, { card, name, meta });
  }

  return {
    update(player, ownsPlot) {
      status.textContent = `${player.name} · ${player.currency} scraps`;
      help.hidden = ownsPlot;
      const label = `Album ${Object.keys(player.collection).length}/${CHARACTERS.length}`;
      albumButton.textContent = label;
      title.textContent = label;
      for (const [id, { card, name, meta }] of cards) {
        const count = player.collection[id] ?? 0;
        const character = CHARACTER_BY_ID[id];
        const rarity = RARITIES[character.rarity].label;
        card.disabled = count === 0;
        card.classList.toggle('owned', count > 0);
        card.classList.toggle('wearing', player.avatar === id);
        name.textContent = count ? character.name : '???';
        meta.textContent = count ? `${rarity} · ×${count}` : rarity;
      }
    },

    toast(text, { characterId, color } = {}) {
      const toast = el('div', 'toast');
      if (characterId) {
        const img = el('img');
        img.src = spriteUrl(characterId);
        img.alt = '';
        toast.append(img);
      }
      const message = el('span', null, text);
      if (color) message.style.color = color;
      toast.append(message);
      toasts.append(toast);
      while (toasts.children.length > MAX_TOASTS) toasts.firstElementChild.remove();
      setTimeout(() => toast.remove(), TOAST_MS);
    },
  };
}
