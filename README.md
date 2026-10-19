# Hairy Popsicles: The MMO

A spin-off of [Hairy Popsicles](https://github.com/dannyleb/hairy-popsicles-the-game),
same hand-drawn, flesh-toned, popsicle-head universe — but lightweight,
mobile-web, and shared: everyone tends their own patch in one persistent
world and can see everyone else's.

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
- **Art:** reuses the Hairy Popsicles visual language (traced ink
  illustration, flesh-toned palette, popsicle-stick heads) — not yet wired
  in; see "What's stubbed" below.

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

- **No art.** Players are colored circles, plots are colored squares. The
  Hairy Popsicles trace/animate pipeline (`tools/trace.mjs`,
  `tools/animate.mjs` in the sibling repo) is the plan for turning real
  illustrations into game sprites here too — not started.
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
- **No deploy target picked yet.** The client (static Vite build) can go on
  GitHub Pages like the original game — but the Colyseus server is a live
  Node/WebSocket process and **cannot** run on GitHub Pages. It needs a
  small always-on Node host (Render/Fly.io/Railway all have free tiers that
  fit this). This is the next concrete decision to make.

## Next steps (roughly in order)

1. Pick a server host and get the deployed client talking to a deployed
   server (not just localhost).
2. Basic persistence so a plot survives a server restart.
3. A real planting UI (pick from `ITEM_DEFS` instead of always planting the
   cheapest thing).
4. First real art pass — bring in traced illustration for at least the
   player avatar and one plant.
5. Device-local identity so progress survives closing the tab.
