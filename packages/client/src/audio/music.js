import { settings } from '../settings.js';

// The first game's two tracks, alternating, each fading out at its end and the next fading in.
const TRACKS = ['audio/theme.mp3', 'audio/music-box.mp3'];
const VOLUME = 0.32;
const FADE_OUT_S = 1.5;

const audio = new Audio();
audio.preload = 'none';
audio.volume = 0;
let track = 0;
let wanted = false;
let ending = false;
let fadeFrame = 0;

const url = (i) => `${import.meta.env.BASE_URL}${TRACKS[i]}`;

function fadeTo(volume, seconds = 0.8) {
  cancelAnimationFrame(fadeFrame);
  const from = audio.volume;
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / (seconds * 1000));
    audio.volume = Math.max(0, Math.min(1, from + (volume - from) * k));
    if (k < 1) fadeFrame = requestAnimationFrame(step);
    else if (volume === 0) audio.pause();
  };
  fadeFrame = requestAnimationFrame(step);
}

function play() {
  if (!wanted || !settings.get('music') || document.hidden) return;
  if (!audio.src) audio.src = url(track);
  audio.play().then(() => fadeTo(VOLUME, 2)).catch(() => {});
}

audio.addEventListener('timeupdate', () => {
  if (!ending && audio.duration && audio.duration - audio.currentTime < FADE_OUT_S) {
    ending = true;
    fadeTo(0.001, FADE_OUT_S);
  }
});
audio.addEventListener('ended', () => {
  ending = false;
  track = (track + 1) % TRACKS.length;
  audio.src = url(track);
  audio.volume = 0;
  play();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.pause();
  else play();
});

settings.onChange((name, on) => {
  if (name !== 'music') return;
  if (on) play();
  else fadeTo(0, 0.3);
});

export const music = {
  // Call from a user gesture: browsers block audio that starts on its own.
  start() {
    wanted = true;
    play();
  },
};
