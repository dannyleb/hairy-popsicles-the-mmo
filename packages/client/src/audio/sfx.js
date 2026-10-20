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

function burst(freq, q, dur, peak, type = 'lowpass', delay = 0) {
  const t = ctx.currentTime + delay;
  const source = noise();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  source.connect(filter);
  envelope(filter, t, peak, 0.004, dur);
  const length = Math.min(dur + 0.05, NOISE_SECONDS);
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
};

export const sfx = Object.fromEntries(
  Object.entries(SOUNDS).map(([name, play]) => [name, (...args) => { if (ready()) play(...args); }]),
);
