// The Itch: a goal for the whole world, paid to everyone who helped.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { ITCH, itchTarget } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const URL = 'ws://localhost:2578';

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, scratched: [], announce: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = s; });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('announce', (m) => p.announce.push(m));
  room.onMessage('itchScratched', (m) => p.scratched.push(m));
  room.send('sync');
  await sleep(300);
  return p;
}

// A high-level farmer with plenty of scraps, so bone seeds (always Uncommon or
// rarer) can go in every hole.
const today = new Date().toISOString().slice(0, 10);
const token = saveToken({
  profileId: `itch-${Date.now()}`, name: 'Scratchy', avatar: 'pimples', xp: 2900, currency: 5000,
  collection: { pimples: 1 }, shinies: {}, inventory: { boil: 0 }, quests: [],
  // Today's daily quest already done, so its Boil Seed can't muddle the count.
  daily: { last: today, streak: 1 }, dailyQuest: { day: today, kind: 'boss', target: 25, progress: 25 },
  stats: {}, titles: [], title: null,
}, null, null);
const a = await join({ profile: token });
a.room.send('claimPlot', { plotX: 6, plotY: 6 });

let waited = 0;
while (!a.state.itch && waited < 40) { await sleep(200); waited++; }
const itch = a.state.itch;
check('The Itch starts and is announced', Boolean(itch) && a.announce.some((m) => m.kind === 'itch' && m.text.startsWith('The Itch!')), itch ? `${itch.kind} ${itch.target}` : '');
check('its target is set by how many are online', itch?.target === itchTarget(itch?.kind, 1));

// Someone who turns up and does nothing doesn't share the reward.
const b = await join({ name: 'Bystander' });

const boilBefore = a.me.inventory.boil;
let farming = true;
let sawShare = 0;
const deadline = Date.now() + 60_000;
while (farming && Date.now() < deadline) {
  const slots = a.state.plots['6,6']?.slots ?? [];
  slots.forEach((crop, slot) => {
    if (!crop) a.room.send('plant', { plotKey: '6,6', slot, seed: 'bone' });
    else if (crop.readyAt <= Date.now()) a.room.send('harvest', { plotKey: '6,6', slot });
  });
  await sleep(150);
  if (a.me.itchShare?.id === itch.id) sawShare = Math.max(sawShare, a.me.itchShare.count);
  if (a.scratched.length) farming = false;
}
await sleep(300);
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

await a.room.leave(true);
await b.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
