import { settings } from '../settings.js';

// Procedural sound effects (Web Audio, no files), after the first game's src/sfx.js.
// unlock() must run inside a real user gesture or phones stay silent.
let ctx = null;
let master = null;

export function unlock() {
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
}

// Going quiet while hidden also recovers iOS's "interrupted" audio state on return.
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

// One shared buffer of white noise; each sound plays a slice of it.
const NOISE_SECONDS = 2;
let noiseBuffer = null;
function noise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  return source;
}

function envelope(node, t, peak, attack, release) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  node.connect(gain);
  gain.connect(master);
}

function tone(type, f0, f1, dur, peak = 0.4, delay = 0) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  envelope(osc, t, peak, 0.01, dur);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function burst(freq, q, dur, peak, type = 'lowpass', delay = 0, attack = 0.004) {
  const t = ctx.currentTime + delay;
  const source = noise();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  source.connect(filter);
  envelope(filter, t, peak, attack, dur);
  const length = Math.min(attack + dur + 0.05, NOISE_SECONDS);
  source.start(t, Math.random() * (NOISE_SECONDS - length), length);
}

const ready = () => ctx && ctx.state === 'running' && settings.get('sound');

// Rarity steps the harvest pop up the scale.
const RARITY_PITCH = { common: 1, uncommon: 1.25, rare: 1.5, legendary: 2 };

const SOUNDS = {
  // One squelchy footstep on skin.
  step() {
    burst(380 + Math.random() * 380, 6, 0.1, 0.16, 'bandpass');
    tone('sine', 140 + Math.random() * 50, 55, 0.1, 0.14);
  },
  // Tearing open a new plot.
  claim() {
    burst(700, 3, 0.4, 0.6);
    tone('sawtooth', 140, 45, 0.35, 0.22);
  },
  plant() {
    tone('sine', 1400, 500, 0.12, 0.25);
    tone('sine', 220, 90, 0.16, 0.35, 0.05);
  },
  harvest(rarity = 'common') {
    const k = RARITY_PITCH[rarity] ?? 1;
    tone('sine', 600 * k, 1400 * k, 0.08, 0.45);
    burst(3000, 1, 0.05, 0.35, 'highpass');
  },
  // A music-box chime: something new for the album.
  discover() {
    [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.35, 0.18, i * 0.09));
  },
  // A wet fanfare for a legendary or a level up.
  fanfare() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone('square', f, f * 1.01, 0.18, 0.1, i * 0.07));
    burst(1500, 1.5, 0.6, 0.3, 'bandpass', 0.1);
  },
  quest() {
    tone('triangle', 660, 660, 0.08, 0.22);
    tone('triangle', 990, 990, 0.2, 0.22, 0.08);
  },
  squeeze() {
    burst(900, 4, 0.25, 0.5, 'bandpass');
    tone('sine', 300, 120, 0.12, 0.3);
    for (let i = 0; i < 3; i++) tone('sine', 1100 + Math.random() * 900, 600, 0.04, 0.07, 0.05 + i * 0.05);
  },
  hit(crit = false) {
    burst(1800, 0.8, 0.08, crit ? 0.9 : 0.6, 'bandpass');
    tone('sine', crit ? 240 : 180, 60, 0.12, crit ? 0.6 : 0.4);
  },
  // The Boil bursting.
  splat() {
    burst(700, 2, 0.7, 0.9);
    burst(1800, 2, 0.4, 0.4, 'bandpass', 0.05);
    tone('sawtooth', 120, 40, 0.5, 0.3);
    for (let i = 0; i < 6; i++) tone('sine', 900 + Math.random() * 900, 300, 0.06, 0.1, 0.1 + i * 0.07);
  },
  // Something big swelling under the skin.
  rumble() {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.linearRampToValueAtTime(48, t + 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    osc.connect(filter);
    envelope(filter, t, 0.5, 0.25, 1.1);
    osc.start(t);
    osc.stop(t + 1.5);
  },
  // Slurping up a glob of pus; gold ones sound richer.
  bloop(gold = false) {
    const f = gold ? 620 : 380;
    tone('sine', f, f * 1.7, 0.08, 0.3);
    if (gold) [988, 1319].forEach((g, i) => tone('triangle', g, g, 0.12, 0.12, 0.06 + i * 0.06));
  },
  // Fingernails on skin: The Itch starting.
  scratch() {
    for (let i = 0; i < 5; i++) burst(2400 + Math.random() * 1600, 2, 0.07, 0.3, 'bandpass', i * 0.09);
  },
  chat() {
    tone('triangle', 900 + Math.random() * 200, 1300, 0.05, 0.14);
  },
  emote() {
    const f = 90 + Math.random() * 120;
    tone('sawtooth', f, f * 0.7, 0.18, 0.16);
  },
  nope() {
    tone('square', 160, 120, 0.12, 0.12);
  },
  click() {
    tone('triangle', 900, 1200, 0.04, 0.12);
  },
  // A mite under a fingertip.
  squish() {
    burst(1800, 4, 0.05, 0.3, 'bandpass');
    tone('sine', 900, 300, 0.05, 0.12);
  },
  // A flea springing off.
  boing() {
    tone('sine', 500, 1600, 0.09, 0.14);
  },
  // Someone napping, poked.
  snore() {
    burst(220, 3, 0.45, 0.22, 'bandpass');
    tone('sawtooth', 70, 55, 0.4, 0.06);
  },
  // Something deep in the Navel (or the Armpit): three wet bubbles, each lower.
  gurgle(volume = 1) {
    for (let i = 0; i < 3; i++) {
      tone('sine', 260 - i * 50, 120 - i * 25, 0.1, 0.16 * volume, i * 0.11);
      burst(500 - i * 90, 6, 0.08, 0.08 * volume, 'bandpass', i * 0.11);
    }
  },

  // ---- ambience (see ambience.js): quiet, and played by where you are
  // The world's heart, under the Navel: lub-dub.
  heartbeat(volume = 1) {
    tone('sine', 70, 42, 0.16, 0.5 * volume);
    burst(160, 1, 0.1, 0.25 * volume);
    tone('sine', 60, 38, 0.2, 0.36 * volume, 0.24);
    burst(140, 1, 0.12, 0.18 * volume, 'lowpass', 0.24);
  },
  // A breath of hairs brushing together in the Scalp.
  rustle(volume = 1) {
    burst(3200 + Math.random() * 1500, 0.8, 0.9, 0.035 * volume, 'bandpass', 0, 0.5);
  },
  // An itchy wind going by.
  gust(volume = 1) {
    burst(380 + Math.random() * 300, 0.9, 1.6, 0.09 * volume, 'bandpass', 0, 0.8);
  },
  // Something small chirping in the dark.
  chirp(volume = 1) {
    const pitch = 3600 + Math.random() * 900;
    for (let i = 0; i < 3; i++) tone('sine', pitch, pitch * 0.96, 0.03, 0.045 * volume, i * 0.07);
  },
  // A finger in the Eye: a wet squelch and an offended low groan.
  poke() {
    burst(1200, 3, 0.07, 0.3, 'bandpass');
    tone('sawtooth', 140, 90, 0.35, 0.07, 0.05);
  },
  // ---- world events
  // A piece of scab coming away: a dry, crackling rip.
  peel() {
    for (let i = 0; i < 5; i++) burst(1800 + Math.random() * 2400, 2, 0.03, 0.22, 'bandpass', i * 0.035);
    burst(900, 1, 0.12, 0.1, 'bandpass', 0.02);
  },
  // Torn off too soon: the rip, and a wet splat.
  tear() {
    for (let i = 0; i < 4; i++) burst(1500 + Math.random() * 2000, 2, 0.03, 0.2, 'bandpass', i * 0.03);
    burst(400, 1, 0.18, 0.3, 'lowpass', 0.1);
  },
  // A crumb of crust flicked out.
  crunch() {
    burst(3000, 3, 0.025, 0.25, 'bandpass');
    tone('triangle', 1400, 900, 0.04, 0.08, 0.01);
  },
  // Working at The Tick: a creak.
  pry() {
    tone('sawtooth', 120 + Math.random() * 40, 90, 0.09, 0.06);
    burst(700, 4, 0.05, 0.08, 'bandpass');
  },
  // The Tick coming off: a pop and a squelch.
  pop() {
    tone('sine', 300, 900, 0.06, 0.3);
    burst(500, 1, 0.2, 0.3, 'lowpass', 0.05);
  },
  // An Ingrown Hair's throb, on the beat.
  beat() {
    tone('sine', 110, 70, 0.12, 0.12);
  },
  // A tug on the hair, on the beat: a stretchy twang.
  tug() {
    tone('triangle', 220, 520, 0.12, 0.16);
  },
  // Off the beat: it slips back.
  slip() {
    tone('sawtooth', 300, 120, 0.2, 0.08);
  },
  // A blackhead squeezed: a slow, wet extrusion.
  squelch() {
    burst(700, 2, 0.25, 0.25, 'bandpass', 0, 0.06);
    tone('sine', 180, 90, 0.25, 0.1, 0.05);
  },
  // The Navel coughing up lint.
  cough() {
    burst(300, 1, 0.3, 0.45, 'lowpass');
    burst(900, 1.5, 0.15, 0.2, 'bandpass', 0.05);
  },
  // The Gash zipping shut.
  zip() {
    for (let i = 0; i < 12; i++) burst(2500 + i * 150, 6, 0.02, 0.12, 'bandpass', i * 0.04);
  },
  // A stray, poked: a little squeak, pitched by who it is.
  squeak(pitch = 1) {
    tone('triangle', 700 * pitch, 1100 * pitch, 0.07, 0.16);
    tone('triangle', 1100 * pitch, 800 * pitch, 0.06, 0.12, 0.07);
  },
};

// A buzz to go with some sounds, on phones that can (Android; iPhones can't).
const BUZZ = {
  claim: 40,
  plant: 10,
  harvest: 18,
  squeeze: 25,
  hit: 12,
  splat: [60, 40, 140],
  fanfare: [40, 60, 40, 60, 110],
  bloop: 14,
  scratch: [20, 60, 20, 60, 20],
  nope: [15, 40, 15],
  squish: 12,
  poke: 25,
  peel: 15,
  tear: [20, 40, 30],
  crunch: 8,
  pry: 10,
  pop: [30, 50, 60],
  tug: 12,
  squelch: 20,
  cough: 30,
};
const canBuzz = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const hasHaptics = canBuzz;

function buzz(name) {
  if (!canBuzz || !settings.get('haptics') || !BUZZ[name]) return;
  try {
    navigator.vibrate(BUZZ[name]);
  } catch {
    // Some browsers refuse before the first tap; nothing to do.
  }
}

export const sfx = Object.fromEntries(
  Object.entries(SOUNDS).map(([name, play]) => [name, (...args) => {
    buzz(name);
    if (ready()) play(...args);
  }]),
);
