# Hairy Popsicles: The MMO

A spin-off of [Hairy Popsicles](https://github.com/dannyleb/hairy-popsicles-the-game),
same gross, flesh-toned universe — but lightweight, mobile-web, and shared:
everyone tends their own patch in one persistent world and can see everyone
else's.

## What it is (v1 target)

Not a true massive-scale MMO — that's not a realistic solo-dev scope. It's
the **.io-game pattern** (Agar.io / MooMoo.io): one shared real-time room,
dozens of concurrent players, instant play, no install, no login wall. Feels
like an MMO, ships like a small game.

**Core loop:** walk around a shared world → claim an empty plot → plant a
seed (5 scraps) → it grows into a random character, a dark silhouette rising
out of the soil until it ripens in full color → harvest it into your album
(plus scraps for more seeds) → play as any character you've grown. Rarer
characters take longer. Everyone sees each other's avatars and plots.

| Rarity | Odds | Grow time | Scraps |
|---|---|---|---|
| Common (8) | 55% | 30s | 7 |
| Uncommon (7) | 28% | 1.5 min | 12 |
| Rare (7) | 13% | 4 min | 25 |
| Legendary (3) | 4% | 8 min | 60 |

Timers are short on purpose while nothing persists. Tune them, and which
character is which rarity, in `packages/shared/src/characters.js`.

**The world:** like the first game, the world is skin — here a dark, wet,
candlelit expanse of it seen from above, lit like the character renders.
Plots are raw sores with a 3x3 grid of follicle holes the characters grow out
of. Candles flicker at plot corners, pus-flies drift in loops, spores float
past, hairs, pimples, moles and slime puddles are scattered about, and the
camera follows you. Characters on screen mutter their lines from the first
game's `src/roster.js` (characters without lines fall back to its grunts).

**Flow:** an HTML loading screen (shows before the JavaScript arrives) → a
title menu over the drifting world (name, Play, placeholder How to play /
Settings / Credits) → connecting (with a "waking the server" message after a
few seconds, and a retry) → the world.

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
`packages/client/public/world/` (~410KB): a seamless 1024px wet-skin ground
tile, three plot-sore variants, pimples, a pustule, moles, hairs, slime and
pus puddles, a candle, its flame, and soft glow/spore sprites. Each is a
height map + color + gloss shaded with one warm key light from the upper
left, so it sits with the renders. Deterministic; rerun with
`python tools/world.py` after changing it (`python tools/world.py ground`
for just the ground). The plot art's hole positions must match
`HOLE_OFFSET` in `packages/client/src/world/layout.js`. Swap any file for real
art with the same name and size and nothing else changes.

Fonts (Rubik Wet Paint, Patrick Hand — same as the first game) are
self-hosted in `packages/client/public/fonts/` under the SIL Open Font License.

## Repo layout

Npm workspaces monorepo:

```
packages/
  shared/   constants + character catalog/rarities, imported by both client and server
  server/   Colyseus room — authoritative state, lives on a Node host
  client/   Phaser 3 + Vite — the actual game, runs in the browser
    src/scenes/   Boot (loads assets) → Menu → World
    src/world/    the backdrop shared by menu and world, world layout constants
    src/ui/       HTML overlays: loading screen, menu, HUD, album, toasts
```

## Running it locally

```
npm install
npm run dev:server   # starts the Colyseus room on ws://localhost:2567
npm run dev:client   # starts Vite on http://localhost:5173
```

Open the client URL on your phone (same network) or in a desktop browser
with devtools in mobile emulation. Tap to walk; tap empty ground to claim a
plot; tap an empty tile in your own plot to plant; tap a ripe one to
harvest. To test without waiting, speed up every grow timer:
`GROW_SCALE=0.01 npm run dev:server` (100x faster).

## What's stubbed / not real yet

- **No persistence.** Server state is in-memory; a restart wipes everyone's
  plots. Needs a real datastore (Redis/Postgres) before this is live for
  real players.
- **No auth / identity.** Every session is an anonymous "GuestNNNN" — no
  accounts, so progress doesn't survive a lost session. Needs *some*
  identity (even just a device-local persistent token) before "persistent
  world" is actually true for a player.
- **One room, no sharding.** Everyone who connects joins the same `world`
  room. Fine until there are enough concurrent players that one room gets
  crowded — then it needs zone/shard logic.
- **State sync is a blunt instrument.** The server broadcasts the *entire*
  world state on every change. Fine at small scale; swap in
  `@colyseus/schema` delta encoding before this matters.
- **World art is procedural placeholder** (see "World art"), and the menu's
  Settings and Credits are placeholders.
- **No sound.**
- **No icons.** The PWA manifest has no icons yet, so "Add to Home Screen"
  shows a blank tile.

## Deploy

- **Server:** Render free web service, defined in `render.yaml`, live at
  `https://hairy-popsicles-mmo-server.onrender.com` (responds `ok`). The
  free tier sleeps after 15 min idle; the first visitor after that waits
  ~30-60s and the in-memory world resets.
- **Client:** GitHub Pages via `.github/workflows/pages.yml` on every push
  to `main`, served at `https://dannyleb.github.io/hairy-popsicles-the-mmo/`.
  Production builds point at the Render server via
  `packages/client/.env.production`.

## Next steps (roughly in order)

1. Persistence plus device-local identity, so plots and albums survive a
   server restart and closing the tab. Until then the album resets every
   visit, which undercuts the collecting hook.
2. Sound and music.
3. Real art for the world (ground, plots, props) and app icons.
