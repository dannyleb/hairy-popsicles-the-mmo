import { Client } from 'colyseus.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2572';
async function join(name) {
  const room = await new Client(URL).joinOrCreate('world', { name });
  const p = { room, chat: [], quests: 0 };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = s; });
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
await a.room.leave(true);
await bad.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
