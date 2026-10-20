import { CHARACTERS, RARITIES, RARITY_ORDER } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { button, el, iconButton, img, spriteUrl } from './dom.js';

// Every character in the game, grouped by rarity: silhouettes until you've grown them.
export function createAlbum({ onWear, onOpen }) {
  const root = el('div', 'overlay album');
  root.hidden = true;
  const title = el('h2');
  const header = el('div', 'overlay-header');
  header.append(title, iconButton('overlay-close', 'close', 'Close album', () => { root.hidden = true; }));
  root.append(header, el('p', 'overlay-hint', "Tap anyone you've grown to play as them."));

  const cards = new Map();
  const sections = new Map();
  for (const rarity of RARITY_ORDER) {
    const heading = el('h3', 'album-section');
    heading.style.color = RARITIES[rarity].color;
    const grid = el('div', 'album-grid');
    root.append(heading, grid);
    sections.set(rarity, heading);
    for (const character of CHARACTERS.filter((c) => c.rarity === rarity)) {
      const card = button('album-card', null, () => {
        sfx.click();
        onWear(character.id);
        root.hidden = true;
      });
      card.disabled = true;
      const name = el('span', 'album-name');
      const count = el('span', 'album-count');
      card.append(img(spriteUrl(character.id)), name, count);
      card.style.setProperty('--rarity', RARITIES[rarity].color);
      grid.append(card);
      cards.set(character.id, { card, name, count, character });
    }
  }

  return {
    root,
    open() {
      sfx.click();
      root.hidden = false;
      root.scrollTop = 0;
      onOpen();
    },
    isOpen: () => !root.hidden,

    update(collection, wearing) {
      const owned = Object.keys(collection).length;
      title.textContent = `Album ${owned}/${CHARACTERS.length}`;
      for (const rarity of RARITY_ORDER) {
        const all = CHARACTERS.filter((c) => c.rarity === rarity);
        const have = all.filter((c) => collection[c.id]).length;
        sections.get(rarity).textContent = `${RARITIES[rarity].label} · ${have}/${all.length}`;
      }
      for (const { card, name, count, character } of cards.values()) {
        const n = collection[character.id] ?? 0;
        card.disabled = n === 0;
        card.classList.toggle('owned', n > 0);
        card.classList.toggle('wearing', wearing === character.id);
        name.textContent = n ? character.name : '???';
        count.textContent = n ? (wearing === character.id ? 'wearing' : `×${n}`) : '';
      }
    },
  };
}
