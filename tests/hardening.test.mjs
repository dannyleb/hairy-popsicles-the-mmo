import { check, finish, sleep } from './lib.mjs';
import { Client } from 'colyseus.js';
const URL = 'ws://localhost:2572';
async function join(name) {
  const room = await new Client(URL).joinOrCreate('world', { name });
  const p = { room, chat: [], quests: 0 };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });  // plots come only when changed
  room.onMessage('chat', (c) => p.chat.push(c));
  room.send('sync');
  await sleep(300);
  return p;
}
const bad = await join('xXR4pistXx');
check('offensive name becomes a Guest', bad.state.players[bad.room.sessionId].name.startsWith('Guest'));
const a = await join('Polite');
a.room.send('chat', { text: 'you absolute fag' });
await sleep(300);
check('slur in chat is masked for everyone', bad.chat[0]?.text === 'you absolute ***');
// Flood: 300 moves at once. The server keeps up and drops the excess.
const before = Date.now();
for (let i = 0; i < 300; i++) a.room.send('move', { x: 100 + i, y: 100 });
await sleep(500);
const x = a.state.players[a.room.sessionId].x;
check('a flood is cut off (later moves dropped)', x < 100 + 299, `x=${x}`);
await sleep(2500);
a.room.send('chat', { text: 'still here' });
await sleep(300);
check('player can act again after the flood', bad.chat.some((c) => c.text === 'still here'));
check('server still answering', Date.now() - before < 10_000 && Boolean(bad.state));
// Garbage in every message type: each must cost only that message.
const junk = { toString: 1 };
for (const [type, message] of [
  ['chat', { text: junk }], ['plant', { plotKey: junk, slot: 4, seed: junk }], ['harvest', { plotKey: junk, slot: 0 }],
  ['tend', { plotKey: '__proto__', slot: 0 }], ['buy', { item: junk }], ['buy', { item: '__proto__' }],
  ['gift', { to: 'constructor', characterId: 'pimples' }], ['gift', { to: '__proto__', characterId: junk }],
  ['setTitle', { id: junk }], ['setColor', { color: junk }], ['setAvatar', { characterId: junk }],
  ['move', { x: 'a', y: junk }], ['claimPlot', { plotX: junk }], ['grab', { id: junk }], ['emote', { emote: junk }],
  ['sync', 'hello'], ['chat', null], ['plant', 42],
]) {
  a.room.send(type, message);
  await sleep(60);
}
await sleep(500);
const late = await join('Latecomer');
a.room.send('chat', { text: 'survived' });
await sleep(1500);
a.room.send('chat', { text: 'survived' });
await sleep(400);
check('malformed messages never take the server down', Boolean(late.state) && late.chat.some((c) => c.text === 'survived'));
// ---- one world: nobody makes rooms of their own or picks one by id
const refused = async (attempt) => attempt.then(() => false, () => true);
check("clients can't create rooms", await refused(new Client(URL).create('world', { name: 'Squatter' })));
check("or join one by id", await refused(new Client(URL).joinById(a.room.roomId, { name: 'Sneak' })));
const extra = await new Client(URL).joinOrCreate('world', { name: 'Normal' });
check('joining lands in the one world', extra.roomId === a.room.roomId);
await extra.leave(true);

await late.room.leave(true);
await a.room.leave(true);
await bad.room.leave(true);
finish();
