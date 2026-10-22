import { CHARACTERS, CHARACTER_BY_ID, INVITE, NAME_COLORS, RARITIES, SEASONS, SEASON_COLORS, SHOP, TITLES, TITLE_BY_ID, titleProgress } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { fullQuality, resetQuality } from '../display.js';
import { button, el, iconButton, img, spriteUrl } from './dom.js';
import { HOW_TO_PLAY } from './howto.js';
import { isPal, togglePal } from './pals.js';
import { shareAlbum } from './sharecard.js';
import { settingToggles } from './toggles.js';
import { inviteLink } from '../net/invite.js';
import { savedProfile } from '../net/profile.js';

// The share sheet on phones; a copied link elsewhere. The link is this
// player's own invite: whoever comes by it starts next to them.
async function shareLink(button, code) {
  const url = inviteLink(code);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Hairy Popsicles: The MMO', text: `Come grow gross little characters with me. Get to level ${INVITE.level} and we both get a Boil Seed.`, url });
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
  let season = null;  // { id, name, ends } while a limited-time season is on
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

  const palMark = () => el('span', 'pal-mark', '♥');

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
      if (p.color) who.style.color = p.color;
      if (p.id !== myId && isPal(p.pid)) who.prepend(palMark());
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
    const invite = button('sheet-button', 'Invite a friend', () => shareLink(invite, me?.inviteCode));
    const actionsRow = el('div', 'sheet-actions');
    actionsRow.append(invite);
    open(
      `Who's here · ${Object.keys(players).length}`,
      el('p', 'overlay-hint', 'Ranked by album size. Tap someone to see them, or to make them a pal ♥.'),
      list,
      el('p', 'overlay-hint', `Invite a friend: they start right next to you, and when they reach level ${INVITE.level} you both get a Boil Seed.`),
      actionsRow,
    );
  }

  function inspect(id) {
    const p = players[id];
    if (!p) return close();
    showing = { kind: 'inspect', id };
    const best = CHARACTER_BY_ID[p.best];
    const avatar = CHARACTER_BY_ID[p.avatar];
    const portrait = img(spriteUrl(p.avatar), 'inspect-portrait');
    const facts = el('div', 'inspect-facts');
    const nameLine = el('p', 'inspect-name', p.name);
    if (p.color) nameLine.style.color = p.color;
    if (id !== myId && isPal(p.pid)) nameLine.prepend(palMark());
    facts.append(
      nameLine,
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
        button('sheet-button', 'Give a character', () => giftPicker(id)),
        button(`sheet-button${isPal(p.pid) ? ' quiet' : ''}`, isPal(p.pid) ? 'Unpal' : 'Make pal ♥', () => {
          sfx.click();
          togglePal(p.pid, p.name);
          actions.palsChanged();
          inspect(id);
        }),
        button('sheet-button quiet', muted.has(id) ? 'Unmute' : 'Mute', () => {
          if (muted.has(id)) muted.delete(id);
          else muted.add(id);
          inspect(id);
        }),
      );
    } else {
      const share = button('sheet-button', 'Share my album', async () => {
        if (!me) return;
        share.disabled = true;
        share.textContent = 'Making it...';
        const result = await shareAlbum({
          name: p.name, title: p.title, level: me.level, avatar: p.avatar,
          collection: me.collection, shinies: me.shinies ?? {}, nameColor: p.color, inviteCode: me.inviteCode,
        });
        share.disabled = false;
        share.textContent = result === 'downloaded' ? 'Saved the picture' : 'Share my album';
      });
      actionsRow.append(
        button('sheet-button', 'Shop', () => shop()),
        share,
        button('sheet-button quiet', 'Change character', () => { close(); actions.openAlbum(); }),
      );
    }
    open(id === myId ? 'You' : 'Player', top, actionsRow, ...(id === myId && me ? [titlesList()] : []));
  }

  // Pick one of your spare characters (you have 2 or more) to give to someone.
  function giftPicker(id) {
    const p = players[id];
    if (!p || !me) return close();
    showing = { kind: 'gift', id };
    const spares = CHARACTERS.filter((c) => (me.collection[c.id] ?? 0) >= 2);
    if (!spares.length) {
      open(`Give to ${p.name}`, el('p', 'overlay-hint', "You don't have any spares yet: grow a second copy of someone and you can give one away."));
      return;
    }
    const grid = el('div', 'gift-grid');
    for (const c of spares) {
      const card = button('gift-card', null, () => {
        actions.gift(id, c.id);
        close();
      });
      card.style.setProperty('--rarity', RARITIES[c.rarity].color);
      card.append(img(spriteUrl(c.id)), el('span', 'gift-name', c.name), el('span', 'gift-count', `×${me.collection[c.id]}`));
      grid.append(card);
    }
    open(`Give to ${p.name}`, el('p', 'overlay-hint', 'Tap a character to give them one of your spare copies. You keep the rest.'), grid);
  }

  // Things to spend scraps on: fertilizer, candles for your plot, a name color.
  function shop() {
    if (!me) return;
    showing = { kind: 'shop' };
    const afford = (cost) => me.currency >= cost;
    const item = (def, state, buy, enabled = true) => {
      const row = el('div', 'shop-item');
      const info = el('div', 'shop-info');
      info.append(el('span', 'shop-name', def.name), el('span', 'shop-text', def.text), el('span', 'shop-state', state));
      const buyButton = button('sheet-button shop-buy', `${def.cost} scraps`, buy);
      buyButton.disabled = !enabled || !afford(def.cost);
      row.append(info, buyButton);
      return row;
    };
    const plot = actions.myPlot();
    const candles = plot?.candles ?? 0;
    const swatches = el('div', 'shop-colors');
    for (const [color, hex] of Object.entries(NAME_COLORS)) {
      const owned = me.colors.includes(color);
      // Season colors are sold in the season's own section; once bought they wear like any other.
      if (SEASON_COLORS.has(color) && !owned) continue;
      const worn = me.nameColor === color;
      const swatch = button(`shop-swatch${owned ? ' owned' : ''}${worn ? ' worn' : ''}`, color, () => {
        if (worn) actions.setColor(null);
        else if (owned) actions.setColor(color);
        else if (afford(SHOP.color.cost)) actions.buy('color', color);
      });
      swatch.style.color = hex;
      swatch.disabled = !owned && !afford(SHOP.color.cost);
      swatches.append(swatch);
    }
    const colorRow = el('div', 'shop-item column');
    const colorInfo = el('div', 'shop-info');
    colorInfo.append(
      el('span', 'shop-name', SHOP.color.name),
      el('span', 'shop-text', `${SHOP.color.text} ${SHOP.color.cost} scraps each; tap one you own to wear it.`),
    );
    colorRow.append(colorInfo, swatches);
    open(
      `Shop · ${me.currency} scraps`,
      ...seasonShop(),
      item(SHOP.fertilizer, me.inventory.fertilizer ? `You have ${me.inventory.fertilizer} doses` : '', () => actions.buy('fertilizer')),
      item(SHOP.candle, plot ? `${candles}/${SHOP.candle.max} on your plot` : 'Claim a plot first', () => actions.buy('candle'), Boolean(plot) && candles < SHOP.candle.max),
      colorRow,
    );
  }

  // While a season is on, its own corner of the shop, paid for in its token.
  function seasonShop() {
    const def = season && SEASONS.find((s) => s.id === season.id);
    if (!def) return [];
    const { token, color } = def;
    const have = me.inventory.teeth ?? 0;
    const lastDay = new Date(Date.parse(`${def.ends}T00:00:00Z`) - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const title = TITLE_BY_ID[def.title];
    const box = el('div', `shop-season ${def.id}`);
    box.append(
      el('h3', 'shop-season-name', def.name),
      el('p', 'shop-text', `Until ${lastDay}. Harvests drop ${token.many} ${token.icon} (rarer ones more often). You have ${have}.`),
    );
    const owned = me.colors.includes(color.id);
    const row = el('div', 'shop-item');
    const info = el('div', 'shop-info');
    const name = el('span', 'shop-name', `${color.name} name`);
    name.style.color = NAME_COLORS[color.id];
    info.append(name, el('span', 'shop-text', 'Only sold this season.'), el('span', 'shop-state', owned ? 'Yours. Wear it from the colors below.' : ''));
    const buy = button('sheet-button shop-buy', owned ? 'Owned' : `${color.cost} ${token.icon}`, () => actions.buy('seasonColor'));
    buy.disabled = owned || have < color.cost;
    row.append(info, buy);
    box.append(row);
    if (title) {
      const got = me.titles.includes(title.id);
      const count = Math.min(title.count, me.stats[title.stat] ?? 0);
      box.append(el('p', 'shop-text', got ? `You earned the ${title.name} title.` : `${title.goal} for the ${title.name} title (${count}/${title.count}).`));
    }
    return [box];
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
    const list = settingToggles('settings-list', 'setting');
    const rules = el('details', 'sheet-rules');
    const rulesList = el('ul');
    rulesList.append(...HOW_TO_PLAY.map((line) => el('li', null, line)));
    rules.append(el('summary', null, 'How to play'), rulesList);
    // Saves live on the device; this is how they get to another one.
    const move = el('details', 'sheet-rules');
    const code = el('textarea', 'save-code');
    code.readOnly = true;
    code.rows = 3;
    code.value = savedProfile() ?? '';
    const copy = button('sheet-button', 'Copy my save', async () => {
      try {
        await navigator.clipboard.writeText(code.value);
        copy.textContent = 'Copied';
      } catch {
        code.select();
      }
    });
    move.append(
      el('summary', null, 'Move to another phone'),
      el('p', 'overlay-hint', 'Copy this code, then on the other phone choose "Load a save" on the title screen and paste it. After that both phones are you, and whichever you open picks up your latest progress. Play on one phone at a time.'),
      el('p', 'overlay-hint warn', 'This code is your save. Anyone who has it can play as you, so never post it or send it to anyone. Nobody from the game will ever ask for it.'),
      code,
      copy,
    );
    // The game lightens its graphics by itself on devices that struggle; this undoes it.
    const graphics = [];
    if (!fullQuality()) {
      graphics.push(
        el('p', 'overlay-hint', 'Graphics were lightened to keep the game smooth on this device.'),
        button('sheet-button quiet', 'Try full graphics again', () => {
          resetQuality();
          window.location.reload();
        }),
      );
    }
    const leave = button('sheet-button quiet', 'Leave the world', () => actions.leave());
    const note = el('p', 'overlay-hint', "Your progress is saved on this device. Your plot comes back with you and keeps growing while you're away.");
    open('Settings', list, rules, move, ...graphics, note, leave);
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
      else if (showing?.kind === 'shop') shop();
    },

    shop: () => { sfx.click(); shop(); },

    setSeason(next) {
      season = next;
      if (showing?.kind === 'shop') shop();
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
