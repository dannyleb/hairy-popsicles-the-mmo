import { ALBUM_ROWS, CHARACTERS, CHARACTER_BY_ID, RARITIES, RARITY_ORDER, STAR_COPIES, describeBonus, linesOf, starsFor, wearBonus } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { bigSpriteUrl, button, el, iconButton, img, spriteUrl } from './dom.js';

// Every character in the game, grouped by rarity: silhouettes until you've grown them.
// Tap one you've grown for a closer look, and to play as them.
export function createAlbum({ onWear, onOpen }) {
  const root = el('div', 'overlay album');
  root.hidden = true;
  let data = { collection: {}, shinies: {}, wearing: null };
  let featured = null;

  const detail = el('div', 'reveal album-detail');
  detail.hidden = true;
  detail.addEventListener('click', (event) => {
    if (!event.target.closest('.reveal-card')) detail.hidden = true;
  });

  function nextStar(n) {
    const goal = STAR_COPIES.find((copies) => copies > n);
    if (!goal) return 'Every star earned.';
    const stars = STAR_COPIES.indexOf(goal) + 1;
    return `${goal - n} more for ${'★'.repeat(stars)}`;
  }

  function showDetail(id) {
    const character = CHARACTER_BY_ID[id];
    const rarity = RARITIES[character.rarity];
    const n = data.collection[id] ?? 0;
    const shiny = data.shinies[id] ?? 0;
    const earned = starsFor(n);
    const lines = linesOf(id);
    const wearing = data.wearing === id;
    const card = el('div', 'reveal-card');
    card.style.setProperty('--rarity', shiny ? '#ffcf5a' : rarity.color);
    const art = el('div', `reveal-art${shiny ? ' shiny' : ''}`);
    art.append(img(bigSpriteUrl(id), 'reveal-image'));
    const label = el('p', 'reveal-rarity', `${shiny ? 'Shiny ' : ''}${rarity.label}`);
    label.style.color = rarity.color;
    const bonus = describeBonus(wearBonus(id, n));
    const wear = button('reveal-button primary', wearing ? 'Playing as them' : 'Play as them', () => {
      sfx.click();
      onWear(id);
      detail.hidden = true;
      root.hidden = true;
    });
    wear.disabled = wearing;
    const actions = el('div', 'reveal-actions');
    actions.append(wear, button('reveal-button', 'Back', () => { detail.hidden = true; }));
    card.append(
      art,
      label,
      el('h2', 'reveal-name', character.name),
      el('p', 'reveal-line', `"${lines[Math.floor(Math.random() * lines.length)]}"`),
      el('p', 'detail-stars', '★'.repeat(earned) + '☆'.repeat(STAR_COPIES.length - earned)),
      el('p', 'detail-facts', [`Grown ${n}×`, shiny ? `✦ ${shiny} shiny` : null, nextStar(n)].filter(Boolean).join(' · ')),
      el('p', 'reveal-bonus', bonus ? `Play as them: ${bonus}` : 'No bonus yet. Each star adds +5% scraps.'),
      ...(featured === id ? [el('p', 'detail-featured', 'Sprouting more often today.')] : []),
      actions,
    );
    detail.replaceChildren(card);
    detail.hidden = false;
  }

  const title = el('h2');
  const header = el('div', 'overlay-header');
  header.append(title, iconButton('overlay-close', 'close', 'Close album', () => { root.hidden = true; }));
  const today = el('p', 'album-today-line');
  today.hidden = true;
  root.append(detail, header, el('p', 'overlay-hint', `Tap anyone you've grown for a closer look and to play as them. Rarer characters boost your farming while you play as them, and stars (for growing ${STAR_COPIES.join(', ')} of someone) add more. A shiny one plays with a gold sheen.`), today);

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
        showDetail(character.id);
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
      detail.hidden = true;
      root.hidden = false;
      root.scrollTop = 0;
      onOpen();
    },
    isOpen: () => !root.hidden,

    // The day's featured character: a badge on its card, and a line up top.
    setFeatured(id, owned) {
      featured = id;
      for (const entry of cards.values()) entry.badge.hidden = entry.character.id !== id;
      const character = cards.get(id)?.character;
      today.hidden = !character;
      if (!character) return;
      const who = owned ? character.name : `a mystery ${RARITIES[character.rarity].label}`;
      today.textContent = `Sprouting more often today: ${who}.`;
    },

    update(collection, shinies, wearing, rows = []) {
      data = { collection, shinies, wearing };
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
