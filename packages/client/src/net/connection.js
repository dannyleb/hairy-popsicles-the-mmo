import { Client } from 'colyseus.js';
import { savedProfile } from './profile.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';

const client = new Client(SERVER_URL);

// The server sends a few messages as soon as we join, before the world scene
// has its handlers; it asks for them again with 'sync', so drop them quietly.
function quiet(room) {
  room.onMessage('*', () => {});
  return room;
}

export async function connect(playerName) {
  return quiet(await client.joinOrCreate('world', { name: playerName, profile: savedProfile() }));
}

// Back into the same seat after the socket dropped (phones do this whenever the
// app goes to the background). The server holds the seat for a minute or so.
export async function reconnect(token) {
  return quiet(await client.reconnect(token));
}
