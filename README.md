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

**Core loop:** walk around a shared world → claim an empty plot → plant
something → wait for it to grow (real time, persists while you're offline)
→ harvest for currency ("scraps") → buy better things to plant → repeat. See
other players walking around and tending their own plots nearby.

## Decisions locked in so far

- **Platform:** mobile web / PWA only for v1. No App Store / Play Store
  wrapper, no review process, no install friction — open a link and play.
- **Monetization:** none yet. Get the loop hooky first.
- **Art:** photoreal 3D-rendered characters (heads and creatures), cut out
  of their backgrounds and used as-is — not flattened into the first game's
  ink style.
- **Characters are the crop:** seeds ripen into characters on your plot,
  rarer ones take longer; you collect them, and can play as any one you've
  grown. Not wired in yet.

## Character art

Full-size renders stay on Danny's machine; only game sprites are committed,
to `packages/client/public/characters/<slug>.webp` (768px long edge,
transparent, ~40-110KB). To add a batch:

```
pip install -r tools/requirements.txt          # once; model (~180MB) downloads on first run
python tools/cutout.py render.png slug [render2.png slug2 ...]
```

Background removal is an ML matting model (rembg `isnet-general-use`). It
handles hair, wings and see-through drips well on the game's dark
background; stray hairs keep a slight dark fringe that would show on a pale
background. If it keeps a piece of scenery, add an erase box for that slug to
`ERASE` in `tools/cutout.py`.

## Repo layout

Npm workspaces monorepo:

```
packages/
  shared/   constants + item/economy defs, imported by both client and server
  server/   Colyseus room — authoritative state, lives on a Node host
  client/   Phaser 3 + Vite — the actual game, runs in the browser
```

## Running it locally

```
npm install
npm run dev:server   # starts the Colyseus room on ws://localhost:2567
npm run dev:client   # starts Vite on http://localhost:5173
```

Open the client URL on your phone (same network) or in a desktop browser
with devtools in mobile emulation. Tap to walk; tap empty ground to claim a
plot; tap an empty tile in your own plot to plant; tap a grown one to
harvest.

## What's stubbed / not real yet

- **Art not in the game yet.** Character sprites exist (see "Character
  art") but players are still colored circles and crops colored squares.
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
- **No camera movement.** You can only see and tap the part of the world
  that fits on screen; the rest of the 20x20 plot grid is unreachable.
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

1. Camera that follows the player / can be dragged, so the whole world is
   reachable.
2. Basic persistence so a plot survives a server restart.
3. A real planting UI (pick from `ITEM_DEFS` instead of always planting the
   cheapest thing).
4. Wire characters in as the crop and as avatars, plus app icons.
5. Device-local identity so progress survives closing the tab.
