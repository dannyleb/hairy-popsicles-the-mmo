// Pals: players you've marked from their card, remembered on this device by
// their public id, so you see when they're around.
const KEY = 'hptm:pals';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

const pals = load();  // public id → last name seen

function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pals));
  } catch {
    // Not remembered past this visit.
  }
}

export const isPal = (pid) => Boolean(pid) && Object.hasOwn(pals, pid);

export function togglePal(pid, name) {
  if (!pid) return false;
  if (isPal(pid)) delete pals[pid];
  else pals[pid] = name;
  store();
  return isPal(pid);
}

// Keep the name current when a pal renames themselves.
export function notePal(pid, name) {
  if (isPal(pid) && pals[pid] !== name) {
    pals[pid] = name;
    store();
  }
}
