import { Client } from 'colyseus.js';
import { forgetInvite, pendingInvite } from './invite.js';
import { savedProfile } from './profile.js';
import { SERVER_URL } from './server.js';

const client = new Client(SERVER_URL);

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
  const room = quiet(await client.joinOrCreate('world', { name: playerName, profile, invitedBy }));
  forgetInvite();
  return room;
}

// Back into the same seat after the socket dropped (phones do this whenever the
// app goes to the background). The server holds the seat for a minute or so.
export async function reconnect(token) {
  return quiet(await client.reconnect(token));
}
