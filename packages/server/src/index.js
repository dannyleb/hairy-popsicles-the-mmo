import { createServer } from 'http';
import colyseus from '@colyseus/core';
import wsTransport from '@colyseus/ws-transport';
import { handleAdmin } from './admin.js';
import { nameOf } from './game/invites.js';
import { readInviteCode } from './game/profile.js';
import { clientAddress, createLimiter } from './net.js';
import { WorldRoom, getWorld } from './rooms/WorldRoom.js';
import { statsReport } from './stats.js';

const { Server, matchMaker } = colyseus;
const { WebSocketTransport } = wsTransport;

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer();
// A request has a few seconds to arrive in full, so nobody can hold sockets
// open by sending one slowly.
httpServer.headersTimeout = 10_000;
httpServer.requestTimeout = 15_000;

// Registered before the Server/transport below so Colyseus's matchmaking
// route handler (which takes over the httpServer's 'request' event) still
// falls through to this for anything that isn't a /matchmake request —
// in particular Render's health check hitting GET /.
const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};
// Who an invite link is from, for the title screen: a name and whether they're on now.
const lookups = createLimiter({ limit: 60, windowMs: 60_000 });

httpServer.on('request', (req, res) => {
  if (handleAdmin(req, res)) return;
  const url = URL.parse(req.url ?? '/', 'http://server') ?? new URL('http://server/');  // a mangled path must not throw
  // Online: players here now, not ones whose phone dropped and may be back.
  if (url.pathname === '/stats') return json(res, { ...statsReport(), online: getWorld()?.activeCount() ?? 0 });
  if (url.pathname === '/invite') {
    const pid = readInviteCode(url.searchParams.get('with'));
    const known = pid && lookups.take(clientAddress(req).address);
    return json(res, known ? { name: nameOf(pid), here: Boolean(getWorld()?.isHere(pid)) } : { name: null, here: false });
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('world', WorldRoom);
// The game only ever joins (or makes) the one world, and reconnects to it. Nobody
// gets to make rooms of their own, or pick one by id.
matchMaker.controller.exposedMethods = ['joinOrCreate', 'reconnect'];

// Each join holds a seat for a few seconds, so joins are limited per address:
// one person can't fill the world with seats nobody takes. The body is just the
// join options (a name and a save), so anything big is refused before it's read.
const MATCHMAKE_BODY_MAX = 16 * 1024;
const joins = createLimiter({ limit: Number(process.env.JOINS_PER_MINUTE) || 30, windowMs: 60_000 });
const handleMatchMake = gameServer.handleMatchMakeRequest.bind(gameServer);
gameServer.handleMatchMakeRequest = (req, res) => {
  if (req.method === 'OPTIONS') return handleMatchMake(req, res);
  const refuse = (status, error) => {
    res.writeHead(status, {
      ...matchMaker.controller.DEFAULT_CORS_HEADERS,
      ...matchMaker.controller.getCorsHeaders(req),
      'Content-Type': 'application/json',
      Connection: 'close',
    });
    res.end(JSON.stringify({ code: status, error }));
  };
  // Only POSTs join; the room list (GET) isn't something the game needs to share.
  if (req.method !== 'POST') return refuse(405, 'Not allowed.');
  // With a Content-Length, Node reads exactly that much body and no more.
  const length = Number(req.headers['content-length']);
  if (req.headers['transfer-encoding'] || !Number.isInteger(length)) return refuse(411, 'Length required.');
  if (length > MATCHMAKE_BODY_MAX) return refuse(413, 'Too big.');
  if (!joins.take(clientAddress(req).address)) return refuse(429, 'Too many joins from your network. Wait a minute and try again.');
  return handleMatchMake(req, res);
};

httpServer.listen(port, () => {
  console.log(`Hairy Popsicles MMO server listening on ws://localhost:${port}`);
});
