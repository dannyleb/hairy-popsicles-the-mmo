import colyseus from '@colyseus/core';
import {
  ALBUM_ROWS,
  CHARACTER_BY_ID,
  CHAT_COOLDOWN_MS,
  CHAT_MAX,
  DAILY_QUEST,
  EMOTE_BY_ID,
  EMOTE_COOLDOWN_MS,
  FERTILIZER_SPEEDUP,
  GIFT_COOLDOWN_MS,
  ITCH,
  NAME_COLORS,
  PLOT_SIZE,
  QUEST_KINDS,
  RARITIES,
  RARITY_ORDER,
  REACH,
  SEASON_COLORS,
  SEED_BY_ID,
  SHOP,
  SHINY_CHANCE,
  SHINY_SCRAPS,
  STAT_NAMES,
  TITLES,
  TITLE_BY_ID,
  STARTING_CURRENCY,
  TEND_MAX,
  TEND_SCRAPS,
  TEND_SHARE,
  TILE_SIZE,
  ARRIVAL_SLACK_MS,
  travelMs,
  WORLD_HEIGHT_PLOTS,
  WORLD_PX,
  WORLD_WIDTH_PLOTS,
  XP,
  greenThumb,
  holeOpen,
  featuredFor,
  levelFor,
  rowComplete,
  seasonOn,
  starsFor,
  titleProgress,
  wearBonus,
} from '@hptm/shared';
import { createBoss } from '../game/boss.js';
import { checkIn, dayOf } from '../game/daily.js';
import { rememberDeparture, takeDeparture } from '../game/departed.js';
import { createItch } from '../game/itch.js';
import { createRain } from '../game/rain.js';
import { maskText, plainText } from '../game/filter.js';
import { cleanName, newProfileId, publicIdOf, readToken, saveToken } from '../game/profile.js';
import { advance, advanceDaily, dealDaily, dropImpossible, restoreDaily, restoreQuests, topUp } from '../game/quests.js';
import { randomCommon, rollCharacter } from '../game/roll.js';
import { clientAddress } from '../net.js';
import { recordJoin, recordOnline } from '../stats.js';

const { Room, ServerError } = colyseus;

// Speed up timers for local testing, e.g. GROW_SCALE=0.01 EVENT_SCALE=0.01.
const GROW_SCALE = Number(process.env.GROW_SCALE) || 1;
const EVENT_SCALE = Number(process.env.EVENT_SCALE) || 1;
const SHINY_BOOST = Number(process.env.SHINY_BOOST) || 1;  // e.g. 40 to make every crop shiny

const SPAWN_SPREAD = 400;
const BROADCAST_MS = 100;
const TICK_MS = 1000;
const CHAT_LOG = 30;
const RECONNECT_SECONDS = 90;
const SAVE_MS = 2000;            // a player's save goes out at most this often
const WELCOME_AFTER_MS = 60_000; // away at least this long to get a "welcome back"
// A departed player's plot (if anything's growing in it) stays in the world this
// long, for others to see and squeeze, and is theirs again when they come back.
const PLOT_HOLD_MS = Number(process.env.PLOT_HOLD_MS) || 24 * 3600_000;
const MAX_HELD_PLOTS = 120;     // past this, the longest-held plots go first
const HOLD_FROM_LEVEL = 2;      // throwaway saves don't get to fill the world with plots
// A brand-new player's first crops (until their first harvest) ripen this fast,
// whatever they turn out to be: the first win comes inside the first minute.
const FIRST_CROPS_MS = 8000;

// There is one world, and it lives as long as the server: a second would split
// players (and their held plots) between them.
let theWorld = null;
export const getWorld = () => theWorld;
const REPLACED = 4001;           // close code: the same save was opened somewhere else
const MESSAGES = { perSecond: 20, burst: 40 };  // per player; anything past this is dropped
const SEATS_PER_ADDRESS = Number(process.env.SEATS_PER_ADDRESS) || 10;  // players at once from one network
const SEAT_HOLD_SECONDS = 10;    // a join's seat waits this long for its connection
const SYNC_COOLDOWN_MS = 1000;   // a full copy of the world, at most this often per connection
const ANNOUNCE_LEVELS = 5;  // announce every 5th level
const BLOOD_MOON = { firstMs: 150_000, everyMs: 9 * 60_000, lastsMs: 90_000 };
// Pretend it's this (UTC) day for seasons, e.g. SEASON_DAY=2026-10-25 for testing.
const today = () => process.env.SEASON_DAY || dayOf(Date.now());

const rank = (characterId) => RARITY_ORDER.indexOf(CHARACTER_BY_ID[characterId].rarity);

// v1: state is a plain object broadcast in full when it changes (at most every
// BROADCAST_MS). Per-player data (scraps, collection, quests) goes only to that
// player. Swap for @colyseus/schema delta sync once crowds make this expensive.
export class WorldRoom extends Room {
  maxClients = 300;

  onCreate() {
    if (theWorld) throw new Error('The world is full right now. Try again in a bit.');
    theWorld = this;
    // One world that carries on when it empties: held plots, the departed and
    // the event clocks all live here, so it's never thrown away.
    this.autoDispose = false;
    this.setSeatReservationTime(SEAT_HOLD_SECONDS);
    this.players = {};
    this.plots = {};
    this.heldPlots = new Map();  // profile id → key of their plot, while they're gone (oldest first)
    this.chatLog = [];
    this.dirty = false;
    this.boss = createBoss(this, EVENT_SCALE);
    this.rain = createRain(this, EVENT_SCALE);
    this.itch = createItch(this, EVENT_SCALE);
    this.bloodMoon = null;
    this.nextBloodMoon = Date.now() + BLOOD_MOON.firstMs * EVENT_SCALE;

    // Every message is from a client we don't trust: anything odd in it must
    // cost that one message, never the server (an uncaught error ends the process).
    const on = (type, handler) => this.onMessage(type, (client, message) => {
      const player = this.players[client.sessionId];
      if (!player || !this.withinBudget(player)) return;
      try {
        handler(player, message !== null && typeof message === 'object' ? message : {}, client);
      } catch (error) {
        console.error(`'${type}' from ${client.sessionId} failed:`, error);
      }
    });
    on('move', (p, m) => this.handleMove(p, m));
    on('claimPlot', (p, m) => this.handleClaimPlot(p, m));
    on('plant', (p, m) => this.handlePlant(p, m));
    on('harvest', (p, m) => this.handleHarvest(p, m));
    on('tend', (p, m) => this.handleTend(p, m));
    on('setAvatar', (p, m) => this.handleSetAvatar(p, m));
    on('chat', (p, m) => this.handleChat(p, m));
    on('emote', (p, m) => this.handleEmote(p, m));
    on('hitBoss', (p) => this.handleHitBoss(p));
    on('grab', (p, m) => this.handleGrab(p, m));
    on('setTitle', (p, m) => this.handleSetTitle(p, m));
    on('gift', (p, m) => this.handleGift(p, m));
    on('buy', (p, m) => this.handleBuy(p, m));
    on('setColor', (p, m) => this.handleSetColor(p, m));
    on('sync', (p, m, client) => {
      // The biggest thing the server sends, so it's not something to ask for on repeat.
      const now = Date.now();
      if (now - (client.userData?.syncAt ?? 0) < SYNC_COOLDOWN_MS) return;
      client.userData = { ...client.userData, syncAt: now };
      this.sendWorld(p, client, true);
    });

    this.clock.setInterval(() => this.guarded('flush', () => this.flush()), BROADCAST_MS);
    this.clock.setInterval(() => this.guarded('tick', () => this.tick()), TICK_MS);
  }

  onDispose() {
    if (theWorld === this) theWorld = null;
  }

  // Last line of defense: a bug in the room is logged, never fatal to the server.
  onUncaughtException(error, methodName) {
    if (error.cause instanceof ServerError) console.log(`refused in ${methodName}: ${error.cause.message}`);
    else console.error(`room error in ${methodName}:`, error);
  }

  // Seats are shared out by network, so one person can't fill the world with
  // players of their own. (A reconnection skips this, but keeps the address.)
  onAuth(client, options, request) {
    const { address } = clientAddress(request);
    const here = this.clients.filter((c) => c.auth?.address === address).length;
    if (here >= SEATS_PER_ADDRESS) throw new ServerError(429, 'Too many players from your network right now. Try again later.');
    return { address };
  }

  guarded(name, run) {
    try {
      run();
    } catch (error) {
      this.onUncaughtException(error, name);
    }
  }

  onJoin(client, options) {
    let save = readToken(options?.profile);
    // If this player left earlier, the server's copy of their save is the newest.
    const latest = save && takeDeparture(save.id);
    if (latest) save = readToken(latest) ?? save;
    // The same save already in the world (a reload, a second tab, or a dropped
    // phone coming back as a new connection): carry on as that player.
    const existing = save && Object.values(this.players).find((p) => p.profileId === save.id);
    const player = existing ? this.takeOver(existing, client) : this.createPlayer(client, save);
    const name = cleanName(options?.name);
    if (name) this.rename(player, name);

    const daily = checkIn(player.daily, Date.now());
    const today = dayOf(Date.now());
    if (player.dailyQuest?.day !== today) dealDaily(player, today);
    if (daily) {
      player.currency += daily.reward.scraps ?? 0;
      player.inventory.boil += daily.reward.boil ?? 0;
      player.notices.push({ kind: 'daily', ...daily, featured: featuredFor(today) });
    }
    this.checkTitles(player);  // a streak can earn one just by showing up
    this.checkRows(player);    // and a save from before row rewards may have some due
    recordJoin(player.profileId, Object.keys(this.players).length);
    console.log(`join ${player.id} ${player.name}${save ? ' (saved)' : ''} (${this.clients.length} here)`);
    topUp(player, this.othersPresent(player));
    player.saveDirty = true;
    this.sendWorld(player, client);
    this.markDirty();
  }

  createPlayer(client, save) {
    // Everyone starts with one common character, so they have an avatar and a first album entry.
    const starter = randomCommon();
    const player = {
      id: client.sessionId,
      profileId: save?.id ?? newProfileId(),
      pid: null,  // public id, set below
      name: save?.name || `Guest${Math.floor(Math.random() * 10000)}`,
      // Near the middle of the world, so new players land near each other.
      x: WORLD_PX / 2 + (Math.random() - 0.5) * SPAWN_SPREAD,
      y: WORLD_PX / 2 + (Math.random() - 0.5) * SPAWN_SPREAD,
      avatar: starter.id,
      level: 1,
      xp: 0,
      currency: STARTING_CURRENCY,
      collection: { [starter.id]: 1 },
      shinies: {},
      inventory: { boil: 0, fertilizer: 0, teeth: 0 },
      colors: [],
      nameColor: null,
      quests: [],
      daily: { last: null, streak: 0 },
      dailyQuest: null,
      stats: Object.fromEntries(STAT_NAMES.map((name) => [name, 0])),
      titles: [],
      title: null,
      rows: [],            // album rows (rarities) completed and paid for
      notices: [],         // shown once the client is listening ('sync')
      synced: false,
      saveDirty: true,
      lastSaveAt: 0,
      reconnection: null,  // while away: the pending reconnection, so a takeover can cancel it
      lastChatAt: 0,
      lastEmoteAt: 0,
      lastHitAt: 0,
      lastGiftAt: 0,
      joinedAt: Date.now(),
      arrivesAt: 0,
      budget: MESSAGES.burst,
      budgetAt: Date.now(),
      away: false,
    };
    if (save) {
      Object.assign(player, {
        xp: save.xp,
        level: save.level,
        currency: save.currency,
        shinies: save.shinies,
        inventory: save.inventory,
        colors: save.colors,
        nameColor: save.nameColor,
        quests: restoreQuests(save.quests),
        daily: save.daily,
        dailyQuest: restoreDaily(save.dailyQuest, dayOf(Date.now())),
        stats: save.stats,
        titles: save.titles,
        title: save.title,
        rows: save.rows,
      });
      if (Object.keys(save.collection).length) {
        player.collection = save.collection;
        player.avatar = save.avatar;
      }
    }
    player.pid = publicIdOf(player.profileId);
    this.players[player.id] = player;
    if (save?.plot || this.heldPlots.has(player.profileId)) this.restorePlot(player, save);
    return player;
  }

  // Put a saved plot back, where it was if nobody has taken the spot. Crops
  // kept growing while the player was away.
  restorePlot(player, save) {
    // Their plot may still be in the world, as others left it: newer than any save.
    const held = this.reclaimPlot(player);
    const key = held ?? (save.plot && this.freePlotNear(save.plot.key));
    if (!key) return;
    if (!held) this.plots[key] = { ownerId: player.id, ownerName: player.name, slots: save.plot.slots, candles: save.plot.candles };
    const plot = this.plots[key];
    const [px, py] = key.split(',').map(Number);
    const plotPx = PLOT_SIZE * TILE_SIZE;
    player.x = px * plotPx + plotPx / 2;
    player.y = (py + 1) * plotPx + 26;

    const now = Date.now();
    const crops = plot.slots.filter(Boolean);
    const squeezed = plot.squeezedAway ?? 0;
    delete plot.squeezedAway;
    if (save.savedAt && now - save.savedAt >= WELCOME_AFTER_MS * GROW_SCALE) {
      const ripe = crops.filter((c) => c.readyAt <= now).length;
      player.notices.push({ kind: 'welcome', awayMs: now - save.savedAt, ripe, growing: crops.length - ripe, squeezed });
    }
  }

  // A departed player's plot stays put while anything grows in it.
  holdPlot(player) {
    const [key, plot] = this.plotOf(player);
    if (!plot) return;
    if (!plot.slots.some(Boolean) || player.level < HOLD_FROM_LEVEL) {
      delete this.plots[key];
      return;
    }
    Object.assign(plot, { ownerId: null, away: true, leftAt: Date.now(), ownerLevel: player.level, squeezedAway: 0 });
    this.heldPlots.delete(player.profileId);
    this.heldPlots.set(player.profileId, key);
    while (this.heldPlots.size > MAX_HELD_PLOTS) this.dropHeldPlot(this.heldPlots.keys().next().value);
  }

  // Their plot back, if it's still being held: returns its key.
  reclaimPlot(player) {
    const key = this.heldPlots.get(player.profileId);
    this.heldPlots.delete(player.profileId);
    const plot = key && this.plots[key];
    if (!plot?.away) return null;
    Object.assign(plot, { ownerId: player.id, ownerName: player.name });
    delete plot.away;
    delete plot.leftAt;
    delete plot.ownerLevel;
    return key;
  }

  dropHeldPlot(profileId) {
    const key = this.heldPlots.get(profileId);
    this.heldPlots.delete(profileId);
    if (this.plots[key]?.away) delete this.plots[key];
    this.markDirty();
  }

  freePlotNear(key) {
    const [x0, y0] = String(key).split(',').map(Number);
    if (!Number.isInteger(x0) || !Number.isInteger(y0)) return null;
    const inside = (x, y) => x >= 0 && y >= 0 && x < WORLD_WIDTH_PLOTS && y < WORLD_HEIGHT_PLOTS;
    for (let r = 0; r < Math.max(WORLD_WIDTH_PLOTS, WORLD_HEIGHT_PLOTS); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx;
          const y = y0 + dy;
          if (inside(x, y) && !this.plots[`${x},${y}`]) return `${x},${y}`;
        }
      }
    }
    return null;
  }

  // Move a player already in the world onto a new connection, and close the old one.
  takeOver(player, client) {
    const oldId = player.id;
    const newId = client.sessionId;
    player.reconnection?.reject?.();
    this.clients.getById(oldId)?.leave(REPLACED);
    delete this.players[oldId];
    Object.assign(player, { id: newId, away: false, reconnection: null, synced: false });
    this.players[newId] = player;
    for (const plot of Object.values(this.plots)) {
      if (plot.ownerId === oldId) plot.ownerId = newId;
    }
    this.boss.renameHitter(oldId, newId);
    return player;
  }

  rename(player, name) {
    player.name = name;
    for (const plot of Object.values(this.plots)) {
      if (plot.ownerId === player.id) plot.ownerName = name;
    }
  }

  async onLeave(client, consented) {
    // Phones drop the socket whenever the app goes to the background; hold the
    // player (and their plot) for a while so they can pick up where they left off.
    const player = this.players[client.sessionId];
    if (!consented && player) {
      player.away = true;
      // Nothing reaches them while away: anything worth seeing waits as a notice
      // until the returning client asks with 'sync'.
      player.synced = false;
      this.markDirty();
      console.log(`drop ${player.id} ${player.name}`);
      try {
        // The returning client asks for a fresh copy of everything with 'sync'.
        player.reconnection = this.allowReconnection(client, RECONNECT_SECONDS);
        await player.reconnection;
        player.reconnection = null;
        player.away = false;
        this.markDirty();
        console.log(`back ${player.id} ${player.name}`);
        return;
      } catch {
        // Didn't come back in time.
      }
    }
    // Taken over by a new connection: the player lives on under another id.
    if (!player || this.players[client.sessionId] !== player) return;
    // Keep their final state for when they come back (their device may not have the last of it).
    const [plotKey, plot] = this.plotOf(player);
    rememberDeparture(player.profileId, saveToken(player, plot, plotKey), player.xp > 0);
    delete this.players[client.sessionId];
    recordOnline(Object.keys(this.players).length);
    console.log(`left ${client.sessionId} ${player.name}`);
    // The plot is in their save too, and comes back with them either way.
    this.holdPlot(player);
    // Quests that need a neighbor are impossible if the last neighbor just left.
    for (const other of Object.values(this.players)) {
      if (dropImpossible(other, this.othersPresent(other))) {
        topUp(other, false);
        this.sendMe(other);
      }
    }
    this.markDirty();
  }

  // ---------- helpers ----------

  // A leaky bucket per player, so a misbehaving client can't flood the room.
  withinBudget(player) {
    const now = Date.now();
    player.budget = Math.min(MESSAGES.burst, player.budget + ((now - player.budgetAt) / 1000) * MESSAGES.perSecond);
    player.budgetAt = now;
    if (player.budget < 1) return false;
    player.budget -= 1;
    return true;
  }

  clientOf(player) {
    return this.clients.getById(player.id);
  }

  othersPresent(player) {
    return Object.values(this.plots).some((plot) => plot.ownerId !== player.id && this.players[plot.ownerId]);
  }

  markDirty() {
    this.dirty = true;
  }

  announce(text, kind) {
    this.broadcast('announce', { text, kind });
  }

  // `synced`: the client asked with 'sync', so it's listening for everything,
  // including notices and its save.
  sendWorld(player, client, synced = false) {
    client.send('init', this.snapshot());
    client.send('chatLog', this.chatLog);
    this.sendMe(player);
    if (!synced) return;
    player.synced = true;
    for (const notice of player.notices) client.send('notice', notice);
    player.notices = [];
    this.sendSave(player);
  }

  sendMe(player) {
    const { currency, xp, level, collection, shinies, inventory, quests, dailyQuest, stats, titles, title, colors, nameColor, rows } = player;
    const streak = player.daily.streak;
    const itchShare = this.itch.share(player.profileId);
    this.clientOf(player)?.send('me', {
      profileId: player.profileId,
      currency, xp, level, collection, shinies, inventory, quests, dailyQuest, stats, titles, title, colors, nameColor, rows, streak, itchShare,
    });
    player.saveDirty = true;
  }

  plotOf(player) {
    return Object.entries(this.plots).find(([, plot]) => plot.ownerId === player.id) ?? [null, null];
  }

  sendSave(player) {
    const client = this.clientOf(player);
    if (!client) return;
    const [key, plot] = this.plotOf(player);
    client.send('save', { token: saveToken(player, plot, key) });
    player.saveDirty = false;
    player.lastSaveAt = Date.now();
  }

  // Count something toward lifetime stats (and the titles they earn).
  bump(player, stat, amount = 1) {
    player.stats[stat] += amount;
    this.checkTitles(player);
  }

  checkTitles(player) {
    const album = Object.keys(player.collection).length;
    for (const title of TITLES) {
      if (player.titles.includes(title.id)) continue;
      if (titleProgress(title, player.stats, album, player.daily.streak) < title.count) continue;
      player.titles.push(title.id);
      player.title ??= title.id;  // the first one earned goes on straight away
      // Before the client is listening (joining), it waits with the other notices.
      if (player.synced) this.clientOf(player)?.send('titleEarned', { id: title.id });
      else player.notices.push({ kind: 'title', id: title.id });
      this.announce(`${player.name} earned the title ${title.name}.`, 'title');
      player.saveDirty = true;
      this.markDirty();
    }
  }

  // Growing the last character of a rarity completes that row of the album, paid once.
  checkRows(player) {
    for (const rarity of RARITY_ORDER) {
      if (player.rows.includes(rarity) || !rowComplete(rarity, player.collection)) continue;
      player.rows.push(rarity);
      const reward = ALBUM_ROWS[rarity];
      player.currency += reward.scraps;
      player.inventory.boil += reward.boil;
      const notice = { kind: 'row', rarity, ...reward };
      if (player.synced) this.clientOf(player)?.send('notice', notice);
      else player.notices.push(notice);
      this.announce(`${player.name} completed the ${RARITIES[rarity].label} row of the album!`, rarity);
      this.grantXp(player, reward.xp);
      player.saveDirty = true;
    }
  }

  grantXp(player, amount) {
    const before = player.level;
    player.xp += amount;
    player.level = levelFor(player.xp);
    if (player.level > before) {
      if (player.synced) this.clientOf(player)?.send('levelUp', { level: player.level });
      else player.notices.push({ kind: 'levelUp', level: player.level, from: before });
      if (player.level % ANNOUNCE_LEVELS === 0) this.announce(`${player.name} reached level ${player.level}!`, 'level');
      this.markDirty();
    }
  }

  progress(player, kind, amount = 1) {
    const done = advance(player, kind, amount);
    for (const quest of done) {
      player.currency += quest.scraps;
      this.clientOf(player)?.send('questDone', { text: quest.text, scraps: quest.scraps, xp: quest.xp });
      this.grantXp(player, quest.xp);
    }
    if (done.length) topUp(player, this.othersPresent(player));
    if (advanceDaily(player, kind, amount)) {
      const { scraps, xp, boil } = DAILY_QUEST.reward;
      const { kind: dailyKind, target } = player.dailyQuest;
      player.currency += scraps;
      player.inventory.boil += boil;
      this.clientOf(player)?.send('questDone', { daily: true, text: QUEST_KINDS[dailyKind].text(target), scraps, xp, boil });
      this.grantXp(player, xp);
    }
    const helpers = this.itch.progress(player, kind, amount);
    if (helpers) this.rewardItch(helpers);
  }

  // Everyone still here who helped scratch The Itch gets the same reward.
  rewardItch(helpers) {
    const { scraps, xp, boil } = ITCH.reward;
    const paid = Object.values(this.players).filter((p) => helpers.get(p.profileId));
    this.announce(`Scratched! ${paid.length === 1 ? 'One player' : `${paid.length} players`} scratched The Itch.`, 'itch');
    for (const helper of paid) {
      const reward = { share: helpers.get(helper.profileId), helpers: paid.length, scraps, xp, boil };
      helper.currency += scraps;
      helper.inventory.boil += boil;
      if (helper.synced) this.clientOf(helper)?.send('itchScratched', reward);
      else helper.notices.push({ kind: 'itch', ...reward });
      this.grantXp(helper, xp);
      this.bump(helper, 'itches');
      this.sendMe(helper);
    }
  }

  slotCenter(plotKey, slot) {
    const [px, py] = plotKey.split(',').map(Number);
    const plotPx = PLOT_SIZE * TILE_SIZE;
    return {
      x: px * plotPx + (slot % PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2,
      y: py * plotPx + Math.floor(slot / PLOT_SIZE) * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  plotAt(plotKey, slot) {
    const plot = typeof plotKey === 'string' && Object.hasOwn(this.plots, plotKey) ? this.plots[plotKey] : null;
    if (!plot || !Number.isInteger(slot) || slot < 0 || slot >= plot.slots.length) return null;
    return plot;
  }

  // ---------- handlers ----------

  handleMove(player, { x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const toX = Math.min(WORLD_PX, Math.max(0, x));
    const toY = Math.min(WORLD_PX, Math.max(0, y));
    player.arrivesAt = Date.now() + travelMs(Math.hypot(toX - player.x, toY - player.y));
    player.x = toX;
    player.y = toY;
    this.markDirty();
  }

  // Still walking over? Then you can't grab, squeeze or hit anything there yet.
  arrived(player) {
    return Date.now() >= player.arrivesAt - ARRIVAL_SLACK_MS;
  }

  handleClaimPlot(player, { plotX, plotY }) {
    if (!Number.isInteger(plotX) || !Number.isInteger(plotY)) return;
    if (plotX < 0 || plotY < 0 || plotX >= WORLD_WIDTH_PLOTS || plotY >= WORLD_HEIGHT_PLOTS) return;
    const key = `${plotX},${plotY}`;
    if (this.plots[key]) return;
    if (Object.values(this.plots).some((p) => p.ownerId === player.id)) return; // one plot per player

    this.plots[key] = {
      ownerId: player.id,
      ownerName: player.name,
      slots: Array.from({ length: PLOT_SIZE * PLOT_SIZE }, () => null),
    };
    player.saveDirty = true;
    this.markDirty();
  }

  handlePlant(player, { plotKey, slot, seed = 'pimple' }) {
    const plot = this.plotAt(plotKey, slot);
    const seedDef = typeof seed === 'string' && Object.hasOwn(SEED_BY_ID, seed) ? SEED_BY_ID[seed] : null;
    if (!plot || !seedDef || plot.ownerId !== player.id || plot.slots[slot]) return;
    if (!holeOpen(slot, player.level) || player.level < seedDef.level) return;
    if (seedDef.dropOnly) {
      if (!(player.inventory[seed] > 0)) return;
      player.inventory[seed] -= 1;
    } else {
      if (player.currency < seedDef.cost) return;
      player.currency -= seedDef.cost;
    }

    // Rolled at planting so the grow time can depend on rarity; clients see a
    // silhouette of it while it grows.
    const character = rollCharacter(seedDef, Boolean(this.bloodMoon), featuredFor(dayOf(Date.now())));
    const bonus = wearBonus(player.avatar, player.collection[player.avatar]);
    // A dose of fertilizer, if there's one left, goes into this crop.
    const fertilized = player.inventory.fertilizer > 0 ? 1 - FERTILIZER_SPEEDUP : 1;
    if (fertilized < 1) player.inventory.fertilizer -= 1;
    const now = Date.now();
    let growMs = RARITIES[character.rarity].growMs * GROW_SCALE * (1 - bonus.grow) * (1 - greenThumb(player.level)) * fertilized;
    if (player.level === 1 && player.stats.harvests === 0) growMs = Math.min(growMs, FIRST_CROPS_MS * GROW_SCALE);
    plot.slots[slot] = {
      characterId: character.id,
      seed,
      plantedAt: now,
      readyAt: now + growMs,
      shiny: Math.random() < SHINY_CHANCE * SHINY_BOOST * bonus.shiny * (this.bloodMoon ? 2 : 1),
      tendedBy: [],
    };
    this.grantXp(player, XP.plant);
    this.progress(player, 'plant');
    this.sendMe(player);
    this.markDirty();
  }

  handleHarvest(player, { plotKey, slot }) {
    const plot = this.plotAt(plotKey, slot);
    if (!plot || plot.ownerId !== player.id) return;
    const planted = plot.slots[slot];
    if (!planted || Date.now() < planted.readyAt) return;

    const { characterId, shiny } = planted;
    const character = CHARACTER_BY_ID[characterId];
    const rarity = RARITIES[character.rarity];
    const isNew = !player.collection[characterId];
    const before = player.collection[characterId] ?? 0;
    player.collection[characterId] = before + 1;
    const stars = starsFor(before + 1);
    // Whoever you're playing as when you pick it decides the bonus.
    const bonus = wearBonus(player.avatar, player.collection[player.avatar]);
    const scraps = Math.round(rarity.scraps * (shiny ? SHINY_SCRAPS : 1) * (1 + bonus.scraps));
    if (shiny) player.shinies[characterId] = (player.shinies[characterId] ?? 0) + 1;
    player.currency += scraps;
    plot.slots[slot] = null;
    // In season, a harvest can drop the season's token (rarer ones more often).
    const season = seasonOn(today());
    const teeth = season && (shiny || Math.random() < season.drop[character.rarity]) ? 1 : 0;
    player.inventory.teeth += teeth;

    const xp = XP.harvest[character.rarity];
    this.clientOf(player)?.send('harvested', {
      characterId,
      scraps,
      xp,
      isNew,
      shiny: Boolean(shiny),
      starUp: stars > starsFor(before) ? stars : 0,
      teeth,
    });
    if (teeth) this.bump(player, 'teeth', teeth);
    this.bump(player, 'harvests');
    if (shiny) this.bump(player, 'shinies');
    if (shiny) this.announce(`${player.name} grew a shiny ${character.name}!`, 'shiny');
    else if (rank(characterId) >= 2) this.announce(`${player.name} grew a ${rarity.label} ${character.name}!`, character.rarity);
    this.grantXp(player, xp);
    this.progress(player, 'harvest');
    if (rank(characterId) >= 1) this.progress(player, 'uncommon');
    if (rank(characterId) >= 2) this.progress(player, 'rare');
    if (isNew) this.progress(player, 'discover');
    if (isNew) this.checkRows(player);
    this.sendMe(player);
    this.markDirty();
  }

  // Squeezing a neighbor's growing crop speeds it up; the squeezer gets a few scraps.
  handleTend(player, { plotKey, slot }) {
    const plot = this.plotAt(plotKey, slot);
    if (!plot || plot.ownerId === player.id) return;
    const crop = plot.slots[slot];
    const now = Date.now();
    if (!crop || now >= crop.readyAt) return;
    // Squeezers are remembered by save (its public id, as everyone sees these), not
    // connection, so leaving and coming back doesn't reset it.
    if (crop.tendedBy.includes(player.pid) || crop.tendedBy.length >= TEND_MAX) return;
    const at = this.slotCenter(plotKey, slot);
    if (Math.hypot(player.x - at.x, player.y - at.y) > REACH || !this.arrived(player)) return;

    crop.readyAt -= (crop.readyAt - now) * TEND_SHARE;
    crop.tendedBy.push(player.pid);
    if (plot.away) plot.squeezedAway += 1;
    player.currency += TEND_SCRAPS;
    this.broadcast('tend', { plotKey, slot, by: player.id });
    const owner = this.players[plot.ownerId];
    if (owner) {
      this.clientOf(owner)?.send('tended', { by: player.name, characterId: crop.characterId });
      owner.saveDirty = true;
    }
    this.clientOf(player)?.send('tendDone', { scraps: TEND_SCRAPS, xp: XP.tend, owner: plot.ownerName });
    this.grantXp(player, XP.tend);
    this.progress(player, 'tend');
    this.bump(player, 'squeezes');
    this.sendMe(player);
    this.markDirty();
  }

  handleSetAvatar(player, { characterId }) {
    if (typeof characterId !== 'string' || !Object.hasOwn(player.collection, characterId)) return;
    if (player.avatar === characterId) return;
    player.avatar = characterId;
    this.progress(player, 'wear');
    this.sendMe(player);
    this.markDirty();
  }

  handleChat(player, { text }) {
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_COOLDOWN_MS) return;
    if (typeof text !== 'string') return;
    const clean = maskText(plainText(text, CHAT_MAX));
    if (!clean) return;
    player.lastChatAt = now;
    const line = { id: player.id, name: player.name, text: clean, at: now };
    this.chatLog.push(line);
    if (this.chatLog.length > CHAT_LOG) this.chatLog.shift();
    this.broadcast('chat', line);
    this.progress(player, 'chat');
    this.bump(player, 'chats');
    this.sendMe(player);
  }

  handleEmote(player, { emote }) {
    const now = Date.now();
    if (typeof emote !== 'string' || !Object.hasOwn(EMOTE_BY_ID, emote)) return;
    if (now - player.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    player.lastEmoteAt = now;
    this.broadcast('emote', { id: player.id, emote });
    this.progress(player, 'emote');
    this.sendMe(player);
  }

  handleHitBoss(player) {
    if (!this.arrived(player)) return;
    const damage = this.boss.hit(player, Date.now());
    if (!damage) return;
    this.grantXp(player, XP.bossHit * damage);
    this.progress(player, 'boss');
    this.sendMe(player);
  }

  // Give a spare copy of a character to another player who's here.
  handleGift(player, { to, characterId }) {
    const now = Date.now();
    const other = typeof to === 'string' && to !== player.id && Object.hasOwn(this.players, to) ? this.players[to] : null;
    if (!other || other.away || now - player.lastGiftAt < GIFT_COOLDOWN_MS) return;
    if (typeof characterId !== 'string' || !((player.collection[characterId] ?? 0) >= 2)) return;
    player.lastGiftAt = now;
    player.collection[characterId] -= 1;
    // A shiny can't be given away: keep no more shinies than copies.
    if (player.shinies[characterId] > player.collection[characterId]) player.shinies[characterId] = player.collection[characterId];
    const isNew = !other.collection[characterId];
    other.collection[characterId] = (other.collection[characterId] ?? 0) + 1;
    const name = CHARACTER_BY_ID[characterId].name;
    this.clientOf(other)?.send('gifted', { from: player.name, characterId, isNew });
    this.clientOf(player)?.send('gave', { to: other.name, characterId });
    this.announce(`${player.name} gave ${other.name} a ${name}.`, 'gift');
    if (isNew) this.progress(other, 'discover');
    if (isNew) this.checkRows(other);
    this.bump(player, 'gifts');
    this.checkTitles(other);
    this.sendMe(player);
    this.sendMe(other);
    this.markDirty();
  }

  handleBuy(player, { item, color }) {
    if (item === 'seasonColor') return this.buySeasonColor(player);
    const def = typeof item === 'string' && Object.hasOwn(SHOP, item) ? SHOP[item] : null;
    if (!def || player.currency < def.cost) return;
    if (item === 'fertilizer') {
      player.inventory.fertilizer += def.doses;
    } else if (item === 'candle') {
      const [, plot] = this.plotOf(player);
      if (!plot || (plot.candles ?? 0) >= def.max) return;
      plot.candles = (plot.candles ?? 0) + 1;
      this.markDirty();
    } else if (item === 'color') {
      if (!Object.hasOwn(NAME_COLORS, color) || SEASON_COLORS.has(color) || player.colors.includes(color)) return;
      player.colors.push(color);
      player.nameColor = color;
      this.markDirty();
    }
    player.currency -= def.cost;
    this.clientOf(player)?.send('bought', { item, color });
    this.sendMe(player);
  }

  // The season's name color, paid for in its token, only while it's on.
  buySeasonColor(player) {
    const season = seasonOn(today());
    if (!season) return;
    const { id, cost } = season.color;
    if (player.colors.includes(id) || player.inventory.teeth < cost) return;
    player.inventory.teeth -= cost;
    player.colors.push(id);
    player.nameColor = id;
    this.clientOf(player)?.send('bought', { item: 'color', color: id });
    this.sendMe(player);
    this.markDirty();
  }

  handleSetColor(player, { color }) {
    if (color !== null && !player.colors.includes(color)) return;
    player.nameColor = color;
    this.sendMe(player);
    this.markDirty();
  }

  handleSetTitle(player, { id }) {
    if (id !== null && !player.titles.includes(id)) return;
    player.title = id;
    this.sendMe(player);
    this.markDirty();
  }

  handleGrab(player, { id }) {
    if (!Number.isInteger(id) || !this.arrived(player)) return;
    const scraps = this.rain.grab(player, id);
    if (!scraps) return;
    player.currency += scraps;
    this.clientOf(player)?.send('gotGlob', { scraps, gold: scraps > 2 });
    this.grantXp(player, XP.grab);
    this.progress(player, 'grab');
    this.bump(player, 'globs');
    this.sendMe(player);
  }

  rewardBoss(player, reward) {
    if (reward.top) this.bump(player, 'bossTops');
    player.currency += reward.scraps;
    player.inventory.boil += reward.seeds;
    this.clientOf(player)?.send('bossReward', reward);
    this.grantXp(player, reward.xp);
    this.sendMe(player);
  }

  // ---------- time ----------

  tick() {
    const now = Date.now();
    for (const [profileId, key] of this.heldPlots) {
      const plot = this.plots[key];
      if (!plot?.away || now - plot.leftAt > PLOT_HOLD_MS) this.dropHeldPlot(profileId);
    }
    this.boss.tick(now);
    this.rain.tick(now);
    this.itch.tick(now);
    if (!this.bloodMoon && now >= this.nextBloodMoon) {
      this.bloodMoon = { endsAt: now + BLOOD_MOON.lastsMs * EVENT_SCALE };
      this.announce('Blood Moon! Rare characters are sprouting everywhere.', 'bloodMoon');
      this.markDirty();
    } else if (this.bloodMoon && now >= this.bloodMoon.endsAt) {
      this.bloodMoon = null;
      this.nextBloodMoon = now + BLOOD_MOON.everyMs * EVENT_SCALE;
      this.announce('The Blood Moon sets.', 'bloodMoon');
      this.markDirty();
    }
  }

  flush() {
    const now = Date.now();
    for (const player of Object.values(this.players)) {
      if (player.saveDirty && !player.away && now - player.lastSaveAt >= SAVE_MS) this.sendSave(player);
    }
    const hp = this.boss.takeHpUpdate();
    if (hp) this.broadcast('bossHp', hp);
    if (!this.dirty) return;
    this.dirty = false;
    // Plots (every crop of everyone, held ones too) are most of the state and
    // change far less often than people walk about: they go out only when changed.
    const state = this.snapshot();
    const plots = JSON.stringify(this.plots);
    if (plots === this.sentPlots) delete state.plots;
    else this.sentPlots = plots;
    this.broadcast('state', state);
  }

  // Everything about the world and who's in it, for the admin page only.
  adminView() {
    const now = Date.now();
    const players = Object.values(this.players).map((p) => {
      const [key, plot] = this.plotOf(p);
      const crops = plot?.slots.filter(Boolean) ?? [];
      return {
        profileId: p.profileId,
        pid: p.pid,
        name: p.name,
        status: p.away ? 'away' : 'online',
        since: p.joinedAt,
        level: p.level,
        xp: p.xp,
        scraps: p.currency,
        avatar: p.avatar,
        collection: p.collection,
        shinies: p.shinies,
        inventory: p.inventory,
        stats: p.stats,
        titles: p.titles,
        title: p.title,
        nameColor: p.nameColor,
        rows: p.rows,
        streak: p.daily.streak,
        quests: p.quests.map(({ kind, target, progress }) => ({ kind, target, progress })),
        dailyQuest: p.dailyQuest,
        plot: key && { key, ripe: crops.filter((c) => c.readyAt <= now).length, growing: crops.filter((c) => c.readyAt > now).length, candles: plot.candles ?? 0 },
      };
    });
    return {
      players,
      heldPlots: [...this.heldPlots.entries()].map(([profileId, key]) => {
        const plot = this.plots[key];
        return { profileId, key, owner: plot?.ownerName, leftAt: plot?.leftAt, crops: plot?.slots.filter(Boolean).length ?? 0, squeezed: plot?.squeezedAway ?? 0 };
      }),
      events: {
        boss: this.boss.view(),
        itch: this.itch.view(),
        bloodMoon: this.bloodMoon,
        rain: this.rain.view(),
        season: this.seasonView(),
        featured: featuredFor(dayOf(now)),
      },
      chat: this.chatLog.map(({ name, text, at }) => ({ name, text, at })),
    };
  }

  seasonView() {
    const season = seasonOn(today());
    return season && { id: season.id, name: season.name, ends: season.ends };
  }

  snapshot() {
    const players = {};
    for (const p of Object.values(this.players)) {
      const album = Object.keys(p.collection);
      const best = album.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      players[p.id] = {
        id: p.id,
        pid: p.pid,
        name: p.name,
        x: p.x,
        y: p.y,
        avatar: p.avatar,
        // Playing as a character shows off its stars, and its gold sheen if you've grown a shiny one.
        stars: starsFor(p.collection[p.avatar] ?? 0),
        shiny: Boolean(p.shinies[p.avatar]),
        level: p.level,
        album: album.length,
        shinies: Object.keys(p.shinies).length,
        title: TITLE_BY_ID[p.title]?.name ?? null,
        color: NAME_COLORS[p.nameColor] ?? null,
        best,
        away: p.away,
      };
    }
    // serverNow lets clients correct for their own clock being off when showing grow progress.
    return {
      players,
      plots: this.plots,
      boss: this.boss.view(),
      bloodMoon: this.bloodMoon,
      rain: this.rain.view(),
      itch: this.itch.view(),
      featured: featuredFor(dayOf(Date.now())),
      season: this.seasonView(),
      drops: this.rain.drops(),
      serverNow: Date.now(),
    };
  }
}
