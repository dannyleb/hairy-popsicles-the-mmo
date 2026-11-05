import { Client } from 'colyseus.js';
import { forgetInvite, pendingInvite } from './invite.js';
import { settings } from '../settings.js';
import { savedProfile } from './profile.js';
import { SERVER_URL } from './server.js';

const client = new Client(SERVER_URL);
// The phone's note that it was banned for abusive chat (as the public id it
// played as), sent with each join: the server turns a fresh save away too.
const BANNED_KEY = 'hptm:banned';

export function noteBanned(pid) {
  try {
    localStorage.setItem(BANNED_KEY, pid);
  } catch {
    // Not remembered: the server still knows the save.
  }
}

function bannedAs() {
  try {
    return localStorage.getItem(BANNED_KEY);
  } catch {
    return null;
  }
}

// The server sends a few messages as soon as we join, before the world scene
// has its handlers; it asks for them again with 'sync', so drop them quietly.
function quiet(room) {
  room.onMessage('*', () => {});
  return room;
}

export async function connect(playerName) {
  const profile = savedProfile();
  // An invite only counts for someone new; either way it's used up by joining.
  const invitedBy = profile ? null : pendingInvite();
  const appearOffline = settings.get('appearOffline') === true;
  const room = quiet(await client.joinOrCreate('world', { name: playerName, profile, invitedBy, appearOffline, bannedAs: bannedAs() }));
  forgetInvite();
  // In: any ban has been lifted.
  try {
    localStorage.removeItem(BANNED_KEY);
  } catch {
    // Nothing to forget.
  }
  return room;
}

// Back into the same seat after the socket dropped (phones do this whenever the
// app goes to the background). The server holds the seat for a minute or so.
export async function reconnect(token) {
  return quiet(await client.reconnect(token));
}
