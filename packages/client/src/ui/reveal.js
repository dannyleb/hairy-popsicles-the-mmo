import { CHARACTER_BY_ID, RARITIES, linesOf } from '@hptm/shared';
import { button, el, img, bigSpriteUrl } from './dom.js';

const LEVEL_UP_MS = 3800;
const TAP_GUARD_MS = 700;  // ignore taps right after it opens, which were meant for the world

// Full-screen moments: a new character joining your album, and leveling up. Queued, one at a time.
export function createReveal({ onWear }) {
  const root = el('div', 'reveal');
  root.hidden = true;
  const queue = [];
  let openedAt = 0;
  let timer = 0;
  let waitingLevelUp = null;  // level-up splashes in line and on screen, which absorb any that follow
  let showingLevelUp = null;

  function next() {
    clearTimeout(timer);
    showingLevelUp = null;
    const show = queue.shift();
    if (!show) {
      root.hidden = true;
      return;
    }
    root.className = 'reveal';
    root.replaceChildren();
    show();
    root.hidden = false;
    openedAt = performance.now();
  }

  function enqueue(show) {
    queue.push(show);
    if (root.hidden) next();
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (performance.now() - openedAt > TAP_GUARD_MS) next();
  });

  return {
    root,
    isOpen: () => !root.hidden,

    character(characterId, { isNew }) {
      enqueue(() => {
        const character = CHARACTER_BY_ID[characterId];
        const rarity = RARITIES[character.rarity];
        const lines = linesOf(characterId);
        root.classList.add(character.rarity);
        root.style.setProperty('--rarity', rarity.color);
        const card = el('div', 'reveal-card');
        if (isNew) card.append(el('div', 'reveal-stamp', 'New!'));
        const art = el('div', 'reveal-art');
        art.append(el('div', 'reveal-rays'), img(bigSpriteUrl(characterId), 'reveal-image'));
        const actions = el('div', 'reveal-actions');
        actions.append(
          button('reveal-button primary', 'Play as them', () => {
            onWear(characterId);
            next();
          }),
          button('reveal-button', 'Nice', () => next()),
        );
        card.append(
          art,
          el('p', 'reveal-rarity', rarity.label),
          el('h2', 'reveal-name', character.name),
          el('p', 'reveal-line', `"${lines[Math.floor(Math.random() * lines.length)]}"`),
          actions,
        );
        root.append(card);
      });
    },

    levelUp(level, unlocks) {
      // A burst of XP can level you up several times at once: fold those into
      // the splash on screen (or waiting in line) instead of queueing more.
      const current = waitingLevelUp ?? showingLevelUp;
      if (current) {
        current.level = level;
        current.unlocks.push(...unlocks);
        current.render?.();
        return;
      }
      const entry = { level, unlocks: [...unlocks], render: null };
      waitingLevelUp = entry;
      enqueue(() => {
        waitingLevelUp = null;
        showingLevelUp = entry;
        root.classList.add('level');
        const number = el('h2', 'reveal-level');
        const list = el('ul', 'reveal-unlocks');
        const card = el('div', 'reveal-card');
        card.append(el('p', 'reveal-rarity', 'Level up'), number, list, button('reveal-button primary', 'Keep growing', () => next()));
        root.append(card);
        entry.render = () => {
          number.textContent = String(entry.level);
          list.replaceChildren(...entry.unlocks.map((u) => el('li', null, u)));
          list.hidden = !entry.unlocks.length;
          clearTimeout(timer);
          timer = setTimeout(next, LEVEL_UP_MS + entry.unlocks.length * 800);
        };
        entry.render();
      });
    },
  };
}
