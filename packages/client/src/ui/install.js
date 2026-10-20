import { remember, remembered } from '../settings.js';
import { button, el } from './dom.js';

// "Add to Home Screen": a full-screen icon makes a web game feel like an app,
// and a lot more likely to get opened again. Offered once, on a later visit,
// after a minute of play, never to someone who already installed it.
const VISITS_KEY = 'hptm:visits';
const DELAY_MS = 60_000;
const FROM_VISIT = 2;

let installPrompt = null;  // Chrome/Android hand us this; iOS has no equivalent
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function visits() {
  try {
    return Number(localStorage.getItem(VISITS_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function countVisit() {
  try {
    localStorage.setItem(VISITS_KEY, String(visits() + 1));
  } catch {
    // Not counted: the hint just never shows.
  }
}

export function offerInstallLater() {
  if (installed() || remembered('installHintDone') || visits() < FROM_VISIT) return;
  setTimeout(() => {
    if (!installPrompt && !isIos()) return;
    const card = el('div', 'install-hint');
    const text = installPrompt
      ? 'Put Hairy Popsicles on your home screen?'
      : 'Put it on your home screen: tap Share, then "Add to Home Screen".';
    const done = () => {
      remember('installHintDone');
      card.remove();
    };
    const actions = el('div', 'install-actions');
    if (installPrompt) {
      actions.append(button('install-button primary', 'Add it', async () => {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        installPrompt = null;
        done();
      }));
    }
    actions.append(button('install-button', installPrompt ? 'Not now' : 'Got it', done));
    card.append(el('p', null, text), actions);
    document.body.append(card);
  }, DELAY_MS);
}
