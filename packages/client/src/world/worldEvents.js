import Phaser from 'phaser';
import { PLOT_SIZE, SCAB, TICK, TILE_SIZE } from '@hptm/shared';
import { textResolution } from '../display.js';
import { DEPTH, FONT, PLOT_PIXELS } from './layout.js';

// The world events after The Boil (see worldEvents.js in @hptm/shared), as
// everyone sees them: The Scab, peeled piece by piece off raw skin; The Gash,
// with its crumbs of crust; and The Tick, swelling as it feeds.
const SCAB_SIZE = 170;
const GASH_HEIGHT = 130;
const CRUMB_SIZE = 26;
const DEEP_SIZE = 34;
const TICK_SIZE = 84;
const BAR_W = 110;
const BAR_H = 9;
const LABEL = { fontFamily: FONT, fontSize: '16px', color: '#ffd9c0', stroke: '#1a0a0d', strokeThickness: 4 };

export function createEventViews(scene, fx) {
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

  // Crops of players who are here, near The Tick: it's feeding on them.
  function fedOn(state, now) {
    const crops = [];
    for (const [key, plot] of Object.entries(state.plots ?? {})) {
      const owner = state.players[plot.ownerId];
      if (!owner || owner.away) continue;
      const [px, py] = key.split(',').map(Number);
      plot.slots.forEach((crop, slot) => {
        if (!crop || crop.readyAt <= now) return;
        const x = px * PLOT_PIXELS + (slot % PLOT_SIZE + 0.5) * TILE_SIZE;
        const y = py * PLOT_PIXELS + (Math.floor(slot / PLOT_SIZE) + 0.5) * TILE_SIZE;
        if (Math.hypot(x - event.x, y - event.y) <= TICK.reach) crops.push({ x, y });
      });
    }
    return crops;
  }

  return {
    // `next`: the state's event, or null; `state` for The Tick's view of the plots.
    sync(next, state, now) {
      // Over without our hearing how (eventOver normally comes first): just let it go.
      if (view && (!next || next.kind !== view.kind || next.x !== view.x || next.y !== view.y)) this.fade();
      event = next;
      if (!next) return;
      if (!view) view = next.kind === 'scab' ? makeScab(next) : next.kind === 'gash' ? makeGash(next) : makeTick(next);

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
      } else {
        view.fed = state ? fedOn(state, now) : [];
      }
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
      const dying = view;
      view = null;
      event = null;
      const gone = (things, duration = 900) => scene.tweens.add({
        targets: things, alpha: 0, duration, onComplete: () => things.forEach((t) => t.destroy()),
      });
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

    // Gone without a proper ending (we missed it while away): fade out.
    fade() {
      if (!view) return;
      const things = [...view.things, ...(view.crumbs ? [...view.crumbs.values()].map((c) => c.image) : [])];
      view = null;
      scene.tweens.killTweensOf(things);
      scene.tweens.add({ targets: things, alpha: 0, duration: 600, onComplete: () => things.forEach((t) => t.destroy()) });
    },

    kind: () => view?.kind ?? null,
    position: () => (view ? { x: view.x, y: view.y } : null),

    // What's under a tap: { kind } for The Scab or The Tick, { kind: 'gash', crumb } for a crumb.
    at(x, y) {
      if (!view) return null;
      if (view.kind === 'scab') return Math.hypot(x - view.x, y - view.y) < SCAB_SIZE * 0.45 ? { kind: 'scab' } : null;
      if (view.kind === 'tick') {
        const size = view.body.displayWidth;
        return Math.abs(x - view.x) < size * 0.6 && y > view.y - size * 0.45 && y < view.y + size * 0.85 ? { kind: 'tick' } : null;
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

    // The ring that fills while a finger is held on The Scab: 0..1, or null to hide it.
    holding(at, k) {
      if (view?.kind !== 'scab') return;
      view.ring.clear();
      if (!at) return;
      view.ring.lineStyle(7, 0x1a0a0d, 0.6).strokeCircle(at.x, at.y, 30);
      view.ring.lineStyle(5, 0xf3d27a, 1).beginPath()
        .arc(at.x, at.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k), false).strokePath();
    },

    update(time, now, calm) {
      if (!view || !event) return;
      if (view.kind === 'scab') {
        const wet = Math.max(0, Math.min(1, (event.ripeAt - now) / (SCAB.ripeMs * 0.5)));
        const dry = event.ripeAt <= now;
        view.glisten.setAlpha(wet * (0.35 + (calm ? 0 : 0.1 * Math.sin(time * 0.005))));
        const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0xffffff), Phaser.Display.Color.ValueToColor(0xff8a7a), 100, Math.round(wet * 100),
        );
        for (const piece of view.pieces) if (!piece.peeling) piece.setTint(Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b));
        view.label.setText(dry ? 'The Scab · dry: hold to peel' : `The Scab · drying ${Math.ceil((event.ripeAt - now) / 1000)}s`);
        view.label.setColor(dry ? '#f3d27a' : '#ffd9c0');
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
        const left = 1 - event.progress;
        view.bar.clear();
        view.bar.fillStyle(0x1a0a0d, 0.85).fillRoundedRect(view.x - BAR_W / 2 - 2, top - BAR_H - 2, BAR_W + 4, BAR_H + 4, 5);
        view.bar.fillStyle(0xb48cd8, 1).fillRoundedRect(view.x - BAR_W / 2, top - BAR_H, Math.max(2, BAR_W * left), BAR_H, 4);
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
