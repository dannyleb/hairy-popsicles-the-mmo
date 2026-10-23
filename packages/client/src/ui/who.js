import { CHARACTER_BY_ID } from '@hptm/shared';
import { fetchWho } from '../net/status.js';
import { el, img, spriteUrl } from './dom.js';
import { isPal } from './pals.js';
import './who.css';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long, said simply: "4 min", "2 h", "3 days".
function span(seconds) {
  if (seconds < HOUR) return `${Math.max(1, Math.floor(seconds / MINUTE))} min`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h`;
  const days = Math.floor(seconds / DAY);
  return `${days} day${days > 1 ? 's' : ''}`;
}

const idleText = (p) => (p.away ? 'stepped away' : p.idle < MINUTE ? 'active now' : `idle ${span(p.idle)}`);
const agoText = (p) => (p.ago < MINUTE ? 'just now' : `${span(p.ago)} ago`);

// Pals first, keeping the server's order (most active, or most recent) within each.
const palsFirst = (list) => [...list.filter((p) => isPal(p.pid)), ...list.filter((p) => !isPal(p.pid))];

function row(p, status, myPid) {
  const item = el('li', `who-row${p.pid === myPid ? ' me' : ''}`);
  const avatar = Object.hasOwn(CHARACTER_BY_ID, p.avatar) ? img(spriteUrl(p.avatar), 'who-avatar') : el('span', 'who-avatar');
  const name = el('span', 'who-name', p.pid === myPid ? `${p.name} (you)` : p.name);
  if (p.pid !== myPid && isPal(p.pid)) name.prepend(el('span', 'pal-mark', '♥'));
  item.append(avatar, name, el('span', 'who-level', `Lv ${p.level}`), el('span', `who-when${status.hot ? ' hot' : ''}`, status.text));
  return item;
}

function section(title, players, statusOf, empty, myPid) {
  const part = el('section', 'who-section');
  part.append(el('h3', 'who-heading', `${title} · ${players.length}`));
  if (!players.length) {
    part.append(el('p', 'who-empty', empty));
    return part;
  }
  const list = el('ul', 'who-list');
  list.append(...palsFirst(players).map((p) => row(p, statusOf(p), myPid)));
  part.append(list);
  return part;
}

// "Who's around": who's in the world now and how long since they last did
// anything, then who's been by in the last 3 days, pals (♥) first. For the
// title screen and the who's-here sheet; `myPid` marks the player's own row.
export function whoList({ myPid = null } = {}) {
  const root = el('div', 'who');
  const status = el('p', 'who-empty', 'Looking…');
  root.append(status);
  fetchWho().then((data) => {
    if (!data?.here || !data?.left) {
      status.textContent = data?.error ?? "Couldn't reach the world just now. Try again in a minute.";
      return;
    }
    status.remove();
    const note = el('p', 'who-note', 'marks your pals: tap someone in the world, then Make pal. To keep yourself off this list, turn on Appear offline in Settings.');
    note.prepend(el('span', 'pal-mark', '♥'));
    root.append(
      section('Here now', data.here, (p) => ({ text: idleText(p), hot: !p.away && p.idle < MINUTE }), "Nobody's in the world right now.", myPid),
      section('Seen in the last 3 days', data.left, (p) => ({ text: agoText(p) }), 'Nobody else has been by lately.', myPid),
      note,
    );
  });
  return root;
}
