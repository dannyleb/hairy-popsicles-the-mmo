// The Itch: a goal for the whole world, paid to everyone who helped.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { CHARACTERS, ITCH, RARITY_ORDER, itchTarget } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2578';

function listen(room) {
  const p = { room, scratched: [], announce: [], shares: [], notices: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = s; });
  room.onMessage('me', (m) => {
    p.me = m;
    if (m.itchShare) p.shares.push(m.itchShare);
  });
  room.onMessage('announce', (m) => p.announce.push(m));
  room.onMessage('itchScratched', (m) => p.scratched.push(m));
  room.onMessage('notice', (n) => p.notices.push(n));
  room.send('sync');
  return p;
}

async function join(options) {
  const p = listen(await new Client(URL).joinOrCreate('world', options));
  await sleep(300);
  return p;
}

// Plant and harvest bone seeds in every hole until `done()`.
async function farm(p, key, done, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    (p.state.plots[key]?.slots ?? []).forEach((crop, slot) => {
      if (!crop) p.room.send('plant', { plotKey: key, slot, seed: 'bone' });
      else if (crop.readyAt <= Date.now()) p.room.send('harvest', { plotKey: key, slot });
    });
    await sleep(150);
  }
}

// A high-level farmer with plenty of scraps, so bone seeds (always Uncommon or
// rarer) can go in every hole.
const today = new Date().toISOString().slice(0, 10);
// A full album with every row paid, and today's daily quest already done, so
// no other Boil Seed can muddle the count.
const farmer = (name) => saveToken({
  profileId: `itch-${name}-${Date.now()}`, name, avatar: 'pimples', xp: 2900, currency: 5000,
  collection: Object.fromEntries(CHARACTERS.map((c) => [c.id, 1])), rows: RARITY_ORDER, shinies: {}, inventory: { boil: 0 }, quests: [],
  daily: { last: today, streak: 1 }, dailyQuest: { day: today, kind: 'boss', target: 25, progress: 25 },
  stats: {}, titles: [], title: null,
}, null, null);
const a = await join({ profile: farmer('Scratchy') });
a.room.send('claimPlot', { plotX: 6, plotY: 6 });

let waited = 0;
while (!a.state.itch && waited < 40) { await sleep(200); waited++; }
const itch = a.state.itch;
check('The Itch starts and is announced', Boolean(itch) && a.announce.some((m) => m.kind === 'itch' && m.text.startsWith('The Itch!')), itch ? `${itch.kind} ${itch.target}` : '');
check('its target is set by how many are online', itch?.target === itchTarget(itch?.kind, 1));

// Someone who turns up and does nothing doesn't share the reward.
const b = await join({ name: 'Bystander' });

const boilBefore = a.me.inventory.boil;
await farm(a, '6,6', () => a.scratched.length > 0);
await sleep(300);
// Every share update the client was sent, not just the latest: a quick
// scratch can come and go between two looks.
const sawShare = Math.max(0, ...a.shares.filter((s) => s.id === itch.id).map((s) => s.count));
const paid = a.scratched[0];
check('helping shows your share as it grows', sawShare > 0, `share ${sawShare}`);
check('scratching it pays everyone who helped', paid && paid.scraps === ITCH.reward.scraps && paid.boil === ITCH.reward.boil && paid.share >= sawShare);
check('the Boil Seed lands in their inventory', a.me.inventory.boil === boilBefore + ITCH.reward.boil);
check('it counts toward the Scratcher title', a.me.stats.itches === 1);
check('everyone hears it was scratched', b.announce.some((m) => m.kind === 'itch' && m.text.startsWith('Scratched!')));
check("whoever didn't help gets nothing", b.scratched.length === 0);
check('the world goal is cleared', !a.state.itch);

// The next one comes along; leave it alone and it fades.
waited = 0;
while (!a.announce.some((m) => m.text.startsWith('The Itch fades')) && waited < 120) { await sleep(250); waited++; }
check('an itch nobody scratches fades', a.announce.some((m) => m.text.startsWith('The Itch fades')) && !a.state.itch);
check('nobody is paid for one that fades', a.scratched.length === 1 && b.scratched.length === 0);

// Help with the next one, drop out, and be paid when you're back.
await b.room.leave(true);
const c = await join({ profile: farmer('Finisher') });
c.room.send('claimPlot', { plotX: 9, plotY: 9 });
waited = 0;
while (!a.state.itch && waited < 120) { await sleep(250); waited++; }
const third = a.state.itch;
const slots = a.state.plots['6,6'].slots;
// One action of the right kind: plant in an empty hole (emptying one first if
// need be), or harvest a ripe crop.
let slot = third.kind === 'plant' ? slots.findIndex((s) => !s) : slots.findIndex((s) => s && s.readyAt <= Date.now());
if (third.kind === 'plant' && slot < 0) {
  slot = slots.findIndex((s) => s && s.readyAt <= Date.now());
  a.room.send('harvest', { plotKey: '6,6', slot });
  await sleep(200);
}
a.room.send(third.kind === 'plant' ? 'plant' : 'harvest', { plotKey: '6,6', slot, seed: 'bone' });
await sleep(300);
const helped = a.shares.filter((s) => s.id === third.id).at(-1)?.count ?? 0;
const reconnectionToken = a.room.reconnectionToken;
a.room.connection.close();
await sleep(300);
await farm(c, '9,9', () => c.scratched.length > 0);
const back = listen(await new Client(URL).reconnect(reconnectionToken));
await sleep(500);
const owed = back.notices.find((n) => n.kind === 'itch');
check('a helper who dropped out sees their reward when they come back', helped > 0 && owed?.share === helped && owed.scraps === ITCH.reward.scraps, `helped ${helped}, ${third.kind}`);
check('and counts it', back.me?.stats.itches === 2);

await back.room.leave(true);
await c.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
