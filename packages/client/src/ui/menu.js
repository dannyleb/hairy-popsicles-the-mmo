import { CHARACTERS, NAME_MAX, linesOf } from '@hptm/shared';
import { settings } from '../settings.js';
import { HOW_TO_PLAY } from './howto.js';
import { el } from './dom.js';
import './menu.css';

const NAME_KEY = 'hptm:name';

const PANELS = {
  'How to play': HOW_TO_PLAY,
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
  };
  const list = (lines) => {
    const ul = el('ul');
    ul.append(...lines.map((line) => el('li', null, line)));
    return ul;
  };
  link('How to play', () => showPanel('How to play', list(PANELS['How to play'])));
  link('Settings', () => {
    const toggles = el('div', 'menu-settings');
    for (const [name, label] of [['sound', 'Sound effects'], ['music', 'Music'], ['bubbles', 'Speech bubbles']]) {
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
  link('Credits', () => showPanel('Credits', list(PANELS.Credits)));

  root.append(title, stage, form, row, el('p', 'menu-fine', 'v0.3 · nothing saves yet'), panel);
  document.body.append(root);

  return {
    hide() { root.hidden = true; },
    show() { root.hidden = false; },
    destroy() { root.remove(); },
  };
}
