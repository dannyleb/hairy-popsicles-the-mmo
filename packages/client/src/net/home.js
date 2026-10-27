import { NAME_MAX } from '@hptm/shared';
import { settings } from '../settings.js';
import { mergePals } from '../ui/pals.js';
import { peekProfile, readSaveCode, storeProfile } from './profile.js';

// The game's home moved to hairypopsicles.com/the-mmo/ from
// dannyleb.github.io/hairy-popsicles-the-mmo/ (hairypopsicles.com itself is
// the hub, site/, which sends old links on to the game). A save lives in the browser's
// storage for the address it was made at, so it has to be carried across:
// - A copy still running at the old address (from a phone's offline cache)
//   checks whether the new home is up; once it is, it hands its save over and
//   moves there.
// - The new home takes a save handed to it after # in its address (which
//   never leaves the phone): from the old address, or from the bridge page on
//   the first game's site, which shares the old address's storage.
// Either way a save here is never replaced without the player saying so.
export const HOME = new URL(import.meta.env.VITE_HOME_URL || 'https://hairypopsicles.com/the-mmo/');
const OLD_HOME = new URL(import.meta.env.VITE_OLD_HOME_URL || 'https://dannyleb.github.io/hairy-popsicles-the-mmo/');
export const BRIDGE = import.meta.env.VITE_SAVE_BRIDGE || 'https://dannyleb.github.io/hairy-popsicles-the-game/mmo-save.html';
const CARRIED = ['hptm:profile', 'hptm:pals', 'hptm:name', 'hptm:settings', 'hptm:invitedBy'];

export const atNewHome = () => location.origin === HOME.origin;
const atOldHome = () => location.origin === OLD_HOME.origin && location.pathname.startsWith(OLD_HOME.pathname);

const encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (code) => new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const parsed = (json) => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

// At the old address: once the new home is up (serving this game from its
// path there), hand the save over and go. An invite link keeps its ?with= (read now,
// before the invite is tidied out of the address).
export async function moveIfHomeIsUp() {
  if (!atOldHome()) return;
  const search = location.search;
  try {
    const res = await fetch(new URL('home.json', HOME), { cache: 'no-store' });
    const home = res.ok ? await res.json() : null;
    if (home?.game !== 'hairy-popsicles-mmo' || home.base !== HOME.pathname) return;
  } catch {
    return;  // not up yet
  }
  // The offline cache would keep serving this old copy here; the address
  // itself now forwards to the new home.
  const workers = await navigator.serviceWorker?.getRegistrations?.().catch(() => []) ?? [];
  await Promise.all(workers.map((worker) => worker.unregister()));
  const carry = Object.fromEntries(CARRIED.map((key) => [key, read(key)]).filter(([, value]) => value != null));
  const url = new URL(HOME);
  url.search = search;
  url.hash = `carry=${encode(JSON.stringify(carry))}`;
  location.replace(url.href);
}

// What arrived, for the title screen: 'carried' (the save is here now),
// 'choose' (a save was here already: the player picks, see pendingSave),
// 'nothing' (none at the old address), or null.
export let arrival = null;
let pending = null;  // { token, save } waiting on the player's choice

// At the new home, first thing: anything handed over after #carry=.
export function takeCarried() {
  const match = /(?:^#|&)carry=([^&]*)/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);  // out of the address bar straight away
  // The bridge page found nothing to bring.
  if (match[1] === 'none') {
    arrival = 'nothing';
    return;
  }
  let carried = null;
  try {
    carried = parsed(decode(match[1]));
  } catch {
    carried = null;
  }
  if (!carried) return;
  // No save in it: someone new who came by the old address (maybe with an invite).
  const token = carried['hptm:profile'];
  const save = readSaveCode(token);
  if (save && peekProfile()?.id === save.id) {
    arrival = 'carried';  // the same save, already here
  } else if (save && !peekProfile()) {
    storeProfile(token);
    arrival = 'carried';
  } else if (save) {
    pending = { token, save };
    arrival = 'choose';
  }
  mergePals(parsed(carried['hptm:pals']) ?? {});
  if (!read('hptm:invitedBy') && typeof carried['hptm:invitedBy'] === 'string' && !peekProfile()) {
    try {
      localStorage.setItem('hptm:invitedBy', carried['hptm:invitedBy'].slice(0, 64));  // checked when read (net/invite.js)
    } catch {
      // The invite only lasts this visit.
    }
  }
  if (!read('hptm:name') && typeof carried['hptm:name'] === 'string') {
    try {
      localStorage.setItem('hptm:name', carried['hptm:name'].slice(0, NAME_MAX));
    } catch {
      // Not remembered; the name comes back with the save anyway.
    }
  }
  // Settings only if this device has none of its own yet (Appear offline among them).
  if (!read('hptm:settings')) {
    for (const [name, value] of Object.entries(parsed(carried['hptm:settings']) ?? {})) {
      if (typeof value === typeof settings.get(name)) settings.set(name, value);
    }
  }
}

export const pendingSave = () => pending?.save ?? null;

// The player chose: use the save from the old address (replacing this one), or keep this one.
export function choosePending(useIt) {
  if (useIt && pending) storeProfile(pending.token);
  pending = null;
  arrival = useIt ? 'carried' : null;
}
