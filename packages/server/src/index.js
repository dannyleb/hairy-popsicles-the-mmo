import { createServer } from 'http';
import colyseus from 'colyseus';
import wsTransport from '@colyseus/ws-transport';
import { WorldRoom } from './rooms/WorldRoom.js';

const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer();

// Registered before the Server/transport below so Colyseus's matchmaking
// route handler (which takes over the httpServer's 'request' event) still
// falls through to this for anything that isn't a /matchmake request —
// in particular Render's health check hitting GET /.
httpServer.on('request', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('world', WorldRoom);

httpServer.listen(port, () => {
  console.log(`Hairy Popsicles MMO server listening on ws://localhost:${port}`);
});
