// The player's save: signed by the server, kept on this device, sent back on join.
const KEY = 'hptm:profile';

export function savedProfile() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeProfile(token) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Private mode or blocked storage: progress lasts until the tab closes.
  }
}

export function forgetProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to forget.
  }
}

// What a save code says, or null if it isn't one. Not verified: only the
// server can check the signature, so this is only ever a hint for the menu.
export function readSaveCode(token) {
  if (typeof token !== 'string' || !/^[\w-]+\.[\w-]{20,}$/.test(token)) return null;
  try {
    const base64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const save = JSON.parse(new TextDecoder().decode(bytes));
    return save && typeof save === 'object' && !Array.isArray(save) && typeof save.id === 'string' ? save : null;
  } catch {
    return null;
  }
}

export const peekProfile = () => readSaveCode(savedProfile());
