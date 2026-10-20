import { Client } from 'colyseus.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2568';

const client = new Client(URL);
const watch = (room, box) => {
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { box.state = s; box.inits = (box.inits ?? 0) + 1; });
  room.onMessage('state', (s) => { box.state = { ...s, plots: s.plots ?? box.state?.plots }; });  // plots come only when changed
  room.onMessage('me', (m) => { box.me = m; });
  return room;
};
const obs = {};
const observer = watch(await new Client(URL).joinOrCreate('world', { name: 'obs' }), obs);
const a = {};
let room = watch(await client.joinOrCreate('world', { name: 'Phone' }), a);
await sleep(300);
const id = room.sessionId;
room.send('claimPlot', { plotX: 3, plotY: 3 });
await sleep(200);
room.send('plant', { plotKey: '3,3', slot: 4 });
room.send('chat', { text: 'before the drop' });
await sleep(300);
const before = { currency: a.me.currency, xp: a.me.xp, crop: a.state.plots['3,3'].slots[4]?.characterId };

// The socket drops, like a phone going to the background.
const token = room.reconnectionToken;
room.connection.close();
await sleep(400);
check('dropped player is held, marked away', obs.state.players[id]?.away === true && obs.state.plots['3,3']?.ownerId === id);

const b = {};
room = watch(await client.reconnect(token), b);
room.send('sync');
await sleep(400);
check('reconnects into the same seat', room.sessionId === id);
check('sync resends world, private data', b.inits === 1 && b.me?.currency === before.currency && b.me?.xp === before.xp);
check('plot and crop survived', b.state.plots['3,3']?.slots[4]?.characterId === before.crop);
check('no longer away', obs.state.players[id]?.away === false);
room.send('chat', { text: 'back again' });
await sleep(1500);
check('still playable after reconnect', b.me && b.state.players[id]);

// Leaving on purpose removes the player right away; their growing plot stays, marked away.
await room.leave(true);
await sleep(300);
check('consented leave removes the player and holds the plot', !obs.state.players[id] && obs.state.plots['3,3']?.away === true && obs.state.plots['3,3'].ownerId === null);
await observer.leave();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
