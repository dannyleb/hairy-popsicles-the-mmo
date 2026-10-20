import { CHARACTERS, NAME_MAX, SEED_COST, linesOf } from '@hptm/shared';
import { el } from './dom.js';
import './menu.css';

const NAME_KEY = 'hptm:name';

const PANELS = {
  'How to play': [
    'Tap anywhere to walk around.',
    'Tap empty ground to claim a plot. One each.',
    `Tap a hole in your plot to plant a seed (${SEED_COST} scraps).`,
    'Watch its shadow rise out of the hole. Rarer characters take longer.',
    'When it ripens, tap it to harvest it into your album.',
    "Open the album to play as anyone you've grown.",
    'Nothing saves yet: your album resets when you leave.',
  ],
  Settings: ['Sound: coming soon.', 'Music: coming soon.', 'Notifications: coming soon.'],
  Credits: ['Characters and art: dannyleb.', 'From the world of Hairy Popsicles.', 'Built with Phaser and Colyseus.'],
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
  const hero = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
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
  name.value = savedName();
  const play = el('button', 'menu-play', 'Play');
  play.type = 'submit';
  form.append(name, play);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    saveName(chosen);
    onPlay(chosen || `Guest${Math.floor(Math.random() * 10000)}`);
  });

  const panel = el('div', 'menu-panel');
  panel.hidden = true;
  const row = el('div', 'menu-row');
  for (const [label, body] of Object.entries(PANELS)) {
    const button = el('button', 'menu-link', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const close = el('button', 'menu-panel-close', 'Close');
      close.addEventListener('click', () => { panel.hidden = true; });
      const list = el('ul');
      list.append(...body.map((line) => el('li', null, line)));
      panel.replaceChildren(el('h2', null, label), list, close);
      panel.hidden = false;
    });
    row.append(button);
  }

  root.append(title, stage, form, row, el('p', 'menu-fine', 'v0.2 · placeholder menu'), panel);
  document.body.append(root);

  return {
    hide() { root.hidden = true; },
    show() { root.hidden = false; },
    destroy() { root.remove(); },
  };
}
