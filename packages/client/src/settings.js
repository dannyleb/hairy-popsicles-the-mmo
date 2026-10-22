// Per-device preferences, remembered in localStorage when it's available.
const KEY = 'hptm:settings';
// Calm starts on for anyone whose phone already asks apps for less motion.
const prefersCalm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS = { sound: true, music: true, bubbles: true, haptics: true, calm: prefersCalm, zoom: 1, quality: 0, sharp: false };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const values = load();
const listeners = new Set();

// Calm: no screen shakes or flashes, and nothing on screen pulses forever.
function applyCalm() {
  document.documentElement.classList.toggle('calm', Boolean(values.calm));
}
applyCalm();
listeners.add((name) => {
  if (name === 'calm') applyCalm();
});

export const settings = {
  get(name) {
    return values[name];
  },
  set(name, value) {
    values[name] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(values));
    } catch {
      // Private mode or blocked storage: the setting lasts until the tab closes.
    }
    for (const listener of listeners) listener(name, value);
  },
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// One-off flags, like "has seen the tutorial".
export function remembered(flag) {
  try {
    return localStorage.getItem(`hptm:${flag}`) === '1';
  } catch {
    return false;
  }
}

export function remember(flag) {
  try {
    localStorage.setItem(`hptm:${flag}`, '1');
  } catch {
    // Not remembered; the player sees it again next time.
  }
}
