import { createServer } from 'http';
import colyseus from 'colyseus';
import wsTransport from '@colyseus/ws-transport';
import { WorldRoom } from './rooms/WorldRoom.js';

const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('world', WorldRoom);

httpServer.listen(port, () => {
  console.log(`Hairy Popsicles MMO server listening on ws://localhost:${port}`);
});
