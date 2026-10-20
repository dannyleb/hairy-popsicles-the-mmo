# Hairy Popsicles: The MMO

A spin-off of [Hairy Popsicles](https://github.com/dannyleb/hairy-popsicles-the-game),
same gross, flesh-toned universe — but lightweight, mobile-web, and shared:
everyone tends their own patch in one persistent world and can see everyone
else's.

**Play:** https://dannyleb.github.io/hairy-popsicles-the-mmo/ ·
**Server:** https://hairy-popsicles-mmo-server.onrender.com
([/stats](https://hairy-popsicles-mmo-server.onrender.com/stats)) ·
**Tests:** `npm test`, and on every push in GitHub Actions.

## What it is (v1 target)

Not a true massive-scale MMO — that's not a realistic solo-dev scope. It's
the **.io-game pattern** (Agar.io / MooMoo.io): one shared real-time room,
dozens of concurrent players, instant play, no install, no login wall. Feels
like an MMO, ships like a small game.

**Core loop:** walk around a shared world → claim an empty plot → pick a
seed and plant it in one of your plot's holes → it grows into a random
character, a dark silhouette rising out of the hole until it ripens in full
color → pull it out into your album (plus scraps and XP) → play as any
character you've grown. Rarer characters take longer and pay more.

| Rarity | Characters | Grow time | Scraps | XP |
|---|---|---|---|---|
| Common | 8 | 30s | 7 | 10 |
| Uncommon | 7 | 1.5 min | 14 | 22 |
| Rare | 7 | 4 min | 35 | 50 |
| Legendary | 3 | 8 min | 90 | 120 |

| Seed | Cost | Unlocks | Common / Uncommon / Rare / Legendary |
|---|---|---|---|
| Pimple | 5 | level 1 | 55 / 28 / 13 / 4 % |
| Pus | 15 | level 3 | 20 / 50 / 24 / 6 % |
| Bone | 40 | level 6 | 0 / 35 / 50 / 15 % |
| Boil | drop only | from The Boil | 0 / 0 / 70 / 30 % |

Timers are short on purpose while nothing persists. Rarities live in
`packages/shared/src/characters.js`; seeds, levels and XP in
`packages/shared/src/progression.js`; quests in `quests.js`.

**The MMO layer:**

- **Levels (1-15).** XP from planting, harvesting, squeezing, quests and the
  boss. Your plot starts with 3 open holes; each level opens another
  (scabs cover the locked ones and pop off when they open), and better seeds
  unlock at levels 3 and 6. Past level 7, when every hole is open, each
  level makes your crops grow 3% faster (24% at level 15). Every 5th level
  is announced to the world.
- **Quests.** Three at a time, dealt from ten kinds (harvest, rarity,
  plant, discover something new, squeeze a neighbor, chat, emote, hit the
  boss, change character). Finishing one pays scraps and XP and deals the
  next. Squeeze quests only show up while there's a neighbor to squeeze.
  On top of those, one bigger daily quest (pinned in gold) pays 60 scraps,
  120 XP and a Boil Seed.
- **Squeezing.** Tap a neighbor's growing crop: it ripens 25% sooner and
  you get 3 scraps. Up to 3 different people per crop. Squeezable crops
  glow green. This is the main reason to care that other people exist.
- **The Boil (world boss).** Every 4 minutes a giant boil swells up near
  someone. Everyone taps it; it gets redder and fatter until it bursts.
  Everyone who hit it gets scraps and XP; anyone with 3+ hits gets a Boil
  Seed (the top squeezer gets 2), which only grows Rare or Legendary.
  It sinks back after 2.5 minutes if nobody pops it.
- **Pus Rain (event).** Every 5 minutes, for 45 seconds, globs of pus rain
  down around everyone online; tap one to run over and grab it (2 scraps, or
  10 for a rare gold one). Walking takes time (the same on every screen and
  on the server) and grabbing only counts once you're there, so whoever is
  nearest wins the race. The same rule applies to squeezing and to The Boil.
- **Blood Moon (event).** Every 9 minutes, for 90 seconds, the world goes
  red and every seed's Rare odds are x2.5 and Legendary x3.
- **Social.** Chat (log over the dock, bubbles over heads), six emotes, a
  "who's here" leaderboard ranked by album size, tap anyone to see their
  card (level, album, best character) and walk over, wave, or mute them.
  Rare and Legendary pulls, boss pops and milestones are announced to all.
  Give a spare copy of a character (you keep at least one) to anyone who's
  here, from their card: they get a "Gift!" reveal and everyone sees it
  (10 gifts earns the Generous title).
- **Hooks.** Full-screen reveal for every new character and every Rare+
  pull, a level-up splash listing what just unlocked, floating rewards,
  a first-session coach (claim → plant → wait → harvest → album), an album
  with silhouettes of everyone you haven't found, a minimap you can tap to
  travel, and an arrow to the boss when it's off screen.
- **Phones.** If the app goes to the background and the socket drops, the
  server holds your player and plot for 90 seconds and the client
  reconnects into the same seat.
- **Saves.** Your level, album, scraps, quests, streak and plot (with its
  crops) are saved on your device, signed by the server so they can't be
  edited. Come back and your plot reappears where it was (or as close as
  is free), and the crops kept growing while you were gone: "Welcome back,
  4 crops are ripe and waiting." Reloading or opening a second tab takes
  over your existing player rather than making a copy. To move to another
  phone, copy the save code from Settings → Move to another phone and paste
  it into Menu → Load a save on the new one.
- **Shinies and stars.** About 1 crop in 40 comes up shiny (1 in 20 under a
  Blood Moon): the same character with a gold outline that everyone can see
  once it's ripe, triple scraps, its own reveal and a world announcement.
  Play as a character you have a shiny of and you wear the gold. Growing 3,
  10 and 25 copies of a character earns it stars, shown in the album and
  next to your level while you play as it.
- **Wear bonuses.** Who you play as matters: an Uncommon gives +10% scraps
  from harvests, a Rare also makes your crops grow 10% faster, a Legendary
  gives +20% scraps, 15% faster growth and double shiny luck, and every
  star adds another +5% scraps. Shown on album cards, on reveals, and when
  you switch.
- **Titles.** Eleven lifetime goals (harvest 25 and 150, squeeze 20, top The
  Boil 3 times, grab 50 globs, grow 3 shinies, chat 50 times, give 10 gifts,
  a 7-day streak, 15 characters, all of them) each earn a title, announced to the
  world. Wear one under your name; tap your card (top left) to see them all
  with progress and switch.
- **Shop.** Somewhere to spend scraps besides seeds (tap your card, then
  Shop): fertilizer (3 doses for 30; each makes a crop grow twice as fast),
  candles for the corners of your plot (50 each, up to 4, seen by
  everyone), and name colors (150 each).
- **Daily gift.** The first visit each day (UTC) pays a reward on a 7-day
  track: scraps, with Boil Seeds on days 3, 6 and 7. Miss a day and the
  streak starts over.

**The world:** like the first game, the world is skin — here a dark, wet,
candlelit expanse of it seen from above, lit like the character renders.
Plots are raw sores with a 3x3 grid of follicle holes the characters grow out
of. Candles flicker at plot corners, pus-flies drift in loops, spores float
past, hairs, pimples, moles and slime puddles are scattered about, and the
camera follows you. Characters on screen mutter their lines from the first
game's `src/roster.js` (characters without lines fall back to its grunts).

**Flow:** an HTML loading screen (shows before the JavaScript arrives) → a
title menu over the drifting world (name, Play, How to play, Settings,
Credits) → connecting (with a "waking the server" message after a few
seconds, and a retry) → the world.

**Phone niceties:** a short buzz with harvests, hits, squeezes, grabs and
level-ups (Android; iPhones don't allow it), and from the second visit, a
one-time hint to add the game to the home screen (Chrome's install prompt,
or the Share → Add to Home Screen steps on iPhone).

**Sound:** the first game's two music tracks, alternating, plus procedural
Web Audio effects (no files) for steps, planting, harvests by rarity,
squeezing, boss hits and bursts, quests, level-ups and chat. Sound, music,
vibration and speech bubbles can each be turned off in Settings (remembered
per device).

## Decisions locked in so far

- **Platform:** mobile web / PWA only for v1. No App Store / Play Store
  wrapper, no review process, no install friction — open a link and play.
- **Monetization:** none yet. Get the loop hooky first.
- **Art:** photoreal 3D-rendered characters (heads and creatures), cut out
  of their backgrounds and used as-is — not flattened into the first game's
  ink style.
- **Characters are the crop:** seeds ripen into characters on your plot,
  rarer ones take longer; you collect them, and can play as any one you've
  grown. New players start with one random common.

## Character art

The renders are 3D versions of the first game's hand-drawn cast, so a
character's slug is its `id` in that game's `src/roster.js` (`snoot`,
`mirror`, ...); `-2`, `-3` are alternate renders of the same character.
Characters with no drawn original keep working names (`spoon-nana`,
`bat-rat`, `head-bloom`).

Full-size renders stay on Danny's machine; only game sprites are committed:
`packages/client/public/characters/<slug>.webp` (768px long edge,
transparent, ~40-180KB) is the master, and `characters/small/<slug>.webp`
(256px square, character standing on the bottom edge, ~10-30KB) is what the
game loads. To add a batch:

```
pip install -r tools/requirements.txt          # once; model (~180MB) downloads on first run
python tools/cutout.py render.png slug [render2.png slug2 ...]
python tools/cutout.py --small                 # rebuild every small copy from the masters
```

A new character also needs an entry in `packages/shared/src/characters.js`.

Background removal is an ML matting model (rembg `isnet-general-use`). It
handles hair, wings and see-through drips well on the game's dark
background; stray hairs keep a slight dark fringe that would show on a pale
background. If it keeps a piece of scenery, add an erase box for that slug to
`ERASE` in `tools/cutout.py`.

## World art

Placeholder, generated procedurally by `tools/world.py` into
`packages/client/public/world/`: a seamless 1024px wet-skin ground tile,
three plot-sore variants, pimples, a pustule, moles, hairs, slime and pus
puddles, a candle, its flame, soft glow/spore sprites, and for the MMO layer
The Boil, the scab over locked holes, goo droplets and the four seed icons.
Each is a height map + color + gloss shaded with one warm key light from the
upper left, so it sits with the renders. Deterministic; rerun with
`python tools/world.py` after changing it (`python tools/world.py ground` for
just the ground, `events` for the MMO-layer art). The plot art's hole
positions must match `HOLE_OFFSET` in `packages/client/src/world/layout.js`.
Swap any file for real art with the same name and size and nothing else
changes.

App icons (favicon, home screen, PWA) come from a character render:
`python tools/icons.py [slug]` (default `snoot`).

Fonts (Rubik Wet Paint, Patrick Hand — same as the first game) are
self-hosted in `packages/client/public/fonts/` under the SIL Open Font License.

## Repo layout

Npm workspaces monorepo:

```
packages/
  shared/   characters, rarities, seeds, levels, quests, chat/emote rules: imported by client and server
  server/   Colyseus room: authoritative state, lives on a Node host
    src/rooms/WorldRoom.js   players, plots, planting, harvesting, squeezing, chat, gifts, events
    src/game/                saves, daily streak, quests, The Boil, Pus Rain, rolls, chat filter
  client/   Phaser 3 + Vite: the actual game, runs in the browser
    src/scenes/   Boot (loads assets) → Menu → World
    src/world/    backdrop, The Boil, effects, layout constants
    src/ui/       HTML overlays: loading, menu, HUD, chat, album, sheets, reveals, minimap, coach
    src/audio/    procedural sound effects (and vibration), music
tests/      server test suites and their runner
```

## Running it locally

```
npm install
npm run dev:server   # starts the Colyseus room on ws://localhost:2567
npm run dev:client   # starts Vite on http://localhost:5173
```

Open the client URL on your phone (same network) or in a desktop browser
with devtools in mobile emulation. To test without waiting, speed things up:
`GROW_SCALE=0.05` makes every grow timer 20x faster, `EVENT_SCALE=0.2` makes
The Boil, the Blood Moon and the Pus Rain come (and go) 5x sooner, e.g.
`GROW_SCALE=0.05 EVENT_SCALE=0.2 npm run dev:server`. `SHINY_BOOST=40`
makes every crop shiny.

## Testing

```
npm test                 # every server suite (a few minutes)
npm test -- saves gifts  # just those
```

`tests/run.mjs` starts fresh game servers for each suite (timers sped up
with `GROW_SCALE`/`EVENT_SCALE`, `PROFILE_SECRET=test`) and drives them
with real Colyseus clients. Suites: `game` (planting, levels, quests,
chat, squeezing, The Boil, Blood Moon), `levels` (high-level growth),
`shop`, `integrity` (old saves, squeezes and boss damage across reloads),
`reconnect`, `saves` (signing,
restore, takeover, daily streak and quest), `shinies` (plus stars and wear
bonuses), `rain`, `titles`, `gifts`, `hardening` (filter, rate limits) and
`filter`. GitHub Actions runs them on every push and pull request
(`.github/workflows/test.yml`).

## What's stubbed / not real yet

- **Saves live on the device, not on the server.** That needed no database,
  and progress survives the free server sleeping and restarting. The
  catches: progress only moves to another phone or browser by copying the
  save code across by hand, clearing site data loses it, and you only see other players' plots while they're
  online. The server remembers each departed player's latest state for 3
  days (in memory), so an older save sent back is replaced by the newer one,
  but after a server restart a player could restore an older save of their
  own. The fix for all four is server-side storage plus an
  account; the save format (`packages/server/src/game/profile.js`) is what
  would move there.
- **The save secret.** Saves are signed with `PROFILE_SECRET`. `render.yaml`
  generates one; if it changes or is missing, every save stops loading (the
  server logs a warning when it's missing).
- **One room, no sharding.** Everyone joins the same `world` room (200
  max). Fine until it gets crowded; then it needs zones or shards.
- **State sync is a blunt instrument.** The server broadcasts the whole
  public world state at most 10 times a second when something changes.
  Fine at small scale; swap in `@colyseus/schema` delta encoding before it
  matters.
- **Light moderation only:** a word filter masks slurs and the worst sexual
  terms in chat and turns offending names into Guest names
  (`packages/server/src/game/filter.js`), players can mute each other, and
  each player's messages are rate limited. No reporting or bans yet.
- **World art is procedural placeholder** (see "World art").

## Deploy

- **Server:** Render free web service, defined in `render.yaml`, live at
  `https://hairy-popsicles-mmo-server.onrender.com` (responds `ok`;
  `/stats` shows who's online now and players, joins and the peak today,
  since the last restart). The
  free tier sleeps after 15 min idle; the first visitor after that waits
  ~30-60s and the live world (who's online, The Boil) resets. Players'
  progress is in their saves and comes back with them. Needs the
  `PROFILE_SECRET` environment variable (see "What's stubbed").
- **Client:** GitHub Pages via `.github/workflows/pages.yml` on every push
  to `main`, served at `https://dannyleb.github.io/hairy-popsicles-the-mmo/`.
  Production builds point at the Render server via
  `packages/client/.env.production`.

## Next steps (roughly in order)

1. Real names for `spoon-nana`, `bat-rat` and `head-bloom`, and more
   characters (each new one deepens the album).
2. Server-side saves and accounts, so progress follows a player across
   devices and offline players' plots stay in the world for others to see
   and squeeze.
3. Real art for the world (ground, plots, props, The Boil).
