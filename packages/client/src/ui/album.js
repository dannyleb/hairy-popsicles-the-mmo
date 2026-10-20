import { ALBUM_ROWS, CHARACTERS, RARITIES, RARITY_ORDER, STAR_COPIES, describeBonus, starsFor, wearBonus } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { button, el, iconButton, img, spriteUrl } from './dom.js';

// Every character in the game, grouped by rarity: silhouettes until you've grown them.
export function createAlbum({ onWear, onOpen }) {
  const root = el('div', 'overlay album');
  root.hidden = true;
  const title = el('h2');
  const header = el('div', 'overlay-header');
  header.append(title, iconButton('overlay-close', 'close', 'Close album', () => { root.hidden = true; }));
  const today = el('p', 'album-today-line');
  today.hidden = true;
  root.append(header, el('p', 'overlay-hint', `Tap anyone you've grown to play as them. Rarer characters boost your farming while you play as them, and stars (for growing ${STAR_COPIES.join(', ')} of someone) add more. A shiny one plays with a gold sheen.`), today);

  const cards = new Map();
  const sections = new Map();
  for (const rarity of RARITY_ORDER) {
    const heading = el('h3', 'album-section');
    heading.style.color = RARITIES[rarity].color;
    const label = el('span');
    const reward = el('span', 'album-row-reward');
    heading.append(label, reward);
    const grid = el('div', 'album-grid');
    root.append(heading, grid);
    sections.set(rarity, { label, reward });
    for (const character of CHARACTERS.filter((c) => c.rarity === rarity)) {
      const card = button('album-card', null, () => {
        sfx.click();
        onWear(character.id);
        root.hidden = true;
      });
      card.disabled = true;
      const name = el('span', 'album-name');
      const count = el('span', 'album-count');
      const stars = el('span', 'album-stars');
      const bonus = el('span', 'album-bonus');
      const badge = el('span', 'album-today', 'Sprouting today');
      badge.hidden = true;
      card.append(badge, img(spriteUrl(character.id)), name, stars, bonus, count);
      card.style.setProperty('--rarity', RARITIES[rarity].color);
      grid.append(card);
      cards.set(character.id, { card, name, count, stars, bonus, badge, character });
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

    // The day's featured character: a badge on its card, and a line up top.
    setFeatured(id, owned) {
      for (const entry of cards.values()) entry.badge.hidden = entry.character.id !== id;
      const character = cards.get(id)?.character;
      today.hidden = !character;
      if (!character) return;
      const who = owned ? character.name : `a mystery ${RARITIES[character.rarity].label}`;
      today.textContent = `Sprouting more often today: ${who}.`;
    },

    update(collection, shinies, wearing, rows = []) {
      const owned = Object.keys(collection).length;
      const shinyCount = Object.keys(shinies).length;
      title.textContent = `Album ${owned}/${CHARACTERS.length}${shinyCount ? ` · ✦${shinyCount}` : ''}`;
      for (const rarity of RARITY_ORDER) {
        const all = CHARACTERS.filter((c) => c.rarity === rarity);
        const have = all.filter((c) => collection[c.id]).length;
        const { label, reward } = sections.get(rarity);
        label.textContent = `${RARITIES[rarity].label} · ${have}/${all.length}`;
        const { scraps, boil } = ALBUM_ROWS[rarity];
        reward.textContent = rows.includes(rarity)
          ? 'Row complete ✓'
          : `Complete the row: +${scraps} scraps${boil ? ` · +${boil} Boil Seed${boil > 1 ? 's' : ''}` : ''}`;
        reward.classList.toggle('done', rows.includes(rarity));
      }
      for (const { card, name, count, stars, bonus, character } of cards.values()) {
        const n = collection[character.id] ?? 0;
        const earned = starsFor(n);
        card.disabled = n === 0;
        card.classList.toggle('owned', n > 0);
        card.classList.toggle('shiny', Boolean(shinies[character.id]));
        stars.textContent = n ? '★'.repeat(earned) + '☆'.repeat(STAR_COPIES.length - earned) : '';
        bonus.textContent = n ? describeBonus(wearBonus(character.id, n)) : '';
        card.classList.toggle('wearing', wearing === character.id);
        name.textContent = n ? character.name : '???';
        count.textContent = n ? (wearing === character.id ? 'wearing' : `×${n}`) : '';
      }
    },
  };
}
