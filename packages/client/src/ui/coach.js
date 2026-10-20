import { remember, remembered } from '../settings.js';
import { el } from './dom.js';

// First-session hints, one at a time, driven by what the player has done so far.
const STEPS = {
  claim: 'Tap the glowing spot to make a plot of your own.',
  plant: 'This patch of skin is yours. Tap a hole to plant a seed.',
  wait: "Something's growing in there! Plant the other holes too.",
  harvest: 'Ripe! Tap it to pull it out.',
  album: "They're in your Album now. Tap the book (top right) to see them, and to play as one.",
};

const TIP_MS = 7000;

export function createCoach() {
  const root = el('div', 'coach');
  root.hidden = true;
  let current = null;
  let done = remembered('coached');
  let tipTimer = 0;

  function display(text) {
    root.textContent = text;
    root.hidden = false;
    root.classList.remove('pop');
    void root.offsetWidth;
    root.classList.add('pop');
  }

  return {
    root,

    // A one-time tip the first time something new turns up, after the first-session steps.
    // One at a time: a tip that turns up while another shows waits its turn.
    tip(key, text) {
      if (!done || tipTimer || remembered(`tip:${key}`)) return;
      remember(`tip:${key}`);
      display(text);
      tipTimer = setTimeout(() => {
        root.hidden = true;
        tipTimer = 0;
      }, TIP_MS);
    },

    // `step` is a key of STEPS, 'done' to finish for good, or null to hide for now.
    show(step) {
      if (done || step === current) return;
      current = step;
      if (step === 'done') {
        done = true;
        remember('coached');
        root.hidden = true;
        return;
      }
      root.hidden = !step;
      if (step) display(STEPS[step]);
    },
  };
}
