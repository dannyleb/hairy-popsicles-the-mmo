import { remember, remembered } from '../settings.js';
import { el } from './dom.js';

// First-session hints, one at a time, driven by what the player has done so far.
const STEPS = {
  claim: 'Tap open ground to claim your plot.',
  plant: 'Tap a hole in your plot to plant a seed.',
  wait: "Its shadow grows in the hole. Rarer characters take longer. Plant the other holes while you wait.",
  harvest: 'Ripe! Tap it to pull it out.',
  album: 'Open your Album (top right) to play as anyone you grow.',
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
