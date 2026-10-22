import Phaser from 'phaser';
import { INGROWN, SCAB, TICK, tickFeedsOn } from '@hptm/shared';
import { textResolution } from '../display.js';
import { BAR_H, DEPTH, FONT, drawBar } from './layout.js';

// The world events after The Boil (see worldEvents.js in @hptm/shared), as
// everyone sees them: The Scab, peeled piece by piece off raw skin; The Gash,
// with its crumbs of crust; The Tick, swelling as it feeds; an Ingrown Hair
// throbbing to its beat as the hair comes out; a patch of Blackheads, gunk
// coming out of each; and Navel Lint (the lint itself is drawn as drops).
const SCAB_SIZE = 170;
const GASH_HEIGHT = 130;
const CRUMB_SIZE = 26;
const DEEP_SIZE = 34;
const TICK_SIZE = 84;
const INGROWN_SIZE = 120;
const HAIR_OUT = 150;     // px of hair drawn out when it's all but out
const HEAD_SIZE = 40;
const GUNK_LENGTH = 54;
const LABEL = { fontFamily: FONT, fontSize: '16px', color: '#ffd9c0', stroke: '#1a0a0d', strokeThickness: 4 };

export function createEventViews(scene, fx) {
  // Fade things out, then let them go.
  const gone = (things, duration = 900) => scene.tweens.add({
    targets: things, alpha: 0, duration, onComplete: () => things.forEach((t) => t.destroy()),
  });
  let event = null;   // the server's view of it, as last synced
  let view = null;    // what's drawn: { kind, x, y, parts..., destroy() }

  const text = (x, y, value, style = {}) => scene.add.text(x, y, value, { ...LABEL, ...style, resolution: textResolution() })
    .setOrigin(0.5, 1).setDepth(DEPTH.bubbles - 1);

  function makeScab(e) {
    const bed = scene.add.image(e.x, e.y, 'world:scab-bed').setDepth(DEPTH.decor + 3);
    bed.setScale(SCAB_SIZE / bed.width);
    const pieces = e.pieces.map((state, i) => {
      const piece = scene.add.image(e.x, e.y, `world:scab-${i}`).setDepth(DEPTH.decor + 4).setVisible(!state);
      piece.setScale(SCAB_SIZE / piece.width);
      return piece;
    });
    // Wet while it's drying: a glisten over it that fades as it dries.
    const glisten = scene.add.image(e.x, e.y - 10, 'world:glow').setTint(0xff8070).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.decor + 5).setScale(SCAB_SIZE / 256).setAlpha(0);
    const label = text(e.x, e.y - SCAB_SIZE / 2 - 4, 'The Scab');
    const ring = scene.add.graphics().setDepth(DEPTH.bubbles - 2);
    for (const thing of [bed, ...pieces]) {
      thing.setScale(0);
      scene.tweens.add({ targets: thing, scale: SCAB_SIZE / thing.width, duration: 900, ease: 'Back.out' });
    }
    fx.droplets(e.x, e.y, { count: 8, key: 'drop-blood', speed: [50, 120] });
    return { kind: 'scab', x: e.x, y: e.y, bed, pieces, glisten, label, ring, things: [bed, ...pieces, glisten, label, ring] };
  }

  function makeGash(e) {
    const wound = scene.add.image(e.x, e.y, 'world:gash').setRotation(e.angle).setDepth(DEPTH.decor + 3);
    const sx = e.length / wound.width;
    const sy = GASH_HEIGHT / wound.height;
    wound.setScale(sx, 0);
    scene.tweens.add({ targets: wound, scaleY: sy, duration: 700, ease: 'Cubic.out' });
    const crumbs = new Map();
    for (const c of e.crumbs) {
      const image = scene.add.image(c.x, c.y, c.deep ? 'world:crust-deep' : `world:crust-${c.id % 3}`).setDepth(c.y)
        .setRotation(Math.random() * Math.PI * 2);
      const size = c.deep ? DEEP_SIZE : CRUMB_SIZE;
      image.setScale(size / image.width).setAlpha(0);
      scene.tweens.add({ targets: image, alpha: 1, delay: 400 + Math.random() * 400, duration: 300 });
      crumbs.set(c.id, { ...c, image, size, rest: image.rotation });
    }
    const loose = text(e.x, e.y, 'Needs a second hand!', { fontSize: '13px', color: '#ffe6a8' }).setVisible(false);
    const label = text(e.x, e.y - GASH_HEIGHT / 2, 'The Gash');
    fx.droplets(e.x, e.y, { count: 10, key: 'drop-blood', speed: [60, 150] });
    return { kind: 'gash', x: e.x, y: e.y, wound, crumbs, loose, label, sx, sy, things: [wound, loose, label] };
  }

  function makeTick(e) {
    // Over the plots (so the threads reach the crops), under the crops themselves.
    const drain = scene.add.graphics().setDepth(DEPTH.light - 2);
    const body = scene.add.image(e.x, e.y, 'world:tick').setOrigin(0.5, 0.3).setDepth(e.y + 2);
    body.setScale(0);
    scene.tweens.add({ targets: body, scale: TICK_SIZE / body.width, duration: 600, ease: 'Back.out' });
    const bar = scene.add.graphics().setDepth(DEPTH.bubbles - 1);
    const label = text(e.x, e.y, 'The Tick');
    const hands = text(e.x, e.y, '', { fontSize: '14px', color: '#ffe6a8' });
    return { kind: 'tick', x: e.x, y: e.y, body, drain, bar, label, hands, wiggleUntil: 0, fed: [], things: [drain, body, bar, label, hands] };
  }

  function makeIngrown(e) {
    const bump = scene.add.image(e.x, e.y, 'world:ingrown').setDepth(DEPTH.decor + 3);
    bump.setScale(0);
    scene.tweens.add({ targets: bump, scale: INGROWN_SIZE / bump.width, duration: 800, ease: 'Back.out' });
    const hair = scene.add.graphics().setDepth(e.y + 1);
    const ring = scene.add.graphics().setDepth(DEPTH.bubbles - 2);
    const bar = scene.add.graphics().setDepth(DEPTH.bubbles - 1);
    const label = text(e.x, e.y, 'Ingrown Hair · tap on the throb');
    const call = text(e.x, e.y, '', { fontSize: '20px', color: '#f3d27a' }).setAlpha(0);
    return { kind: 'ingrown', x: e.x, y: e.y, bump, hair, ring, bar, label, call, lastBeat: 0, angle: -0.6, things: [bump, hair, ring, bar, label, call] };
  }

  function makeBlackheads(e) {
    const heads = new Map();
    for (const h of e.heads) {
      const image = scene.add.image(h.x, h.y, h.done ? 'world:pore' : 'world:blackhead').setDepth(DEPTH.decor + 3);
      image.setScale(0);
      scene.tweens.add({ targets: image, scale: HEAD_SIZE / image.width, delay: Math.random() * 500, duration: 400, ease: 'Back.out' });
      heads.set(h.id, { ...h, image, out: h.done });  // (squeezed before we came: no gunk to show)
    }
    const label = text(e.x, e.y - 130, 'Blackheads · hold one to squeeze');
    const ring = scene.add.graphics().setDepth(DEPTH.bubbles - 2);
    return { kind: 'blackheads', x: e.x, y: e.y, heads, label, ring, gunk: [], things: [label, ring] };
  }

  function makeLint(e) {
    const label = text(e.x, e.y - 165, 'Navel Lint · grab it!');
    return { kind: 'lint', x: e.x, y: e.y, label, things: [label] };
  }

  const makers = { scab: makeScab, gash: makeGash, tick: makeTick, ingrown: makeIngrown, blackheads: makeBlackheads, lint: makeLint };
  const allThings = (v) => [
    ...v.things,
    ...(v.crumbs ? [...v.crumbs.values()].map((c) => c.image) : []),
    ...(v.heads ? [...v.heads.values()].map((h) => h.image) : []),
    ...(v.gunk ?? []),
  ];

  // Crops of players who are here, near The Tick: it's feeding on them.
  const fedOn = (state, now) => tickFeedsOn(state.plots ?? {}, state.players, event, now);

  return {
    // `next`: the state's event, or null; `state` for The Tick's view of the plots.
    sync(next, state, now) {
      // Over without our hearing how (eventOver normally comes first): just let it go.
      if (view && (!next || next.kind !== view.kind || next.x !== view.x || next.y !== view.y)) this.fade();
      event = next;
      if (!next) return;
      if (!view) view = makers[next.kind]?.(next) ?? null;
      if (!view) return;  // (a kind this client doesn't know yet)

      if (view.kind === 'scab') {
        next.pieces.forEach((state, i) => {
          const piece = view.pieces[i];
          if (!state || !piece.visible || piece.peeling) return;
          // Off it comes, flung away from the middle.
          piece.peeling = true;
          const angle = ((i + 0.5) / SCAB.pieces) * Math.PI * 2;
          piece.setDepth(DEPTH.bubbles - 3);
          scene.tweens.add({
            targets: piece, x: view.x + Math.cos(angle) * 110, y: view.y + Math.sin(angle) * 110 - 50,
            rotation: (Math.random() - 0.5) * 3, alpha: 0, duration: 750, ease: 'Cubic.out',
            onComplete: () => piece.setVisible(false),
          });
          if (state === 2) fx.droplets(view.x + Math.cos(angle) * 40, view.y + Math.sin(angle) * 40, { count: 7, key: 'drop-blood', speed: [60, 160], size: [4, 8] });
        });
      } else if (view.kind === 'gash') {
        const left = new Set(next.crumbs.map((c) => c.id));
        for (const [id, crumb] of view.crumbs) {
          const update = next.crumbs.find((c) => c.id === id);
          if (update) crumb.loose = update.loose;
          if (!left.has(id) && !crumb.flicked) this.picked(id);
        }
      } else if (view.kind === 'tick') {
        view.fed = state ? fedOn(state, now) : [];
      } else if (view.kind === 'blackheads') {
        for (const h of next.heads) if (h.done) this.squeezed(h.id);
      }
    },

    // A blackhead squeezed, for everyone: a worm of gunk comes out of it.
    squeezed(id) {
      const head = view?.heads?.get(id);
      if (!head || head.out) return;
      head.out = true;
      head.image.setTexture('world:pore');
      const gunk = scene.add.image(head.x, head.y, 'world:gunk').setOrigin(0, 0.5).setDepth(head.y + 1)
        .setRotation(-Math.PI / 2 + (Math.random() - 0.5) * 1.6);
      const scale = GUNK_LENGTH / gunk.width;
      gunk.setScale(0, scale);
      view.gunk.push(gunk);
      scene.tweens.add({ targets: gunk, scaleX: scale, duration: 450, ease: 'Sine.out' });
      scene.tweens.add({ targets: gunk, alpha: 0, delay: 2200, duration: 800 });
    },

    // A crumb out, for everyone: flicked up and away.
    picked(id) {
      const crumb = view?.crumbs?.get(id);
      if (!crumb || crumb.flicked) return;
      crumb.flicked = true;
      const side = Math.random() < 0.5 ? -1 : 1;
      scene.tweens.add({
        targets: crumb.image, x: crumb.x + side * (40 + Math.random() * 40), y: crumb.y - 60 - Math.random() * 30,
        rotation: crumb.rest + side * 4, alpha: 0, duration: 600, ease: 'Quad.out',
        onComplete: () => crumb.image.setVisible(false),
      });
      if (crumb.deep) fx.droplets(crumb.x, crumb.y, { count: 4, key: 'drop-blood', speed: [40, 100], size: [3, 6] });
    },

    // It's over: the way each one ends.
    over({ kind, pried }) {
      if (!view || view.kind !== kind) return;
      if (kind === 'ingrown' || kind === 'blackheads' || kind === 'lint') return this.overMore(kind);
      const dying = view;
      view = null;
      event = null;
      if (kind === 'scab') {
        fx.ring(dying.x, dying.y, { color: 0xff9a8a, size: 260, duration: 600 });
        gone([dying.label, dying.ring, dying.glisten, ...dying.pieces], 300);
        scene.tweens.add({ targets: dying.bed, alpha: 0, delay: 2500, duration: 2500, onComplete: () => dying.bed.destroy() });
      } else if (kind === 'gash') {
        // It zips shut.
        scene.tweens.add({ targets: dying.wound, scaleY: 0, duration: 900, ease: 'Cubic.in', onComplete: () => dying.wound.destroy() });
        gone([dying.label, dying.loose, ...[...dying.crumbs.values()].map((c) => c.image)], 300);
      } else {
        gone([dying.label, dying.hands, dying.bar, dying.drain], 300);
        if (pried) {
          fx.droplets(dying.x, dying.y, { count: 12, key: 'drop-blood', speed: [80, 220], size: [5, 10], up: 1.2 });
          scene.tweens.add({
            targets: dying.body, y: dying.y - 160, x: dying.x + 60, rotation: 6, alpha: 0, duration: 900, ease: 'Quad.out',
            onComplete: () => dying.body.destroy(),
          });
        } else {
          // Full, it lets go and rolls off.
          scene.tweens.add({
            targets: dying.body, x: dying.x + 70, rotation: 2.4, alpha: 0, duration: 1600, ease: 'Quad.in',
            onComplete: () => dying.body.destroy(),
          });
        }
      }
    },

    overMore(kind) {
      const dying = view;
      view = null;
      event = null;
      const things = allThings(dying);
      if (kind === 'ingrown') {
        // Out it whips: a hair as long as your arm, flung away.
        const whip = scene.add.graphics().setDepth(DEPTH.bubbles - 3).setPosition(dying.x, dying.y);
        whip.lineStyle(5, 0x24160f, 1);
        whip.beginPath().moveTo(0, 0);
        for (let i = 1; i <= 24; i++) whip.lineTo(i * 14, Math.sin(i * 0.7) * 10);
        whip.strokePath().setRotation(dying.angle);
        scene.tweens.add({
          targets: whip, x: dying.x + 220, y: dying.y - 260, rotation: dying.angle + 5, alpha: 0, duration: 1100, ease: 'Cubic.out',
          onComplete: () => whip.destroy(),
        });
        fx.droplets(dying.x, dying.y, { count: 10, key: 'drop-blood', speed: [60, 160], size: [4, 8] });
        fx.ring(dying.x, dying.y, { color: 0xffd0a0, size: 220, duration: 500 });
      }
      scene.tweens.killTweensOf(things);
      gone(things, kind === 'blackheads' ? 2500 : 900);
    },

    // Gone without a proper ending (we missed it while away): fade out.
    fade() {
      if (!view) return;
      const things = allThings(view);
      view = null;
      scene.tweens.killTweensOf(things);
      gone(things, 600);
    },

    kind: () => view?.kind ?? null,
    position: () => (view ? { x: view.x, y: view.y } : null),

    // What's under a tap: { kind } for The Scab, The Tick or an Ingrown Hair,
    // { kind: 'gash', crumb } for a crumb, { kind: 'blackheads', head } for a blackhead.
    at(x, y) {
      if (!view) return null;
      if (view.kind === 'lint') return null;  // (the lint itself is drops)
      if (view.kind === 'ingrown') return Math.hypot(x - view.x, y - view.y) < INGROWN_SIZE * 0.5 ? { kind: 'ingrown' } : null;
      if (view.kind === 'blackheads') {
        let best = null;
        for (const head of view.heads.values()) {
          const d = Math.hypot(x - head.x, y - head.y);
          if (!head.out && d < HEAD_SIZE * 0.9 && (!best || d < best.d)) best = { d, head };
        }
        return best && { kind: 'blackheads', head: best.head };
      }
      if (view.kind === 'scab') return Math.hypot(x - view.x, y - view.y) < SCAB_SIZE * 0.45 ? { kind: 'scab' } : null;
      if (view.kind === 'tick') {
        // Its body (origin 0.3 down it), and not much more: it sits right by someone's crops.
        const size = view.body.displayWidth;
        return Math.abs(x - view.x) < size * 0.45 && y > view.y - size * 0.3 && y < view.y + size * 0.7 ? { kind: 'tick' } : null;
      }
      let best = null;
      for (const crumb of view.crumbs.values()) {
        if (crumb.flicked) continue;
        const d = Math.hypot(x - crumb.x, y - crumb.y);
        if (d < crumb.size * 0.9 + 6 && (!best || d < best.d)) best = { d, crumb };
      }
      return best && { kind: 'gash', crumb: best.crumb };
    },

    // My own tap landing: something to see before the server answers.
    nudge(hit) {
      if (hit.kind === 'tick' && view?.kind === 'tick') view.wiggleUntil = scene.time.now + 160;
      if (hit.kind === 'gash' && hit.crumb && !hit.crumb.flicked) {
        scene.tweens.add({ targets: hit.crumb.image, rotation: hit.crumb.rest + 0.5, duration: 70, yoyo: true });
      }
    },

    // The ring that fills while a finger is held on The Scab or a blackhead: 0..1, or null to hide it.
    holding(at, k) {
      if (view?.kind !== 'scab' && view?.kind !== 'blackheads') return;
      view.ring.clear();
      if (!at) return;
      view.ring.lineStyle(7, 0x1a0a0d, 0.6).strokeCircle(at.x, at.y, 30);
      view.ring.lineStyle(5, 0xf3d27a, 1).beginPath()
        .arc(at.x, at.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k), false).strokePath();
    },

    // A tug on the hair, judged here (this screen's the one that sees the beat):
    // the beat it was on, or null for a slip.
    judgeTug(now) {
      if (view?.kind !== 'ingrown' || !event) return null;
      const beat = Math.round((now - event.startAt) / INGROWN.beatMs);
      const off = now - (event.startAt + beat * INGROWN.beatMs);
      const hit = beat >= 1 && Math.abs(off) <= INGROWN.window;
      view.call.setText(hit ? 'Tug!' : 'Slipped!').setColor(hit ? '#f3d27a' : '#ff8a7a').setAlpha(1).setPosition(view.x, view.y - 70);
      scene.tweens.killTweensOf(view.call);
      scene.tweens.add({ targets: view.call, y: view.y - 100, alpha: 0, duration: 700 });
      return hit ? beat : null;
    },

    // For a sound on each beat: the beat now, while there's a hair to tug.
    beat(now) {
      return view?.kind === 'ingrown' && event ? Math.floor((now - event.startAt) / INGROWN.beatMs) : null;
    },

    update(time, now, calm) {
      if (!view || !event) return;
      if (view.kind === 'ingrown') {
        // The throb: a ring closing in on the bump, landing on each beat.
        const into = (((now - event.startAt) % INGROWN.beatMs) + INGROWN.beatMs) % INGROWN.beatMs;
        const k = into / INGROWN.beatMs;
        const hit = Math.min(into, INGROWN.beatMs - into) <= INGROWN.window;
        view.ring.clear();
        view.ring.lineStyle(hit ? 6 : 4, hit ? 0xf3d27a : 0xffe8d6, hit ? 0.95 : 0.25 + 0.5 * k)
          .strokeCircle(view.x, view.y, INGROWN_SIZE * (0.42 + 0.6 * (1 - k)));
        const throb = calm ? 1 : 1 + 0.07 * Math.exp(-into / 120);
        if (!scene.tweens.isTweening(view.bump)) view.bump.setScale((INGROWN_SIZE / view.bump.width) * throb);
        // The hair coming out, longer the further along it is.
        const out = 10 + HAIR_OUT * event.progress;
        view.hair.clear().lineStyle(4, 0x24160f, 1).beginPath().moveTo(view.x + 20, view.y - 8);
        for (let i = 1; i <= 12; i++) {
          const d = (out * i) / 12;
          view.hair.lineTo(view.x + 20 + Math.cos(view.angle) * d - Math.sin(view.angle) * Math.sin(i * 0.8 + time * 0.004) * 4,
            view.y - 8 + Math.sin(view.angle) * d + Math.cos(view.angle) * Math.sin(i * 0.8 + time * 0.004) * 4);
        }
        view.hair.strokePath();
        const top = view.y - INGROWN_SIZE * 0.55;
        view.label.setPosition(view.x, top - BAR_H - 4);
        drawBar(view.bar, view.x, top, event.progress, 0xd8a070);
        return;
      }
      if (view.kind === 'blackheads' || view.kind === 'lint') return;
      if (view.kind === 'scab') {
        const wet = Math.max(0, Math.min(1, (event.ripeAt - now) / (SCAB.ripeMs * 0.5)));
        const dry = event.ripeAt <= now;
        view.glisten.setAlpha(wet * (0.35 + (calm ? 0 : 0.1 * Math.sin(time * 0.005))));
        const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0xffffff), Phaser.Display.Color.ValueToColor(0xff8a7a), 100, Math.round(wet * 100),
        );
        for (const piece of view.pieces) if (!piece.peeling) piece.setTint(Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b));
        // (Text only redrawn when it changes: setText skips the same text, setColor doesn't.)
        view.label.setText(dry ? 'The Scab · dry: hold to peel' : `The Scab · drying ${Math.ceil((event.ripeAt - now) / 1000)}s`);
        if (view.dry !== dry) {
          view.dry = dry;
          view.label.setColor(dry ? '#f3d27a' : '#ffd9c0');
        }
      } else if (view.kind === 'gash') {
        const loose = [...view.crumbs.values()].find((c) => !c.flicked && c.loose > now);
        view.loose.setVisible(Boolean(loose));
        for (const crumb of view.crumbs.values()) {
          if (crumb.flicked) continue;
          const shaking = crumb.loose > now;
          crumb.image.setRotation(crumb.rest + (shaking && !calm ? 0.25 * Math.sin(time * 0.05) : 0));
        }
        if (loose) view.loose.setPosition(loose.x, loose.y - 22);
      } else {
        // Swelling as it feeds.
        const fed = Math.min(1, (now - event.attachedAt) / TICK.lastsMs);
        const size = TICK_SIZE * (1 + 0.7 * fed) * (calm ? 1 : 1 + 0.03 * Math.sin(time * 0.004));
        if (!scene.tweens.isTweening(view.body)) {
          view.body.setScale(size / view.body.width).setRotation(time < view.wiggleUntil ? 0.18 * Math.sin(time * 0.08) : 0);
        }
        const top = view.y - size * 0.35 - 10;
        view.label.setPosition(view.x, top - BAR_H - 4);
        view.hands.setPosition(view.x, top - BAR_H - 24).setText(event.hands > 1 ? `${event.hands} hands ×${event.hands}` : '');
        drawBar(view.bar, view.x, top, 1 - event.progress, 0xb48cd8);
        // A red thread to each crop it's feeding on, with drops of it flowing back to The Tick.
        view.drain.clear();
        const pulse = calm ? 0.75 : 0.6 + 0.25 * Math.sin(time * 0.006);
        view.fed.forEach((crop, i) => {
          view.drain.lineStyle(7, 0x2a0006, 0.45).lineBetween(view.x, view.y, crop.x, crop.y);
          view.drain.lineStyle(3.5, 0xe0283c, pulse).lineBetween(view.x, view.y, crop.x, crop.y);
          view.drain.lineStyle(3, 0xe0283c, pulse).strokeCircle(crop.x, crop.y, 13);
          for (let d = 0; d < 2 && !calm; d++) {
            const k = (time * 0.0007 + i * 0.37 + d * 0.5) % 1;
            view.drain.fillStyle(0xff4a50, 0.9).fillCircle(crop.x + (view.x - crop.x) * k, crop.y + (view.y - crop.y) * k, 4);
          }
        });
      }
    },
  };
}
