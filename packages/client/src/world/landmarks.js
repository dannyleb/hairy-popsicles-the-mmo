import { CHARACTERS, LANDMARKS } from '@hptm/shared';
import { textResolution } from '../display.js';
import { DEPTH, EVENT_TINT, FONT, NIGHT_TINT, inLight } from './layout.js';

// The world's landmarks, on plots nobody can farm (LANDMARKS in @hptm/shared):
// the Navel in the middle, a giant Eye that watches whoever's nearest and
// blinks, and a bone statue of whoever has collected the most characters.
const NAVEL_SIZE = 300;
// px: the socket's opening is 62% of its width across and 30% of it tall (see eye_socket in tools/world.py).
const EYE = { socket: 300, ball: 196, iris: 84, lid: 204, open: 90, reach: 46, look: 520 };
const BLINK = { every: [2500, 6500], close: 90, shut: 50, open: 150 };
const POKED_MS = 1100;
const PLINTH_WIDTH = 120;
const FIGURE = 128;
const BONE = [[66, 44, 30], [242, 220, 176]];  // the statue's darkest and lightest ivory, like its plinth
const EYE_WHITE = 0xd4c6ba;  // between the world's light and white, so the Eye still stands out
const EYE_IRIS = inLight(0xf4ece4);

// A bone copy of a character's art: its shading kept, its colors gone.
function boneTexture(scene, characterId) {
  const key = `statue:${characterId}`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get(`char:${characterId}`).getSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0);
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const light = Math.min(1, ((0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255) * 1.15);
    for (let c = 0; c < 3; c++) px[i + c] = BONE[0][c] + (BONE[1][c] - BONE[0][c]) * light;
  }
  g.putImageData(image, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}

export function createLandmarks(scene) {
  const navelAt = LANDMARKS.navel;
  const navel = scene.add.image(navelAt.x, navelAt.y, 'world:navel').setTint(NIGHT_TINT).setDepth(DEPTH.decor + 2);
  navel.setScale(NAVEL_SIZE / navel.width);

  // The white and the iris sit under the lids and show through their opening;
  // the upper lid comes down over them, from behind the skin above.
  const eyeAt = LANDMARKS.eye;
  const ball = scene.add.image(eyeAt.x, eyeAt.y, 'world:eye-ball').setTint(EYE_WHITE).setDepth(DEPTH.decor + 2);
  ball.setScale(EYE.ball / ball.width);
  const iris = scene.add.image(eyeAt.x, eyeAt.y, 'world:eye-iris').setTint(EYE_IRIS).setDepth(DEPTH.decor + 3);
  iris.setScale(EYE.iris / iris.width);
  const lid = scene.add.image(eyeAt.x, eyeAt.y - EYE.open / 2 - 5, 'world:eye-lid').setOrigin(0.5, 0)
    .setTint(NIGHT_TINT).setDepth(DEPTH.decor + 4).setVisible(false);
  lid.scaleX = EYE.lid / lid.width;
  const socket = scene.add.image(eyeAt.x, eyeAt.y, 'world:eye-socket').setTint(NIGHT_TINT).setDepth(DEPTH.decor + 5);
  socket.setScale(EYE.socket / socket.width);
  const eye = { lookX: 0, lookY: 0, blinkAt: 2000, pokedUntil: 0, wander: Math.random() * 1000 };

  // The statue stands near the bottom of its block, facing the Navel.
  const statueAt = LANDMARKS.statue;
  const baseY = statueAt.y + 70;
  const plinth = scene.add.image(statueAt.x, baseY, 'world:plinth').setOrigin(0.5, 1).setTint(EVENT_TINT).setDepth(baseY);
  plinth.setScale(PLINTH_WIDTH / plinth.width);
  const feetY = baseY - plinth.displayHeight * 0.76;  // the middle of its top (see plinth in tools/world.py)
  const figure = scene.add.image(statueAt.x, feetY + 4, '__WHITE').setOrigin(0.5, 1).setDepth(baseY + 0.5).setVisible(false);
  const text = (size, color) => ({ fontFamily: FONT, fontSize: `${size}px`, color, resolution: textResolution(), align: 'center' });
  const name = scene.add.text(statueAt.x, baseY + 4, '', text(17, '#f3e6d4')).setOrigin(0.5, 0)
    .setShadow(0, 1, '#000', 4, false, true).setDepth(baseY + 1).setVisible(false);
  const caption = scene.add.text(statueAt.x, baseY + 24, '', text(13, '#c9b39e')).setOrigin(0.5, 0)
    .setShadow(0, 1, '#000', 3, false, true).setDepth(baseY + 1).setVisible(false);
  let statue;  // undefined until the server says (the menu never knows)
  let navelHeaveUntil = 0;

  const near = (x, y, at, w, h) => Math.abs(x - at.x) < w && Math.abs(y - at.y) < h;

  return {
    // `subject`: the statue's { name, avatar, album, color }, or null while nobody's earned it.
    setStatue(subject, myPid) {
      const key = subject ? `${subject.pid}|${subject.name}|${subject.avatar}|${subject.album}|${subject.color}|${subject.pid === myPid}` : 'none';
      if (statue?.key === key) return;
      statue = { ...subject, key, mine: Boolean(subject) && subject.pid === myPid };
      name.setVisible(true);
      caption.setVisible(true);
      if (!subject) {
        figure.setVisible(false);
        name.setText('This plinth is empty').setColor('#f3e6d4');
        caption.setText('Collect the most characters to stand here');
        return;
      }
      figure.setTexture(boneTexture(scene, subject.avatar)).setVisible(true);
      figure.setScale(FIGURE / figure.width);
      name.setText(statue.mine ? `${subject.name} (you!)` : subject.name).setColor(subject.color ?? '#f3e6d4');
      caption.setText(`Top collector · ${subject.album} of ${CHARACTERS.length}`);
    },

    statue: () => statue ?? null,

    setBloodMoon(on) {
      iris.setTint(on ? 0xff7060 : EYE_IRIS);   // a Blood Moon lights it up
      ball.setTint(on ? 0xf0b0a8 : EYE_WHITE);
    },

    // `walkers`: anyone about ({ x, y }), for the Eye to watch.
    update(time, walkers, calm) {
      // Breathing, or (when it's gurgling and coughing up lint) heaving.
      const heave = time < navelHeaveUntil ? 0.06 * Math.sin(time * 0.03) * ((navelHeaveUntil - time) / 900) : 0;
      if (!calm) navel.setScale((NAVEL_SIZE / navel.width) * (1 + 0.012 * Math.sin(time * 0.0009) + heave));

      const view = scene.cameras.main.worldView;
      if (Math.abs(eyeAt.x - view.centerX) > view.width / 2 + 200 || Math.abs(eyeAt.y - view.centerY) > view.height / 2 + 200) return;
      // Look at whoever's nearest, or idly about when nobody is.
      let target = null;
      let best = EYE.look;
      for (const w of walkers) {
        const d = Math.hypot(w.x - eyeAt.x, w.y - eyeAt.y);
        if (d < best) {
          best = d;
          target = w;
        }
      }
      let lookX;
      let lookY;
      if (target) {
        const pull = Math.min(1, best / 160);
        lookX = ((target.x - eyeAt.x) / (best || 1)) * pull;
        lookY = ((target.y - eyeAt.y) / (best || 1)) * pull;
      } else {
        const t = time * 0.0004 + eye.wander;
        lookX = 0.7 * Math.sin(t) * Math.sin(t * 0.37);
        lookY = 0.5 * Math.sin(t * 1.3);
      }
      eye.lookX += (lookX - eye.lookX) * 0.08;
      eye.lookY += (lookY - eye.lookY) * 0.08;
      iris.setPosition(eyeAt.x + eye.lookX * EYE.reach, eyeAt.y + eye.lookY * 7);
      ball.setPosition(eyeAt.x + eye.lookX * 6, eyeAt.y + eye.lookY * 2);

      // How shut it is: 0 open, 1 closed.
      let shut = 0;
      if (time < eye.pokedUntil) {
        shut = 1;
      } else {
        const t = time - eye.blinkAt;
        const { close, shut: hold, open } = BLINK;
        if (t >= 0 && t < close) shut = t / close;
        else if (t >= close && t < close + hold) shut = 1;
        else if (t >= close + hold && t < close + hold + open) shut = 1 - (t - close - hold) / open;
        else if (t >= close + hold + open) eye.blinkAt = time + BLINK.every[0] + Math.random() * (BLINK.every[1] - BLINK.every[0]);
      }
      lid.setVisible(shut > 0.02);
      if (shut > 0.02) lid.scaleY = ((EYE.open + 12) * shut) / lid.height;
      socket.setScale((EYE.socket / socket.width) * (time < eye.pokedUntil ? 0.97 : 1));
    },

    // Which landmark is under a tap, if any.
    at(x, y) {
      if (near(x, y, navelAt, 45, 40)) return 'navel';
      if (near(x, y, eyeAt, EYE.socket * 0.31, EYE.open / 2 + 8)) return 'eye';
      if (Math.abs(x - statueAt.x) < PLINTH_WIDTH / 2 && y < baseY + 40 && y > feetY - (figure.visible ? FIGURE : 0)) return 'statue';
      return null;
    },

    // The Navel gurgles or coughs (Navel Lint): it heaves for a moment. Returns where it is.
    heave(time, ms = 900) {
      navelHeaveUntil = time + ms;
      return { x: navelAt.x, y: navelAt.y };
    },

    // A finger in the Eye: it screws itself shut for a moment.
    poke(time) {
      eye.pokedUntil = time + POKED_MS;
      eye.blinkAt = time + POKED_MS + 1500;
      return { x: eyeAt.x, y: eyeAt.y };
    },
  };
}
