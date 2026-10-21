import { CHARACTERS, CHARACTER_BY_ID, INVITE, NAME_MAX, RARITIES, featuredFor, levelFor, linesOf, seasonOn } from '@hptm/shared';
import { inviter, pendingInvite } from '../net/invite.js';
import { forgetProfile, peekProfile, readSaveCode, storeProfile } from '../net/profile.js';
import { worldStatus } from '../net/status.js';
import { hasHaptics } from '../audio/sfx.js';
import { remember, remembered, settings } from '../settings.js';
import { HOW_TO_PLAY } from './howto.js';
import { el } from './dom.js';
import './menu.css';

const NAME_KEY = 'hptm:name';
const VERSION = 'v0.10';

const PANELS = {
  'How to play': HOW_TO_PLAY,
  "What's new": [
    'New world events, taking turns with The Boil: The Scab (hold to peel; the last piece hides a character), The Gash (pick the crust out) and The Tick (pry it off before it drains your crops).',
    'A map with every place named: tap the little map, top right. On phones, quests fold away to one line (tap to open).',
    "Strays wander the world. The day's featured one glows gold: walk up and tap it to catch it, once a day. Catch 7 for the Dogcatcher title.",
    'The skin is alive: mites (squish them), fleas, a giant worm now and then, footprints, swaying hairs, and players napping by their plots while they\'re away.',
    'Regions: the Scalp, the Armpit, Freckle Flats and Wart Hills around the Navel. Find the giant Eye, and the statue of whoever has collected the most characters.',
    'Day and night, dandruff, sweaty fog and an itchy wind, and the sounds of wherever you are (a heartbeat by the Navel).',
    'Invite a friend (trophy, top right): they start right next to you, and when they reach level 3 you both get a Boil Seed. Bring 3 for the Ringleader title.',
    'The Rotting Season, until Nov 1: harvests drop teeth for a Pumpkin name color and the Trick or Treater title.',
    'The Itch: now and then the whole world shares one goal. Everyone who helps gets a Boil Seed.',
    "Players' plots stay in the world while they're away. Squeeze them, and they'll hear about it.",
    'Pals: tap anyone, then Make pal. You\'ll hear when they turn up.',
    'A featured character every day, and a big reward for finishing a row of your album.',
    'Tap anyone in your album for a close-up, or tap your card to share a picture of your album.',
    'Pinch to zoom. Reduce motion in Settings. Move your save to another phone from Settings.',
    'Earlier: saves, daily gifts and quests, shinies and stars, Pus Rain, titles, gifts and the shop.',
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

const DAY_MS = 86_400_000;
const utcDay = (time) => new Date(time).toISOString().slice(0, 10);

// What's waiting today, from the save on this device (unverified, so only a
// hint): the daily gift, ripe crops, the featured character and any season.
function todayLines(saved) {
  const now = Date.now();
  const today = utcDay(now);
  const lines = [];
  if (saved) {
    const { last, streak = 0 } = saved.daily ?? {};
    if (last !== today) {
      const day = last === utcDay(now - DAY_MS) ? streak + 1 : 1;
      lines.push({ text: day > 1 ? `Day ${day} gift waiting` : 'Daily gift waiting', hot: true });
    }
    const slots = Array.isArray(saved.plot?.slots) ? saved.plot.slots : [];
    const ripe = slots.filter((s) => s && s.readyAt <= now).length;
    if (ripe) lines.push({ text: `${ripe} crop${ripe > 1 ? 's' : ''} ripe on your plot`, hot: true });
  }
  const featured = CHARACTER_BY_ID[featuredFor(today)];
  if (featured) {
    const known = saved?.collection?.[featured.id];
    lines.push({ text: `Sprouting today: ${known ? featured.name : `a mystery ${RARITIES[featured.rarity].label}`}` });
  }
  const season = seasonOn(today);
  if (season) {
    const days = Math.ceil((Date.parse(`${season.ends}T00:00:00Z`) - now) / DAY_MS);
    lines.push({ text: `${season.name.replace(/^The /, '')} · ${days > 1 ? `${days} days left` : 'last day'}`, season: season.id });
  }
  return lines;
}

// How many are playing right now, once the server answers. It may be waking
// up from a nap, which is worth knowing before tapping Play.
function liveLine() {
  const line = el('p', 'menu-live');
  line.hidden = true;
  const waking = setTimeout(() => {
    line.textContent = 'Waking the world up…';
    line.hidden = false;
  }, 2500);
  worldStatus.then((status) => {
    clearTimeout(waking);
    const online = status?.online ?? 0;
    line.textContent = `${online} playing now`;
    line.classList.add('on');
    line.hidden = online === 0;
  });
  return line;
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
  const hero = (Object.hasOwn(CHARACTER_BY_ID, saved?.avatar) && CHARACTER_BY_ID[saved.avatar]) || CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  const lines = linesOf(hero.id);

  const root = el('div', 'menu');
  const title = el('div', 'menu-title');
  title.append(el('h1', 'logo', 'Hairy Popsicles'), el('p', 'logo-sub', 'the MMO'));
  // First visit: what this is, in one line.
  if (!saved) title.append(el('p', 'menu-pitch', 'Grow gross little characters. Collect them all. Play as any of them, together.'));

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
    form.append(el('p', 'menu-continue', `Level ${levelFor(Number(saved.xp) || 0)} · album ${albumSize}/${CHARACTERS.length}`));
  }
  const today = el('ul', 'menu-today');
  // The save is unverified: an odd one costs the hints, never the menu.
  let hints = [];
  try {
    hints = todayLines(saved);
  } catch {
    hints = [];
  }
  for (const line of hints) {
    today.append(el('li', `${line.hot ? 'hot' : ''}${line.season ? ` season ${line.season}` : ''}`.trim() || null, line.text));
  }
  if (today.children.length) form.append(today);
  // Arrived by a friend's link: say whose, and what playing together is worth.
  const invite = !saved && pendingInvite();
  if (invite) {
    const reward = `Reach level ${INVITE.level} and you both get a Boil Seed.`;
    const line = el('p', 'menu-invite', `A friend invited you. ${reward}`);
    form.append(line);
    inviter(invite).then((info) => {
      if (!info?.name) return;
      line.textContent = info.here ? `${info.name} invited you, and is playing now. Tap Play to start right next to them.` : `${info.name} invited you. ${reward}`;
    });
  }
  form.append(name, play, liveLine());
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
    options.push(['calm', 'Reduce motion']);
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
  link('Load a save', () => {
    const code = el('textarea', 'save-code');
    code.rows = 4;
    code.placeholder = 'Paste the code from Settings → Move to another phone';
    const problem = el('p', 'menu-problem');
    const load = el('button', 'menu-panel-close', 'Load it');
    load.type = 'button';
    load.addEventListener('click', () => {
      const token = code.value.replace(/\s+/g, '');
      // Only the server can check the signature; this just catches a bad paste.
      if (!readSaveCode(token)) {
        problem.textContent = "That doesn't look like a save code.";
        return;
      }
      storeProfile(token);
      window.location.reload();
    });
    const warning = [el('p', null, `Only paste a code you copied from your own game.${saved ? ' It replaces the save on this phone.' : ''}`)];
    showPanel('Load a save', ...warning, code, problem, load);
  });
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
