import { CHARACTERS, ITCH, QUEST_KINDS, RARITIES, SEEDS, TITLE_BY_ID, WORLD_EVENT, levelProgress, MAX_LEVEL } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { createAlbum } from './album.js';
import { createChat } from './chat.js';
import { createCoach } from './coach.js';
import { button, el, formatClock, iconButton, img, spriteUrl, worldUrl } from './dom.js';
import { createMinimap } from './minimap.js';
import { createReveal } from './reveal.js';
import { createSheets } from './sheets.js';
import './hud.css';

const TOAST_MS = 2600;
const MAX_TOASTS = 3;
const PLACE_MS = 2600;   // how long a place's name stays up
const BANNER_MS = 3800;
const MAX_BANNERS = 2;

// Everything drawn over the world: DOM, so text stays crisp and taps are easy to hit.
// `actions` are the scene's callbacks: wear, chat, emote, goTo, goToBoss, travel, leave.
export function createHud(actions) {
  const root = el('div', 'hud');

  // ---- top left: who you are
  // Tap your card for your titles and stats.
  const card = button('hud-card', null, () => sheets.inspectMe());
  const portrait = img('', 'hud-portrait');
  const name = el('span', 'hud-name');
  const level = el('span', 'hud-level');
  const xpFill = el('div', 'hud-xp-fill');
  const xpBar = el('div', 'hud-xp');
  xpBar.append(xpFill);
  const scraps = el('span', 'hud-scraps-count');
  const scrapsRow = el('div', 'hud-scraps');
  // The season's token (teeth), shown while it's on or while you still have some.
  const teethCount = el('span', 'hud-teeth');
  teethCount.hidden = true;
  scrapsRow.append(img(worldUrl('drop-pus'), 'hud-scraps-icon'), scraps, teethCount);
  const nameRow = el('div', 'hud-name-row');
  nameRow.append(name, level);
  const cardBody = el('div', 'hud-card-body');
  cardBody.append(nameRow, xpBar, scrapsRow);
  card.append(portrait, cardBody);

  // ---- quests under the card
  const quests = el('div', 'hud-quests');
  const questsHeader = button('hud-quests-header', 'Quests', () => quests.classList.toggle('collapsed'));
  const questList = el('ul', 'hud-quest-list');
  quests.append(questsHeader, questList);

  // The Itch sits on top of the quests while it's on: one goal for the whole world.
  const itchRow = el('li', 'quest itch');
  const itchText = el('span', 'quest-text');
  const itchCount = el('span', 'quest-count');
  const itchFill = el('div', 'quest-fill');
  const itchBar = el('div', 'quest-bar');
  itchBar.append(itchFill);
  const itchNote = el('span', 'quest-note');
  itchRow.append(itchText, itchCount, itchBar, itchNote);
  itchRow.hidden = true;

  // ---- top right: menus, minimap, live events
  const corner = el('div', 'hud-corner');
  const buttons = el('div', 'hud-buttons');
  const albumButton = iconButton('hud-round', 'album', 'Album', () => album.open());
  const albumBadge = el('span', 'hud-badge');
  albumBadge.hidden = true;
  albumButton.append(albumBadge);
  buttons.append(
    albumButton,
    iconButton('hud-round', 'shop', 'Shop', () => sheets.shop()),
    iconButton('hud-round', 'ranks', 'Leaderboard', () => sheets.leaderboard()),
    iconButton('hud-round', 'gear', 'Settings', () => sheets.settings()),
  );
  const minimap = createMinimap({ onTravel: actions.travel });
  const events = el('div', 'hud-events');
  corner.append(buttons, minimap.root, events);

  const bossPill = button('event-pill boss', null, () => actions.goToBoss());
  const bossLabel = el('span', 'event-label', 'The Boil');
  const bossHpFill = el('div', 'event-hp-fill');
  const bossHp = el('div', 'event-hp');
  bossHp.append(bossHpFill);
  const bossTime = el('span', 'event-time');
  bossPill.append(bossLabel, bossTime, bossHp);
  const moonPill = el('div', 'event-pill moon');
  const moonTime = el('span', 'event-time');
  moonPill.append(el('span', 'event-label', 'Blood Moon'), moonTime);
  const rainPill = el('div', 'event-pill rain');
  const rainTime = el('span', 'event-time');
  rainPill.append(el('span', 'event-label', 'Pus Rain'), rainTime);
  // A limited-time season: tap for the shop, where its things are sold.
  const seasonPill = button('event-pill season', null, () => sheets.shop());
  const seasonLabel = el('span', 'event-label');
  const seasonTime = el('span', 'event-time');
  seasonPill.append(seasonLabel, seasonTime);
  bossPill.hidden = true;
  moonPill.hidden = true;
  rainPill.hidden = true;
  seasonPill.hidden = true;
  events.append(bossPill, moonPill, rainPill, seasonPill);

  // Points at the boss while it's off screen.
  const bossArrow = el('div', 'boss-arrow');
  bossArrow.hidden = true;

  // ---- bottom: seeds, chat, emotes
  const dock = el('div', 'dock');
  const seedRow = el('div', 'dock-seeds');
  const seedChips = new Map();
  for (const seed of SEEDS) {
    const chip = button('seed-chip', null, () => {
      const state = chipState(seed);
      if (state.locked) {
        sfx.nope();
        toast(state.reason);
        return;
      }
      sfx.click();
      selectSeed(seed.id);
    });
    const tag = el('span', 'seed-tag');
    chip.append(img(worldUrl(`seed-${seed.id}`), 'seed-icon'), tag);
    chip.setAttribute('aria-label', seed.name);
    seedRow.append(chip);
    seedChips.set(seed.id, { chip, tag });
  }
  const seedName = el('div', 'dock-seed-name');
  const chat = createChat({ onSend: actions.chat, onEmote: actions.emote });
  dock.append(seedName, seedRow, chat.chatButton, chat.emoteButton);

  const toasts = el('div', 'toasts');
  const banners = el('div', 'banners');
  const bloodMoon = el('div', 'blood-moon-veil');
  bloodMoon.hidden = true;
  const seasonVeil = el('div', 'season-veil');
  seasonVeil.hidden = true;

  const album = createAlbum({
    onWear: (id) => actions.wear(id),
    onOpen: () => {
      albumBadge.hidden = true;
      actions.albumOpened();
    },
  });
  const sheets = createSheets({ ...actions, openAlbum: () => album.open() });
  const reveal = createReveal({ onWear: (id) => actions.wear(id) });
  const coach = createCoach();

  root.append(seasonVeil, bloodMoon, card, quests, corner, toasts, coach.root, chat.log, banners, bossArrow, dock, chat.bar, chat.emotes);
  document.body.append(root, album.root, sheets.root, reveal.root);

  let me = null;      // private data from the server
  let pub = null;     // my public player record
  let preferred = 'pimple';  // the seed last picked; pimple seeds stand in while it's unavailable
  let lastScraps = null;
  let featured = null;  // today's featured character
  let season = null;    // the limited-time season, while one is on

  function chipState(seed) {
    if (!me) return { locked: true, reason: '' };
    if (me.level < seed.level) return { locked: true, reason: `${seed.name}s unlock at level ${seed.level}.` };
    if (seed.dropOnly && !(me.inventory[seed.id] > 0)) return { locked: true, reason: `${seed.name}s drop when The Boil bursts.` };
    return { locked: false };
  }

  function selectSeed(id) {
    preferred = id;
    renderSeeds();
  }

  function selected() {
    return chipState(SEEDS.find((s) => s.id === preferred)).locked ? 'pimple' : preferred;
  }

  function renderSeeds() {
    if (!me) return;
    for (const seed of SEEDS) {
      const { chip, tag } = seedChips.get(seed.id);
      const { locked } = chipState(seed);
      chip.classList.toggle('locked', locked);
      chip.classList.toggle('selected', seed.id === selected());
      if (seed.dropOnly) tag.textContent = `×${me.inventory[seed.id] ?? 0}`;
      else if (me.level < seed.level) tag.textContent = `Lv ${seed.level}`;
      else tag.textContent = String(seed.cost);
      chip.classList.toggle('broke', !locked && !seed.dropOnly && me.currency < seed.cost);
    }
    const seed = SEEDS.find((s) => s.id === selected());
    const doses = me.inventory.fertilizer ? ` · fertilizer ×${me.inventory.fertilizer}` : '';
    seedName.textContent = `${seed.name} · ${seed.dropOnly ? 'free' : `${seed.cost} scraps`}${doses}`;
  }

  function questRow(text, progress, target, className = 'quest') {
    const row = el('li', className);
    const fill = el('div', 'quest-fill');
    fill.style.width = `${(progress / target) * 100}%`;
    const bar = el('div', 'quest-bar');
    bar.append(fill);
    row.append(el('span', 'quest-text', text), el('span', 'quest-count', `${progress}/${target}`), bar);
    return row;
  }

  function renderQuests() {
    const rows = me.quests.map((q) => questRow(q.text, q.progress, q.target));
    // The day's big quest sits on top, in gold.
    const daily = me.dailyQuest;
    if (daily && !daily.done) {
      rows.unshift(questRow(`Daily: ${QUEST_KINDS[daily.kind].text(daily.target)}`, daily.progress, daily.target, 'quest daily'));
    } else if (daily?.done) {
      const row = el('li', 'quest daily done');
      row.append(el('span', 'quest-text', 'Daily quest done. New one tomorrow.'));
      rows.unshift(row);
    }
    questList.replaceChildren(itchRow, ...rows);
  }

  function renderCard() {
    if (!pub || !me) return;
    portrait.src = spriteUrl(pub.avatar);
    name.textContent = pub.name;
    level.textContent = `Lv ${me.level}`;
    xpFill.style.width = `${(me.level >= MAX_LEVEL ? 1 : levelProgress(me.xp)) * 100}%`;
    scraps.textContent = me.currency;
    teethCount.hidden = !season && !me.inventory.teeth;
    teethCount.textContent = `🦷 ${me.inventory.teeth ?? 0}`;
    if (lastScraps !== null && me.currency !== lastScraps) {
      const delta = me.currency - lastScraps;
      const float = el('span', `hud-scraps-delta ${delta > 0 ? 'up' : 'down'}`, `${delta > 0 ? '+' : ''}${delta}`);
      scrapsRow.append(float);
      setTimeout(() => float.remove(), 1100);
      scrapsRow.classList.remove('bump');
      void scrapsRow.offsetWidth;
      scrapsRow.classList.add('bump');
    }
    lastScraps = me.currency;
  }

  function toast(text, { characterId, color } = {}) {
    const node = el('div', 'toast');
    if (characterId) node.append(img(spriteUrl(characterId)));
    const message = el('span', null, text);
    if (color) message.style.color = color;
    node.append(message);
    toasts.append(node);
    while (toasts.children.length > MAX_TOASTS) toasts.firstElementChild.remove();
    setTimeout(() => node.remove(), TOAST_MS);
  }

  return {
    get selectedSeed() {
      return selected();
    },

    selectSeed,

    setMe(nextMe) {
      const firstTime = !me;
      me = nextMe;
      renderCard();
      renderQuests();
      renderSeeds();
      album.update(me.collection, me.shinies ?? {}, pub?.avatar, me.rows);
      sheets.setMe(me);
      if (featured) album.setFeatured(featured, Boolean(me.collection[featured]));
      if (firstTime) lastScraps = me.currency;
    },

    setPublic(nextPub) {
      pub = nextPub;
      renderCard();
      if (me) album.update(me.collection, me.shinies ?? {}, pub.avatar, me.rows);
    },

    setFeatured(id) {
      featured = id;
      album.setFeatured(id, Boolean(me?.collection[id]));
    },

    setPlayers(players, myId) {
      sheets.setPlayers(players, myId);
    },

    coach(step) {
      coach.show(step);
      // The album button pulses while the coach is pointing at it.
      albumButton.classList.toggle('nudge', step === 'album');
    },

    // A brand-new player's first minute: just the essentials on screen.
    setTutorial(on) {
      root.classList.toggle('tutorial', on);
    },

    intro: (avatar, onGo) => reveal.intro(avatar, onGo),

    tip(key, text) {
      coach.tip(key, text);
    },

    markNew() {
      albumBadge.hidden = false;
    },

    // Live events: the world event (The Boil, The Scab...), the blood moon and
    // the pus rain, with countdowns. The world event's bar is how much is left of it.
    setEvents({ boss, event, bloodMoon: moon, rain, itch, season: nextSeason }, now) {
      const going = boss ? { kind: 'boil', left: boss.hp / boss.maxHp, endsAt: boss.expiresAt } : event && {
        kind: event.kind,
        endsAt: event.expiresAt,
        left: event.kind === 'scab' ? event.pieces.filter((p) => !p).length / event.pieces.length
          : event.kind === 'gash' ? event.crumbs.length / event.total
          : 1 - event.progress,
      };
      bossPill.hidden = !going;
      if (going) {
        bossPill.dataset.kind = going.kind;
        bossLabel.textContent = WORLD_EVENT.names[going.kind];
        bossTime.textContent = formatClock(going.endsAt - now);
        bossHpFill.style.width = `${going.left * 100}%`;
      }
      moonPill.hidden = !moon;
      bloodMoon.hidden = !moon;
      if (moon) moonTime.textContent = formatClock(moon.endsAt - now);
      rainPill.hidden = !rain;
      if (rain) rainTime.textContent = formatClock(rain.endsAt - now);
      this.setItch(itch, now);
      this.setSeason(nextSeason, now);
    },

    setSeason(next, now) {
      if (next?.id !== season?.id) {
        season = next ?? null;
        sheets.setSeason(season);
        seasonVeil.hidden = !season;
        seasonVeil.className = `season-veil${season ? ` ${season.id}` : ''}`;
        renderCard();
      }
      seasonPill.hidden = !season;
      if (!season) return;
      seasonLabel.textContent = season.name.replace(/^The /, '');
      const days = Math.ceil((Date.parse(`${season.ends}T00:00:00Z`) - now) / 86_400_000);
      seasonTime.textContent = days > 1 ? `${days}d left` : 'last day';
    },

    setItch(itch, now) {
      itchRow.hidden = !itch;
      if (!itch) return;
      itchText.textContent = `The Itch: ${ITCH.kinds[itch.kind].text(itch.target)}`;
      itchCount.textContent = `${itch.progress}/${itch.target}`;
      itchFill.style.width = `${(itch.progress / itch.target) * 100}%`;
      const share = me?.itchShare?.id === itch.id ? me.itchShare.count : 0;
      itchNote.textContent = `${formatClock(itch.endsAt - now)} left · ${share ? `you've helped ${share}` : 'help to share the reward'}`;
    },

    // Screen position (CSS px) of an off-screen boss, or null to hide the arrow.
    pointAtBoss(at) {
      bossArrow.hidden = !at;
      if (!at) return;
      bossArrow.style.transform = `translate(${at.x}px, ${at.y}px) rotate(${at.angle}rad)`;
    },

    minimap,
    toast,

    // The name of the place you've just walked into, big, for a moment.
    place(name, line) {
      root.querySelector('.place')?.remove();
      const node = el('div', 'place');
      node.append(el('div', 'place-name', name), el('div', 'place-line', line));
      root.append(node);
      setTimeout(() => node.classList.add('out'), PLACE_MS);
      setTimeout(() => node.remove(), PLACE_MS + 900);
    },

    announce(text, kind) {
      // World news waits until a new player has the basics (it's in the chat log meanwhile).
      if (root.classList.contains('tutorial')) return;
      const node = el('div', `banner banner-${kind ?? 'info'}`);
      node.textContent = text;
      banners.append(node);
      while (banners.children.length > MAX_BANNERS) banners.firstElementChild.remove();
      setTimeout(() => {
        node.classList.add('out');
        setTimeout(() => node.remove(), 400);
      }, BANNER_MS);
    },

    questDone({ text, scraps: s, xp, daily, itch, boil }) {
      if (daily || itch) sfx.fanfare();
      else sfx.quest();
      const node = el('div', `banner ${daily ? 'banner-legendary' : itch ? 'banner-itch' : 'banner-quest'}`);
      const extra = boil ? ` · +${boil} Boil Seed` : '';
      const heading = daily ? 'Daily quest done! ' : itch ? 'Itch scratched! ' : 'Quest done! ';
      node.append(el('strong', null, heading), document.createTextNode(`${text} · +${s} scraps · +${xp} xp${extra}`));
      banners.append(node);
      while (banners.children.length > MAX_BANNERS) banners.firstElementChild.remove();
      setTimeout(() => {
        node.classList.add('out');
        setTimeout(() => node.remove(), 400);
      }, BANNER_MS);
    },

    reveal: reveal.character,
    levelUp: reveal.levelUp,
    albumRow: reveal.albumRow,
    welcome: reveal.welcome,
    daily: (notice) => reveal.daily({ ...notice, featuredOwned: Boolean(me?.collection[notice.featured]) }),
    shop: () => sheets.shop(),
    titleEarned: (id) => {
      sfx.fanfare();
      reveal.title(TITLE_BY_ID[id], () => actions.setTitle(id));
    },
    chatLine: chat.line,
    chatHistory: chat.history,
    isMuted: sheets.isMuted,
    inspect: sheets.inspect,
    rarityColor: (rarity) => RARITIES[rarity].color,
    albumSize: CHARACTERS.length,

    // True while a panel covers the world, so taps don't fall through to it.
    blocking() {
      return album.isOpen() || sheets.isOpen() || reveal.isOpen() || chat.isTyping();
    },
  };
}
