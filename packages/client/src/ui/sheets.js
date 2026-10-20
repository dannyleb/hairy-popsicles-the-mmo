import { CHARACTERS, CHARACTER_BY_ID, RARITIES, TITLES, TITLE_BY_ID, titleProgress } from '@hptm/shared';
import { hasHaptics, sfx } from '../audio/sfx.js';
import { settings } from '../settings.js';
import { button, el, iconButton, img, spriteUrl } from './dom.js';
import { HOW_TO_PLAY } from './howto.js';

const SETTINGS = [
  { name: 'sound', label: 'Sound effects' },
  { name: 'music', label: 'Music' },
  { name: 'bubbles', label: 'Speech bubbles' },
  ...(hasHaptics ? [{ name: 'haptics', label: 'Vibration' }] : []),
];

// The share sheet on phones; a copied link elsewhere.
async function shareLink(button) {
  const url = window.location.href.split('#')[0];
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Hairy Popsicles: The MMO', text: 'Come grow gross little characters with me.', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied';
  } catch {
    // Share sheet dismissed, or no clipboard access.
  }
}

// Bottom sheets: the leaderboard, a player's card, and settings.
export function createSheets(actions) {
  const root = el('div', 'sheet-backdrop');
  root.hidden = true;
  const sheet = el('div', 'sheet');
  root.append(sheet);
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });

  let players = {};
  let myId = null;
  let me = null;  // my private data, for the titles list
  let showing = null;  // which sheet is open, so it can refresh as players change
  const muted = new Set();

  function close() {
    root.hidden = true;
    showing = null;
  }

  function open(title, ...content) {
    const header = el('div', 'overlay-header');
    header.append(el('h2', null, title), iconButton('overlay-close', 'close', 'Close', close));
    sheet.replaceChildren(header, ...content);
    root.hidden = false;
  }

  function ranked() {
    return Object.values(players).sort((a, b) => b.album - a.album || b.level - a.level || a.name.localeCompare(b.name));
  }

  function leaderboard() {
    showing = { kind: 'leaderboard' };
    const list = el('ol', 'ranks');
    ranked().forEach((p, i) => {
      const row = button(`rank-row ${p.id === myId ? 'me' : ''}`, null, () => inspect(p.id));
      const best = CHARACTER_BY_ID[p.best];
      const bestImg = img(spriteUrl(p.best), 'rank-best');
      bestImg.style.borderColor = RARITIES[best.rarity].color;
      bestImg.title = best.name;
      const who = el('span', 'rank-name', p.id === myId ? `${p.name} (you)` : p.name);
      if (p.title) who.append(el('small', 'rank-title', p.title));
      row.append(
        el('span', 'rank-place', String(i + 1)),
        img(spriteUrl(p.avatar), 'rank-avatar'),
        who,
        el('span', 'rank-level', `Lv ${p.level}`),
        el('span', 'rank-album', `${p.album}/${CHARACTERS.length}`),
        bestImg,
      );
      const item = el('li');
      item.append(row);
      list.append(item);
    });
    const invite = button('sheet-button', 'Invite someone', () => shareLink(invite));
    const actionsRow = el('div', 'sheet-actions');
    actionsRow.append(invite);
    open(`Who's here · ${Object.keys(players).length}`, el('p', 'overlay-hint', 'Ranked by album size. Tap someone to see them.'), list, actionsRow);
  }

  function inspect(id) {
    const p = players[id];
    if (!p) return close();
    showing = { kind: 'inspect', id };
    const best = CHARACTER_BY_ID[p.best];
    const avatar = CHARACTER_BY_ID[p.avatar];
    const portrait = img(spriteUrl(p.avatar), 'inspect-portrait');
    const facts = el('div', 'inspect-facts');
    facts.append(
      el('p', 'inspect-name', p.name),
      ...(p.title ? [el('p', 'inspect-title', p.title)] : []),
      el('p', null, `Level ${p.level}${p.away ? ' · away' : ''}`),
      el('p', null, `Playing as ${p.shiny ? 'shiny ' : ''}${avatar.name}${p.stars ? ` ${'★'.repeat(p.stars)}` : ''}`),
      el('p', null, `Album ${p.album}/${CHARACTERS.length}${p.shinies ? ` · ${p.shinies} shiny` : ''}`),
    );
    const bestLine = el('p', 'inspect-best');
    bestLine.append('Best: ', Object.assign(el('span', null, `${best.name} (${RARITIES[best.rarity].label})`), { style: `color:${RARITIES[best.rarity].color}` }));
    facts.append(bestLine);
    const top = el('div', 'inspect-top');
    top.append(portrait, facts);

    const actionsRow = el('div', 'sheet-actions');
    if (id !== myId) {
      actionsRow.append(
        button('sheet-button', 'Walk over', () => { close(); actions.goTo(id); }),
        button('sheet-button', 'Wave', () => { close(); actions.emote('wave'); }),
        button('sheet-button quiet', muted.has(id) ? 'Unmute' : 'Mute', () => {
          if (muted.has(id)) muted.delete(id);
          else muted.add(id);
          inspect(id);
        }),
      );
    } else {
      actionsRow.append(button('sheet-button', 'Change character', () => { close(); actions.openAlbum(); }));
    }
    open(id === myId ? 'You' : 'Player', top, actionsRow, ...(id === myId && me ? [titlesList()] : []));
  }

  // Every title: earned ones can be worn (tap), the rest show how close you are.
  function titlesList() {
    const album = Object.keys(me.collection).length;
    const list = el('ul', 'titles');
    for (const title of TITLES) {
      const earned = me.titles.includes(title.id);
      const worn = me.title === title.id;
      const row = button(`title-row${earned ? ' earned' : ''}${worn ? ' worn' : ''}`, null, () => {
        if (!earned) return;
        actions.setTitle(worn ? null : title.id);
      });
      row.disabled = !earned;
      const have = Math.min(title.count, titleProgress(title, me.stats, album, me.streak ?? 0));
      const fill = el('div', 'title-fill');
      fill.style.width = `${(have / title.count) * 100}%`;
      const bar = el('div', 'title-bar');
      bar.append(fill);
      row.append(
        el('span', 'title-name', title.name),
        el('span', 'title-state', worn ? 'showing' : earned ? 'tap to show' : `${have}/${title.count}`),
        el('span', 'title-goal', title.goal),
        bar,
      );
      const item = el('li');
      item.append(row);
      list.append(item);
    }
    const section = el('div', 'titles-section');
    section.append(el('h3', null, 'Titles'), list);
    return section;
  }

  function settingsSheet() {
    showing = { kind: 'settings' };
    const list = el('div', 'settings-list');
    for (const { name, label } of SETTINGS) {
      const row = el('label', 'setting');
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.checked = settings.get(name);
      toggle.addEventListener('change', () => {
        settings.set(name, toggle.checked);
        sfx.click();
      });
      row.append(el('span', null, label), toggle);
      list.append(row);
    }
    const rules = el('details', 'sheet-rules');
    const rulesList = el('ul');
    rulesList.append(...HOW_TO_PLAY.map((line) => el('li', null, line)));
    rules.append(el('summary', null, 'How to play'), rulesList);
    const leave = button('sheet-button quiet', 'Leave the world', () => actions.leave());
    const note = el('p', 'overlay-hint', "Your progress is saved on this device. Your plot comes back with you and keeps growing while you're away.");
    open('Settings', list, rules, note, leave);
  }

  return {
    root,
    leaderboard: () => { sfx.click(); leaderboard(); },
    settings: () => { sfx.click(); settingsSheet(); },
    inspect: (id) => { sfx.click(); inspect(id); },
    inspectMe: () => { if (myId) { sfx.click(); inspect(myId); } },
    isOpen: () => !root.hidden,
    isMuted: (id) => muted.has(id),

    setMe(next) {
      me = next;
      if (showing?.kind === 'inspect' && showing.id === myId) inspect(myId);
    },

    setPlayers(next, me) {
      players = next;
      myId = me;
      // Keep an open leaderboard live (redrawn only when a ranking changes, not
      // on every step someone takes); a player's card closes if they leave.
      const signature = ranked().map((p) => `${p.id}:${p.name}:${p.album}:${p.level}:${p.avatar}:${p.best}`).join('|');
      if (showing?.kind === 'leaderboard' && signature !== showing.signature) {
        leaderboard();
        showing.signature = signature;
      } else if (showing?.kind === 'inspect' && !players[showing.id]) close();
    },
  };
}
