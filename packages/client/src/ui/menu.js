import { CHARACTERS, CHARACTER_BY_ID, NAME_MAX, levelFor, linesOf } from '@hptm/shared';
import { forgetProfile, peekProfile } from '../net/profile.js';
import { hasHaptics } from '../audio/sfx.js';
import { remember, remembered, settings } from '../settings.js';
import { HOW_TO_PLAY } from './howto.js';
import { el } from './dom.js';
import './menu.css';

const NAME_KEY = 'hptm:name';
const VERSION = 'v0.5';

const PANELS = {
  'How to play': HOW_TO_PLAY,
  "What's new": [
    'Your progress saves on this device, and your plot keeps growing while you\'re away.',
    'A daily gift for coming back, and a bigger daily quest.',
    'Shiny crops, stars for duplicates, and bonuses for who you play as.',
    'Pus Rain: globs fall from the sky. Nearest gets them.',
    'Titles to earn, characters to give away, and a shop for your scraps.',
  ],
  Credits: ['Characters and art: dannyleb.', 'From the world of Hairy Popsicles.', 'Music from the first game.', 'Built with Phaser and Colyseus.'],
};

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage: the name just isn't remembered.
  }
}

export function createMenu({ onPlay }) {
  // A returning player is greeted by the character they play as.
  const saved = peekProfile();
  const hero = CHARACTER_BY_ID[saved?.avatar] ?? CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  const lines = linesOf(hero.id);

  const root = el('div', 'menu');
  const title = el('div', 'menu-title');
  title.append(el('h1', 'logo', 'Hairy Popsicles'), el('p', 'logo-sub', 'the MMO'));

  const stage = el('div', 'menu-stage');
  const bubble = el('p', 'menu-bubble', lines[Math.floor(Math.random() * lines.length)]);
  const heroBox = el('div', 'menu-hero-box');
  const img = el('img', 'menu-hero');
  img.src = `${import.meta.env.BASE_URL}characters/${hero.id}.webp`;
  img.alt = hero.name;
  heroBox.append(img);
  stage.append(bubble, heroBox, el('p', 'menu-hero-name', hero.name));

  const form = el('form', 'menu-form');
  const name = el('input', 'menu-name');
  name.placeholder = 'Your name';
  name.maxLength = NAME_MAX;
  name.autocomplete = 'off';
  name.value = saved?.name || savedName();
  const play = el('button', 'menu-play', saved ? 'Continue' : 'Play');
  play.type = 'submit';
  if (saved) {
    const albumSize = Object.keys(saved.collection ?? {}).length;
    form.append(el('p', 'menu-continue', `Level ${levelFor(saved.xp ?? 0)} · album ${albumSize}/${CHARACTERS.length}`));
  }
  form.append(name, play);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    saveName(chosen);
    onPlay(chosen);
  });

  const panel = el('div', 'menu-panel');
  panel.hidden = true;
  const row = el('div', 'menu-row');
  const showPanel = (label, ...content) => {
    const close = el('button', 'menu-panel-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => { panel.hidden = true; });
    panel.replaceChildren(el('h2', null, label), ...content, close);
    panel.hidden = false;
  };
  const link = (label, onClick) => {
    const button = el('button', 'menu-link', label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    row.append(button);
    return button;
  };
  const list = (lines) => {
    const ul = el('ul');
    ul.append(...lines.map((line) => el('li', null, line)));
    return ul;
  };
  link('How to play', () => showPanel('How to play', list(PANELS['How to play'])));
  link('Settings', () => {
    const toggles = el('div', 'menu-settings');
    const options = [['sound', 'Sound effects'], ['music', 'Music'], ['bubbles', 'Speech bubbles']];
    if (hasHaptics) options.push(['haptics', 'Vibration']);
    for (const [name, label] of options) {
      const row = el('label', 'menu-setting');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = settings.get(name);
      box.addEventListener('change', () => settings.set(name, box.checked));
      row.append(el('span', null, label), box);
      toggles.append(row);
    }
    showPanel('Settings', toggles);
  });
  // A dot on What's new until this version's list has been read.
  const newsLink = link("What's new", () => {
    remember(`news-${VERSION}`);
    newsLink.classList.remove('unread');
    showPanel("What's new", list(PANELS["What's new"]));
  });
  if (!remembered(`news-${VERSION}`) && saved) newsLink.classList.add('unread');
  link('Credits', () => showPanel('Credits', list(PANELS.Credits)));
  if (saved) {
    link('Start over', () => {
      const confirmButton = el('button', 'menu-panel-close danger', 'Start over for good');
      confirmButton.type = 'button';
      confirmButton.addEventListener('click', () => {
        forgetProfile();
        window.location.reload();
      });
      showPanel('Start over?', el('p', null, 'Your level, album, scraps and plot on this device are gone for good.'), confirmButton);
    });
  }

  root.append(title, stage, form, row, el('p', 'menu-fine', `${VERSION} · progress saves on this device`), panel);
  document.body.append(root);

  return {
    hide() { root.hidden = true; },
    show() { root.hidden = false; },
    destroy() { root.remove(); },
  };
}
