import { isInviteCode } from '@hptm/shared';
import { SERVER_HTTP } from './server.js';

// Invite links: the game's address plus ?with=<the inviter's invite code>
// (their public id, signed by the server). The invite waits on this device
// until the new player first joins.
const KEY = 'hptm:invitedBy';
const GAME_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;

export const inviteLink = (code) => (isInviteCode(code) ? `${GAME_URL}?with=${code}` : GAME_URL);

// Called once at startup: keep the invite from the address, then tidy the
// address so a reload or a bookmark doesn't carry it around.
export function takeInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('with');
  if (!url.searchParams.has('with')) return;
  url.searchParams.delete('with');
  window.history.replaceState(null, '', url.href);
  if (!isInviteCode(code)) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Not remembered: the invite only lasts this visit.
  }
  pending = code;
}

let pending = null;

export function pendingInvite() {
  try {
    const code = pending ?? localStorage.getItem(KEY);
    return isInviteCode(code) ? code : null;
  } catch {
    return pending;
  }
}

export function forgetInvite() {
  pending = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

// Who the invite is from ({ name, here }), for the title screen.
export async function inviter(code) {
  try {
    const res = await fetch(`${SERVER_HTTP}/invite?with=${encodeURIComponent(code)}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
