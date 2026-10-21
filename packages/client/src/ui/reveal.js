import { CHARACTERS, CHARACTER_BY_ID, DAILY_REWARDS, RARITIES, dailyReward, linesOf } from '@hptm/shared';
import { button, el, img, bigSpriteUrl, spriteUrl, worldUrl } from './dom.js';

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
    delete root.dataset.onClose;
    root.replaceChildren();
    show();
    root.hidden = false;
    openedAt = performance.now();
  }

  function enqueue(show) {
    queue.push(show);
    if (root.hidden) next();
  }

  let introClose = null;  // closing the intro any way at all starts the tutorial
  root.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (performance.now() - openedAt <= TAP_GUARD_MS) return;
    if (root.dataset.onClose === 'intro') introClose?.();
    next();
  });

  return {
    root,
    isOpen: () => !root.hidden,

    // `found`: where it turned up (as in "Under The Scab"), if not grown.
    character(characterId, { isNew, shiny, bonus, giftFrom, caught, found }) {
      enqueue(() => {
        const character = CHARACTER_BY_ID[characterId];
        const rarity = RARITIES[character.rarity];
        const lines = linesOf(characterId);
        root.classList.add(character.rarity);
        root.classList.toggle('shiny', Boolean(shiny));
        root.style.setProperty('--rarity', shiny ? '#ffcf5a' : rarity.color);
        const card = el('div', 'reveal-card');
        if (giftFrom || caught || found || shiny || isNew) {
          card.append(el('div', 'reveal-stamp', giftFrom ? 'Gift!' : caught ? 'Caught!' : found ? 'Found!' : shiny ? 'Shiny!' : 'New!'));
        }
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
          el('p', 'reveal-rarity', giftFrom
            ? `From ${giftFrom}${isNew ? ' · new' : ''}`
            : caught ? `Today's stray, ${rarity.label}${isNew ? ' · new' : ''}`
            : found ? `${found}, ${rarity.label}${isNew ? ' · new' : ''}`
            : shiny ? `Shiny ${rarity.label}${isNew ? ' · new' : ''}` : rarity.label),
          el('h2', 'reveal-name', character.name),
          el('p', 'reveal-line', `"${lines[Math.floor(Math.random() * lines.length)]}"`),
          ...(bonus ? [el('p', 'reveal-bonus', `Play as them: ${bonus}`)] : []),
          actions,
        );
        root.append(card);
      });
    },

    welcome({ awayMs, ripe, growing, squeezed, avatar }) {
      enqueue(() => {
        root.classList.add('welcome');
        const card = el('div', 'reveal-card');
        const art = el('div', 'reveal-art small');
        if (avatar) art.append(img(bigSpriteUrl(avatar), 'reveal-image'));
        const lines = [`You were away ${formatAway(awayMs)}.`];
        if (ripe) lines.push(`${ripe === 1 ? 'A crop is' : `${ripe} crops are`} ripe and waiting.`);
        if (growing) lines.push(`${growing} still growing.`);
        if (squeezed) lines.push(`Neighbors squeezed your crops ${squeezed === 1 ? 'once' : `${squeezed} times`} while you were gone.`);
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

    title({ name, goal }, onShow) {
      enqueue(() => {
        root.classList.add('daily');
        const card = el('div', 'reveal-card');
        const actions = el('div', 'reveal-actions');
        actions.append(
          button('reveal-button primary', 'Show it off', () => {
            onShow();
            next();
          }),
          button('reveal-button', 'Nice', () => next()),
        );
        card.append(
          el('p', 'reveal-rarity', 'New title'),
          el('h2', 'reveal-name', name),
          el('p', 'reveal-line', `${goal}. Everyone sees it under your name.`),
          actions,
        );
        root.append(card);
      });
    },

    // The very first thing a new player sees: what the game is, and who they are.
    intro(avatar, onGo) {
      let went = false;
      const go = () => {
        if (went) return;
        went = true;
        onGo();
      };
      enqueue(() => {
        root.classList.add('welcome');
        root.dataset.onClose = 'intro';
        const character = CHARACTER_BY_ID[avatar];
        const card = el('div', 'reveal-card intro');
        const art = el('div', 'reveal-art small');
        if (character) art.append(img(bigSpriteUrl(avatar), 'reveal-image'));
        const steps = el('ol', 'intro-steps');
        steps.append(
          el('li', null, 'Grow characters in a plot of your own.'),
          el('li', null, 'Collect them all in your album.'),
          el('li', null, 'Play as any of them, with everyone here.'),
        );
        card.append(
          art,
          el('p', 'reveal-rarity', 'Welcome to the skin'),
          el('h2', 'reveal-name', character ? `You're ${character.name}` : 'Welcome'),
          steps,
          button('reveal-button primary', 'Show me', () => {
            next();
            go();
          }),
        );
        root.append(card);
      });
      introClose = go;
    },

    // Every character of a rarity grown: the whole row lined up, and its reward.
    albumRow({ rarity, scraps, xp, boil }) {
      enqueue(() => {
        root.classList.add('daily');
        const { label, color } = RARITIES[rarity];
        const row = el('div', 'reveal-row');
        for (const c of CHARACTERS.filter((ch) => ch.rarity === rarity)) row.append(img(spriteUrl(c.id)));
        const card = el('div', 'reveal-card');
        card.style.setProperty('--rarity', color);
        const heading = el('h2', 'reveal-name', `Every ${label}`);
        heading.style.color = color;
        card.append(
          el('p', 'reveal-rarity', 'Album row complete'),
          heading,
          row,
          el('p', 'reveal-line', `${[...rewardParts({ scraps, boil }), `+${xp} xp`].join(' · ')}`),
          button('reveal-button primary', 'Sweet', () => next()),
        );
        root.append(card);
      });
    },

    // The 7-day track, today's reward highlighted.
    daily({ streak, featured, featuredOwned }) {
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
        );
        // Today's featured character: a silhouette until you've grown it.
        const pick = CHARACTER_BY_ID[featured];
        if (pick) {
          const spot = el('div', `daily-featured${featuredOwned ? '' : ' mystery'}`);
          const label = featuredOwned ? pick.name : `a mystery ${RARITIES[pick.rarity].label}`;
          spot.append(img(spriteUrl(pick.id)), el('span', null, `Sprouting more often today: ${label}`));
          spot.style.setProperty('--rarity', RARITIES[pick.rarity].color);
          card.append(spot);
        }
        card.append(button('reveal-button primary', 'Collect', () => next()));
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
