# Developing Hairy Popsicles: The MMO

How it's built, run, tested and deployed. What the game is and how to play is
in the [README](../README.md); every rule and number is in [RULES.md](RULES.md).

**Play:** https://dannyleb.github.io/hairy-popsicles-the-mmo/ ·
**Server:** https://hairy-popsicles-mmo-server.onrender.com
([/stats](https://hairy-popsicles-mmo-server.onrender.com/stats)) ·
**Tests:** `npm test`, and on every push in GitHub Actions.

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
`packages/client/public/world/`: a seamless 1024px ground tile of skin under
goo (glossy mucus slicks and beads, drips oozing down off the slicks,
weeping pores; the goo's colour goes on after the grade, so it stays yellow),
three plot-sore variants, pimples, a pustule, moles, hairs, slime and pus
puddles, a candle, its flame, soft glow/spore sprites, and for the MMO layer
The Boil, the scab over locked holes, goo droplets and the four seed icons,
the other world events (The Scab in ten peelable pieces over raw skin, The
Gash, its crumbs of crust, The Tick, an ingrown hair, a blackhead and its
emptied pore, gunk, navel lint; `python tools/world.py gross`),
plus the world's wildlife and landmarks (mites, a flea, the worm, the smear
trail, freckles, warts, the Navel, the Eye, veins and a plinth).
Each is a height map + color + gloss shaded with one warm key light from the
upper left, so it sits with the renders, then graded to the renders' skin
(red-brown in the shadows warming to ochre in the lights, strong reds kept
crimson), with pores and fine creases and a soft sheen rather than hard
glints (crisp ones only on the ground's goo). In the game the ground and its props are drawn in `NIGHT_TINT` and
plots and world events in the slightly brighter `EVENT_TINT` (both in
`layout.js`), so the characters are what stand out. Deterministic; rerun with
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
    src/game/                saves, daily streak, quests, rolls, chat filter, invites, strays, and the
                             world events (worldEvents.js schedules boss, scab, gash, tick, ingrown,
                             blackheads, lint), Pus Rain, The Itch
    src/db.js                Postgres saves (Neon); src/admin.js the admin page
  client/   Phaser 3 + Vite: the actual game, runs in the browser
    src/scenes/   Boot (loads assets) → Menu → World
    src/world/    backdrop, landmarks, weather, critters, strays, sleepers, trails, drops,
                  The Boil and the other world events, effects, layout constants
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
the world events, the Blood Moon, the Pus Rain and The Itch come (and go) 5x
sooner (`WORLD_EVENTS=scab,tick` picks which world events, in order), e.g.
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
real Colyseus clients; `tests/lib.mjs` has what the suites share (`check`,
`finish`, the waits). Suites: `featured` (no server: the day's pick and its
odds), `game` (planting, levels, quests, chat, squeezing, The Boil, Blood
Moon), `levels` (high-level growth), `shop`, `integrity` (old saves,
squeezes and boss damage across reloads), `reconnect`, `saves` (signing,
restore, takeover, daily streak and quest), `shinies` (plus stars and wear
bonuses), `rain`, `itch`, `rows` (album row rewards), `season` (in and out
of season), `held` (offline players' plots), `admin` (key, lockout, what it
shows), `invites` (invite links, rewards, the daily cap), `limits` (joins
and seats per address, request sizes, invisible characters, lockout by real
address), `life` (day and night, weather, strays, sleepers, landmarks, the
statue), `events` (The Scab, The Gash, The Tick and the event rotation),
`events2` (Ingrown Hair, Blackheads, Navel Lint), `who` (who's around:
who's here and idle, who's been by, nothing private, the limit), `database`
(Postgres saves, restarts, the database being down, who's been by after one), `titles`, `gifts`, `hardening`
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
- **What anyone can see of a player.** In the world: their name, level,
  character, album, title and a public id (never the save id). `/players`
  (Who's around) shows the same name, level, character and public id to
  anyone, plus how long a player's been idle or since they left (last 3 days,
  from level 2), 30 looks a minute per address. That's the point of it
  (seeing if friends are on), but it does tell anyone when a name plays, so
  Appear offline (Settings) keeps a player off it.
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
  - Without `DATABASE_URL` (or for a player still at level 1, who isn't
    stored), the server's memory of saves resets when it restarts or sleeps,
    so after that a player could restore an older save of their own.
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
  from level 2 are stored, so throwaway players can't fill it. If the database is down the game carries on from
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
  since the last restart; `/players` is Who's around). The
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
  to `main`, served at `https://dannyleb.github.io/hairy-popsicles-the-mmo/`
  until the move to `https://hairypopsicles.com` (below). The build asks Pages
  where it's served (the workflow's `site` job) and builds for that path, so
  setting or changing the custom domain needs only a redeploy (Actions → Deploy
  client to GitHub Pages → Run workflow). Production builds point at the Render
  server via `packages/client/.env.production`.

## The domain: hairypopsicles.com

Registered at Squarespace; the game (client) lives on GitHub Pages behind it.
The server stays at its Render address.

1. **DNS (Squarespace → Domains → hairypopsicles.com → DNS).** Remove the
   Squarespace Defaults preset, then add: four `A` records for `@`
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`),
   four `AAAA` records for `@` (`2606:50c0:8000::153`, `2606:50c0:8001::153`,
   `2606:50c0:8002::153`, `2606:50c0:8003::153`) and a `CNAME` for `www` to
   `dannyleb.github.io`. Optionally also verify the domain for Pages
   (GitHub → your Settings → Pages → Add a domain: a `TXT` record), so nobody
   else's Pages site can claim it.
2. **Pages (this repo → Settings → Pages → Custom domain):** `hairypopsicles.com`,
   then Enforce HTTPS once the certificate is ready.
3. **Redeploy** (above), so the build is for the domain's root.

**Saves move with the players.** A save lives in the browser's storage for the
address it was made at, so `packages/client/src/net/home.js` carries it over:
a copy still running at the old address (a phone's offline cache) checks the
new home's `home.json` (which game, built for which path); once that says this
game at `/`, it hands its save over after `#carry=` in the new address (which
never leaves the phone), unregisters its offline cache and moves. The new home
takes it if the phone has no save there yet, and otherwise asks which to keep.
For anyone else, the title screen at the new address offers "Played before at
the old address? Bring your save": the bridge page
`mmo-save.html` on the first game's site (same `dannyleb.github.io` storage)
reads the old save and hands it over the same way. Players pick up the update
that moves them by opening the game once at the old address before the switch.

## Next steps (roughly in order)

1. Real names for `spoon-nana`, `bat-rat` and `head-bloom`, and more
   characters (each new one deepens the album).
2. Accounts, so progress follows a player across devices without copying
   a save code, and a leaked code can be cut off.
3. Real art for the world (ground, plots, props, The Boil).
