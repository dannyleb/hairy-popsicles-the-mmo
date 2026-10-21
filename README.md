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
  plant, discover something new, squeeze a neighbor, chat, emote, help at
  world events, change character). Finishing one pays scraps and XP and
  deals the next. Squeeze quests only show up while there's a neighbor to
  squeeze. On top of those, one bigger daily quest (pinned in gold) pays 60
  scraps, 120 XP and a Boil Seed. On a phone (700px wide or less) the quest
  list starts folded to one line ("Quests · 4", with a pulsing dot while The
  Itch is on); tapped open, it folds away again after 10 seconds.
- **Squeezing.** Tap a neighbor's growing crop: it ripens 25% sooner and
  you get 3 scraps. Up to 3 different people per crop. Squeezable crops
  glow green. This is the main reason to care that other people exist.
  When a player (level 2 or up) leaves, their plot stays in the world for
  24 hours if anything is growing in it (dimmed, marked "away"), so the world doesn't
  empty out and others can still squeeze it. It's theirs again when they
  come back, head start included: "Neighbors squeezed your crops 3 times
  while you were gone." The world room is never disposed, so this holds
  even when everyone has left.
- **World events.** One at a time, 4 minutes apart, taking turns: The Boil,
  The Scab, The Gash, The Tick (`packages/shared/src/worldEvents.js`; each
  is its own module in `packages/server/src/game/`, run by `worldEvents.js`).
  Each shows in the event pill (tap it to walk over), the minimap and an
  edge-of-screen arrow, and everything done at one counts for the "Help at
  world events" quests.
- **The Boil.** A giant boil swells up near someone. Everyone taps it; it
  gets redder and fatter until it bursts. Everyone who hit it gets scraps
  and XP; anyone with 3+ hits gets a Boil Seed (the top squeezer gets 2),
  which only grows Rare or Legendary. It sinks back after 2.5 minutes if
  nobody pops it.
- **The Scab.** A big crusty scab, wet at first and drying over 40 seconds.
  Hold a finger on it to peel a piece (a ring fills; keep holding for the
  next). Peeled dry, a piece pays 5 scraps; torn off early it pays 1 and
  bleeds three globs anyone can grab. Whoever peels the last of its ten
  pieces finds a character underneath (Uncommon or better), and everyone
  who peeled gets a bit more. Scab Picker title for 30 pieces.
- **The Gash.** A wound tears open with crumbs of crust along it (10, plus
  4 a player, up to 26). Tap one to pick it out. With two or more players
  around, every fifth is deep: one player's tap loosens it for 2.5 seconds
  and a second player's tap gets it out, paying both. Picked clean, it zips
  shut; everyone who picked gets paid, the top picker a Boil Seed. Wound
  Dresser title for 40 crumbs.
- **The Tick.** Latches on beside the plot with the most growing crops of
  anyone online, and the crops within reach stop growing while it feeds (red
  threads show which; their wait grows by however long it was on). Tap to
  pry: each pry counts once for every player who's pried in the last 2.5
  seconds, so a crowd gets it off fast. Pried off by one player while
  others were around, its head stays in and it's back in 90 seconds. If
  nobody gets it, it drops off full after 2 minutes. Tick Twister title
  for 5.
- **Pus Rain (event).** Every 5 minutes, for 45 seconds, globs of pus rain
  down around everyone online; tap one to run over and grab it (2 scraps, or
  10 for a rare gold one). Walking takes time (the same on every screen and
  on the server) and grabbing only counts once you're there, so whoever is
  nearest wins the race. The same rule applies to squeezing and to The Boil.
- **Blood Moon (event).** Every 9 minutes, for 90 seconds, the world goes
  red and every seed's Rare odds are x2.5 and Legendary x3.
- **The Itch (world goal).** Every 20 minutes or so the whole world itches:
  one shared target for everyone online ("Harvest 30 characters together"),
  sized by how many are on when it starts, with 12 minutes to hit it. It
  sits on top of the quest list with everyone's progress and your share.
  Everyone who helped gets 30 scraps, 60 XP and a Boil Seed; 5 scratches
  earn the Scratcher title.
- **Social.** Chat (log over the dock, bubbles over heads), six emotes, a
  "who's here" leaderboard ranked by album size, tap anyone to see their
  card (level, album, best character) and walk over, wave, or mute them.
  Rare and Legendary pulls, boss pops and milestones are announced to all.
  Give a spare copy of a character (you keep at least one) to anyone who's
  here, from their card: they get a "Gift!" reveal and everyone sees it
  (10 gifts earns the Generous title). Make anyone a pal ♥ from their card:
  pals get a heart by their name, and you're told when one arrives (or is
  already here when you do). Pals are kept on your device, keyed by a public
  id derived from the save (never the save id itself). Tap your own card,
  then Share my album, for a picture of who you play as, your level and
  title, and every character (silhouettes for the unfound) with the game's
  link: the phone's share sheet where it can take pictures, a download
  elsewhere.
- **Invites.** "Invite a friend" (on the who's-here screen) shares the
  player's own link (`?with=<invite code>`: their public id, signed by the
  server, so nobody can make up a link for someone else). The friend's title screen says who
  invited them and whether they're on now; a brand-new player who joins by it
  starts right next to the inviter, and both become pals. When the friend
  reaches level 3 both get 50 scraps and a Boil Seed (the inviter at most 3
  times a day, paid on their return if they're away; the count and the
  friends already paid for are kept in the inviter's own save, so a restart or
  a replayed old save doesn't pay twice), and 3 friends earn the Ringleader
  title. The title screen also shows how many are playing now; that
  request goes out the moment the page opens, so a napping free server starts
  waking while the menu is read.
- **First minute.** A new player's title screen says what the game is in one
  line. In the world, a welcome card shows their starter character and the
  loop (grow, collect, play as them), then they're given a plot of their own
  on the spot. A bouncing arrow points at exactly what to tap next (a hole,
  then the ripe crop) while one coach line explains it, and their first crops
  ripen in 8 seconds whatever they turn out to be. Until they've opened the
  album (or played as their new character), the screen keeps to the
  essentials: no quests, event pills, world banners or boss pointer, and the
  daily-gift calendar waits to arrive as a reward at the end. Someone
  bringing an existing save to a new device skips all of it.
- **Hooks.** Full-screen reveal for every new character and every Rare+
  pull, a level-up splash listing what just unlocked, floating rewards,
  a guided first minute (below), an album
  with silhouettes of everyone you haven't found (tap one you have for a
  close-up with its stars, bonus and copies to the next star, and to play
  as it), a minimap, and an arrow to the world event when it's off screen.
  Tap the minimap for the big map: every region and landmark by name, the
  statue's subject, your plot, everyone here, the world event and today's
  stray, with labels that keep out of each other's way. Tap anywhere on it
  to walk there.
- **Phones.** If the app goes to the background and the socket drops, the
  server holds your player and plot for 90 seconds and the client
  reconnects into the same seat. Pinch (or the mouse wheel) zooms the
  world out to see more or in to see detail, and it's remembered; taps act
  when the finger lifts, so a second finger turns one into a pinch.
  Graphics adapt to the device: the canvas is capped at about 3.6M pixels
  (phones keep full density; big high-density laptop screens draw slightly
  softer), frames are capped at 60 even on 120 Hz screens, and if frames still
  come slowly the game steps down by itself (lower resolution, then no
  ambient glows) and remembers it; Settings has "Try full graphics again". A
  browser drawing without the graphics card is detected and told how to fix
  it. Settings has sound, music, speech
  bubbles, vibration and Reduce motion (no screen shake or flashes, nothing
  pulsing forever), which starts on if the phone already asks for less
  motion.
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
  Play as a character you have a shiny of and you wear the gold, and leave
  a glinting trail as you walk (Rares leave a blue one, Legendaries gold). Growing 3,
  10 and 25 copies of a character earns it stars, shown in the album and
  next to your level while you play as it.
- **Album rows.** Grow every character of a rarity and that row of the
  album pays out once: Common 40 scraps, Uncommon 100 + a Boil Seed, Rare
  250 + 2, Legendary 600 + 3 (plus XP), with its own reveal and a world
  announcement. Album headings show each row's reward. Saves from before
  this get paid for rows they already finished.
- **The Rotting Season (limited event, Oct 20 to Nov 1 UTC).** While it's
  on, harvests drop teeth 🦷 (15% for a Common up to every Legendary or
  shiny). Teeth buy a Pumpkin name color sold only this season, and 31 earn
  the Trick or Treater title. A pill (top right) counts down the days and
  opens the shop's season corner; the world gets a faint orange-and-purple
  cast. Seasons are data (`packages/shared/src/season.js`): add another
  entry with dates, a token, a color and a title for the next one.
- **Featured character.** Each UTC day one character (picked from the date)
  sprouts 4x as often as the others of its rarity. The daily gift card and
  the album say who, or "a mystery Rare" if you've never grown it, and its
  album card gets a "Sprouting today" badge. A reason to look every day.
- **Strays.** Eight characters wander the world on their own (the server
  walks them; `packages/shared/src/strays.js`). One is always the day's
  featured character, glowing gold with a "Today's stray" label and a gold
  dot on the minimap: walk up and tap it to catch a copy for your album, once
  a day. Catching 7 earns the Dogcatcher title. The others hop and squeak
  when tapped, and one of them is swapped for someone new every 10 minutes.
- **Wear bonuses.** Who you play as matters: an Uncommon gives +10% scraps
  from harvests, a Rare also makes your crops grow 10% faster, a Legendary
  gives +20% scraps, 15% faster growth and double shiny luck, and every
  star adds another +5% scraps. Shown on album cards, on reveals, and when
  you switch.
- **Titles.** Eighteen goals (harvest 25 and 150, squeeze 20, top The
  Boil 3 times, grab 50 globs, grow 3 shinies, chat 50 times, give 10 gifts,
  scratch The Itch 5 times, bring 3 friends, catch 7 strays, peel 30 pieces
  of scab, pick 40 crumbs, pry 5 ticks, 31 teeth in the
  Rotting Season, a 7-day streak, 15 characters, all of them) each earn a title, announced to the
  world. Wear one under your name; tap your card (top left) to see them all
  with progress and switch.
- **Shop.** Somewhere to spend scraps besides seeds (the bag button, top
  right; also from your card and the season pill): fertilizer (3 doses for 30; each makes a crop grow twice as fast),
  candles for the corners of your plot (50 each, up to 4, seen by
  everyone), and name colors (150 each).
- **Daily gift.** The first visit each day (UTC) pays a reward on a 7-day
  track: scraps, with Boil Seeds on days 3, 6 and 7. Miss a day and the
  streak starts over. The title screen says what's waiting before you tap
  Continue: "Day 4 gift waiting", "2 crops ripe on your plot", today's
  featured character and any season, read from the save on the device.

**The world:** like the first game, the world is skin — here a dark, wet,
candlelit expanse of it seen from above, lit like the character renders.
Plots are raw sores with a 3x3 grid of follicle holes the characters grow out
of. Candles flicker at plot corners, pus-flies drift in loops, spores float
past, hairs, pimples, moles and slime puddles are scattered about, and the
camera follows you. It's alive between players too: the ground breathes,
hairs sway and get pushed aside as people walk through, everyone (strays
included) leaves a wet smear that dries off over half a minute, mites
trundle in loops and scatter from anyone near (tap one to squish it), fleas
sit and then spring away, and every 5 minutes a great pale worm crawls across
the world, in the same place on every screen. Players who are away nap beside
the plot the world is keeping for them, with a z drifting up now and then.
All of it is cheap (well under a millisecond a frame together), and trails
are off on the lite quality setting.

**Regions and landmarks** (`packages/shared/src/regions.js`): the Navel is
the middle of the world, and each quarter around it is its own place, with
its own cast of color and props: the Scalp (a forest of long hairs), the
Armpit (sweat pools, steaming), Freckle Flats and Wart Hills. Borders wander
so they don't look ruled; your region's name comes up as you walk into it,
and the minimap is shaded by region. Purple veins run under the skin from the
Navel out to each region and to the Eye. Three landmarks stand on blocks of
plots nobody can claim (a plot saved where one now stands comes back next to
it): the Navel (tap it: it gurgles), a giant Eye that watches whoever's
nearest and blinks (poke it and it screws itself shut), and a stone statue of
whoever has collected the most characters, with their name and count. The
server picks the statue from everyone in the database seen in the last 90
days at startup, then hands it over whenever someone passes the record.
Still ground decor is only drawn near the view (in 320px cells), which keeps
the scene cheaper to draw than before all this was added.

**Day, night and weather** (`packages/shared/src/sky.js`), from the clock
alone, so every screen agrees with no server traffic. A day lasts 20 minutes:
about 7 of daylight (a warm lift over the ground), 7 of night (a cool shade,
with candles and pus-flies glowing brighter), and a dusk and a dawn between.
A Blood Moon is always as dark as dusk. Every 6 minutes the weather may turn
(half the time it stays clear): dandruff drifting down, a sweaty fog, or an
itchy wind that streaks across the screen and swings the hairs round. It
fades in and out, and the chat log says when night falls, morning comes or
weather sets in. Reduce motion keeps the fog and slows the dandruff; the wind
streaks are left out.

**Ambience** (`packages/client/src/audio/ambience.js`): quiet procedural
sounds of wherever you are, under the music and off with Sound: the world's
heartbeat, louder the nearer you are to the Navel; gurgles in the Armpit;
hairs rustling in the Scalp; little things chirping at night; gusts while the
wind blows. Characters on screen mutter their lines from the first
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
The Boil, the scab over locked holes, goo droplets and the four seed icons,
the other world events (The Scab in ten peelable pieces over raw skin, The
Gash, its crumbs of crust, The Tick; `python tools/world.py gross`),
plus the world's wildlife and landmarks (mites, a flea, the worm, the smear
trail, freckles, warts, the Navel, the Eye, veins and a plinth).
Each is a height map + color + gloss shaded with one warm key light from the
upper left, so it sits with the renders. Deterministic; rerun with
`python tools/world.py` after changing it (`python tools/world.py ground` for
just the ground, `events` for the MMO-layer art, `life` for wildlife and
landmarks). The plot art's hole
positions must match `HOLE_OFFSET` in `packages/client/src/world/layout.js`.
Swap any file for real art with the same name and size and nothing else
changes.

App icons (favicon, home screen, PWA) come from a character render:
`python tools/icons.py [slug]` (default `snoot`).

The link preview card (`public/og.jpg`, 1200x630, what chat apps show for the
game's link or an invite link) is a lineup of characters under the logo:
`python tools/preview.py`. The page's Open Graph tags point at it by full
address, from `VITE_SITE_URL` in `packages/client/.env.production`.

Fonts (Rubik Wet Paint, Patrick Hand — same as the first game) are
self-hosted in `packages/client/public/fonts/` under the SIL Open Font License.

## Repo layout

Npm workspaces monorepo:

```
packages/
  shared/   characters, rarities, seeds, levels, quests, chat/emote rules: imported by client and server
  server/   Colyseus room: authoritative state, lives on a Node host
    src/rooms/WorldRoom.js   players, plots, planting, harvesting, squeezing, chat, gifts, events
    src/game/                saves, daily streak, quests, The Boil, Pus Rain, The Itch, rolls, chat filter
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
TEST_DATABASE_URL=postgres://... npm test -- database   # with a Postgres it may wipe
```

`tests/run.mjs` starts fresh game servers for each suite (timers sped up
with `GROW_SCALE`/`EVENT_SCALE`, `PROFILE_SECRET=test`) and drives them with
real Colyseus clients. Suites: `featured` (no server: the day's pick and its
odds), `game` (planting, levels, quests, chat, squeezing, The Boil, Blood
Moon), `levels` (high-level growth), `shop`, `integrity` (old saves,
squeezes and boss damage across reloads), `reconnect`, `saves` (signing,
restore, takeover, daily streak and quest), `shinies` (plus stars and wear
bonuses), `rain`, `itch`, `rows` (album row rewards), `season` (in and out
of season), `held` (offline players' plots), `admin` (key, lockout, what it
shows), `invites` (invite links, rewards, the daily cap), `limits` (joins and seats per address, request sizes, invisible
characters, lockout by real address), `titles`, `gifts`, `hardening`
(filter, rate limits) and `filter`.
GitHub Actions runs them on every push and pull request
(`.github/workflows/test.yml`).

## Admin page

`https://hairy-popsicles-mmo-server.onrender.com/admin` (the game server, not
the Pages site). It asks for the admin key, which is the `ADMIN_KEY`
environment variable on the Render service (`render.yaml` generates one; find
it under the service's Environment tab, or set your own long random string).
Without `ADMIN_KEY` set, the page doesn't exist.

It shows everyone online now and everyone who left in the last 3 days (from
the server's copy of their last save; it's in memory, so a restart clears it):
level, scraps, album with counts and shinies, inventory, lifetime stats,
quests, titles, plot, streak and ids, plus the live events, plots being held
for absent players, and recent chat. "New players today" is the tester
funnel: how many new players got a plot, planted, harvested and reached
levels 2, 3 and 5, how many came by invite, how many came back from an
earlier day, and how long sessions last (all since the server last started). Search, filter and sort; tap a player for
everything. It refreshes every 10 seconds and is read-only.

The key goes in a header, never in the URL; ten wrong keys lock that address
out for 10 minutes; nothing is cached; save tokens themselves are never sent;
the page may run only its own script (Content-Security-Policy). Tick
"Remember on this device" only on your own phone. The bottom of the page says
which address the server sees for you and where it got it: it should be your
own address, from `CF-Connecting-IP`.

## Security

What protects what, and what's still open.

- **Saves can't be forged or edited.** Each is signed (HMAC-SHA256 with
  `PROFILE_SECRET`, compared in constant time) and every field is re-checked
  on load. Other players only ever see a public id, never a profile id or
  save. Keep `PROFILE_SECRET` and `ADMIN_KEY` long and random, and never
  commit them.
- **The server decides everything:** what grows, what drops, who gets paid.
  Clients send requests, each one checked and rate limited per player.
- **Player text never becomes code.** Names and chat only ever reach the page
  as text (`textContent`, or drawn on the canvas), lose control, bidi and
  zero-width characters on the server, and pass the word filter. The built
  game and the admin page both carry a Content-Security-Policy that allows
  only their own scripts, as a backstop.
- **One person can't take the world.** Per address (Render's
  `CF-Connecting-IP`; the last `X-Forwarded-For` entry or the socket if
  that's missing): 30 joins a minute (`JOINS_PER_MINUTE`) and 10 players at
  once (`SEATS_PER_ADDRESS`); a join's seat waits 10 seconds for its
  connection; join requests over 16 KB, or without a length, are refused
  unread; a full copy of the world goes out at most once a second per
  connection. Raise the two settings on Render if a school or office shares
  one address.
- **Old saves can't be replayed** while the server is up: it keeps everyone's
  latest save for 3 days, with newcomers in a separate pool so a flood of
  throwaway players can't push out anyone with progress.
- **Known gaps, by design for now:**
  - The save code is the account. Anyone holding it can play as that player,
    and there's no way to revoke one; the game warns players never to share it.
  - The server's memory of saves resets when it restarts or sleeps, so after
    that a player could restore an older save of their own.
  - Movement is trusted within walking speed (anyone can be anywhere within
    about 1.4 seconds), which is fine for a game with no combat between players.
  - The game shares the `dannyleb.github.io` origin with any other Pages site on
    that account. A custom domain would give it its own.

## What's stubbed / not real yet

- **Saves live on the device, with the server's newest copy in Postgres.**
  The device keeps its signed save as before. With `DATABASE_URL` set (Neon,
  see Deploy), the server also stores each player's newest save: every 30
  seconds while they play, when they leave, and on shutdown (a deploy or
  restart). On join the newer of the stored copy and the device's wins, so an
  old save can't be replayed after a restart, and at startup the plots of
  players who left in the last 24 hours go back into the world. Only players
  with some XP are stored. If the database is down the game carries on from
  memory and the device's saves (`packages/server/src/db.js`). Still missing:
  accounts, so progress moves to another phone only by copying the save
  code, clearing site data loses it, and a leaked code can't be cut off.
- **The save secret.** Saves are signed with `PROFILE_SECRET`. `render.yaml`
  generates one; if it changes or is missing, every save stops loading (the
  server logs a warning when it's missing).
- **One room, no sharding.** Everyone joins the same `world` room (300
  max; the 301st is told the world is full). There is exactly one, it is
  never disposed, and clients can only join it or reconnect to it (no
  creating rooms or joining by id). A 60-bot load test ran clean. Past 300
  it needs zones or shards.
- **State sync is a blunt instrument.** The server broadcasts the whole
  public world state at most 10 times a second when something changes,
  leaving out the plots (most of it) unless a plot changed since the last
  broadcast. Fine at small scale; swap in `@colyseus/schema` delta encoding
  before it matters.
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
- **Database:** Neon Postgres, project `fragrant-mountain-51553597`, branch
  `production` (linked in `.neon`; `neon.ts` is its config). The server
  reads `DATABASE_URL` (pooled, for queries) and `DATABASE_URL_UNPOOLED`
  (direct, for creating its table at startup); set both on Render. Locally,
  `neon env pull` writes them to `.env.local`, which `npm run dev:server`
  loads. The admin page's tiles say whether it's connected and how many
  players it holds; `/stats` has `database`: `ready`, `unreachable` or `off`.
- **Keeping it awake:** `.github/workflows/keepalive.yml` pings the server
  every 10 minutes so it never naps (GitHub's schedules can run a few
  minutes late, so a rare nap can still slip through), and logs which build
  is live: `/stats` includes `version`, the commit Render deployed. One
  always-on free service uses about 744 of Render's 750 free hours a month.
  Turn it off under the repo's Actions tab if those hours are needed elsewhere.
- **Client:** GitHub Pages via `.github/workflows/pages.yml` on every push
  to `main`, served at `https://dannyleb.github.io/hairy-popsicles-the-mmo/`.
  Production builds point at the Render server via
  `packages/client/.env.production`.

## Next steps (roughly in order)

1. Real names for `spoon-nana`, `bat-rat` and `head-bloom`, and more
   characters (each new one deepens the album).
2. Server-side saves and accounts, so progress follows a player across
   devices and offline players' plots survive a server restart.
3. Real art for the world (ground, plots, props, The Boil).
