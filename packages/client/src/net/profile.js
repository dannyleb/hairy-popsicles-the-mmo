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

// What the save says, for the menu. Not verified: only the server can check it.
export function peekProfile() {
  const token = savedProfile();
  if (!token) return null;
  try {
    const base64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
