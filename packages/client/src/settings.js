// Per-device preferences, remembered in localStorage when it's available.
const KEY = 'hptm:settings';
const DEFAULTS = { sound: true, music: true, bubbles: true };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const values = load();
const listeners = new Set();

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
