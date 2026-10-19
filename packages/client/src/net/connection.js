import { Client } from 'colyseus.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';

let room = null;

export async function connect(playerName) {
  const client = new Client(SERVER_URL);
  room = await client.joinOrCreate('world', { name: playerName });
  return room;
}

export function getRoom() {
  return room;
}
