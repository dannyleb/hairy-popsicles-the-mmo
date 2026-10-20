import { CHARACTER_BY_ID, DAILY_REWARDS, RARITIES, dailyReward, linesOf } from '@hptm/shared';
import { button, el, img, bigSpriteUrl, worldUrl } from './dom.js';

const LEVEL_UP_MS = 3800;
const TAP_GUARD_MS = 700;  // ignore taps right after it opens, which were meant for the world

function formatAway(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'a minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'a day' : `${days} days`;
}

function rewardParts(reward) {
  const parts = [];
  if (reward.scraps) parts.push(`+${reward.scraps} scraps`);
  if (reward.boil) parts.push(`+${reward.boil} Boil Seed${reward.boil > 1 ? 's' : ''}`);
  return parts;
}

// Full-screen moments: a new character joining your album, leveling up,
// coming back, the day's login reward. Queued, one at a time.
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

    character(characterId, { isNew, shiny }) {
      enqueue(() => {
        const character = CHARACTER_BY_ID[characterId];
        const rarity = RARITIES[character.rarity];
        const lines = linesOf(characterId);
        root.classList.add(character.rarity);
        root.classList.toggle('shiny', Boolean(shiny));
        root.style.setProperty('--rarity', shiny ? '#ffcf5a' : rarity.color);
        const card = el('div', 'reveal-card');
        if (shiny || isNew) card.append(el('div', 'reveal-stamp', shiny ? 'Shiny!' : 'New!'));
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
          el('p', 'reveal-rarity', shiny ? `Shiny ${rarity.label}${isNew ? ' · new' : ''}` : rarity.label),
          el('h2', 'reveal-name', character.name),
          el('p', 'reveal-line', `"${lines[Math.floor(Math.random() * lines.length)]}"`),
          actions,
        );
        root.append(card);
      });
    },

    welcome({ awayMs, ripe, growing, avatar }) {
      enqueue(() => {
        root.classList.add('welcome');
        const card = el('div', 'reveal-card');
        const art = el('div', 'reveal-art small');
        if (avatar) art.append(img(bigSpriteUrl(avatar), 'reveal-image'));
        const lines = [`You were away ${formatAway(awayMs)}.`];
        if (ripe) lines.push(`${ripe === 1 ? 'A crop is' : `${ripe} crops are`} ripe and waiting.`);
        if (growing) lines.push(`${growing} still growing.`);
        card.append(
          art,
          el('p', 'reveal-rarity', 'Your plot kept growing'),
          el('h2', 'reveal-name', 'Welcome back'),
          el('p', 'reveal-line', lines.join(' ')),
          button('reveal-button primary', ripe ? 'Go pick them' : "Let's go", () => next()),
        );
        root.append(card);
      });
    },

    // The 7-day track, today's reward highlighted.
    daily({ streak }) {
      enqueue(() => {
        root.classList.add('daily');
        const reward = dailyReward(streak);
        const today = (streak - 1) % DAILY_REWARDS.length;
        const track = el('ol', 'daily-track');
        DAILY_REWARDS.forEach((r, i) => {
          const day = el('li', `daily-day${i < today ? ' done' : ''}${i === today ? ' today' : ''}`);
          day.append(el('span', 'daily-label', `Day ${i + 1}`));
          const prize = el('span', 'daily-prize');
          if (r.boil) prize.append(img(worldUrl('seed-boil'), 'daily-icon'), el('span', null, `×${r.boil}`));
          else prize.append(img(worldUrl('drop-pus'), 'daily-icon'), el('span', null, String(r.scraps)));
          day.append(prize);
          track.append(day);
        });
        const card = el('div', 'reveal-card');
        card.append(
          el('p', 'reveal-rarity', streak > 1 ? `${streak}-day streak` : 'Daily gift'),
          el('h2', 'reveal-name', streak > 1 ? `Day ${streak}` : 'Welcome in'),
          track,
          el('p', 'reveal-line', `${rewardParts(reward).join(' · ')}. Come back tomorrow for day ${streak + 1}.`),
          button('reveal-button primary', 'Collect', () => next()),
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
