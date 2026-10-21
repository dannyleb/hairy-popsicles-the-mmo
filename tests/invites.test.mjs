// Invite links: a friend arrives next to whoever invited them, and once they
// reach INVITE.level both are paid (the inviter at most INVITE.perDay a day,
// and later if they're away when it happens).
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { INVITE } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const PORT = 2586;
const URL = `ws://localhost:${PORT}`;

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, notices: [], saves: [], announce: [] };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('me', (m) => { p.me = m; });
  room.onMessage('notice', (n) => p.notices.push(n));
  room.onMessage('save', ({ token }) => p.saves.push(token));
  room.onMessage('announce', (m) => p.announce.push(m));
  room.send('sync');
  await sleep(300);
  p.pub = () => p.state.players[room.sessionId];
  return p;
}
const lastSave = (p) => JSON.parse(Buffer.from(p.saves.at(-1).split('.')[0], 'base64url').toString());
const today = new Date().toISOString().slice(0, 10);
const inviterSave = (id) => saveToken({
  profileId: id, name: 'Host', avatar: 'pimples', xp: 400, currency: 100, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null,
}, null, null);

// Plant and harvest Pimple Seeds until they reach the level.
async function levelUp(p, plotX) {
  p.room.send('claimPlot', { plotX, plotY: 3 });
  await sleep(200);
  const key = `${plotX},3`;
  const deadline = Date.now() + 60_000;
  while ((p.me?.level ?? 1) < INVITE.level && Date.now() < deadline) {
    (p.state.plots[key]?.slots ?? []).forEach((crop, slot) => {
      if (!crop) p.room.send('plant', { plotKey: key, slot, seed: 'pimple' });
      else if (crop.readyAt <= Date.now()) p.room.send('harvest', { plotKey: key, slot });
    });
    await sleep(150);
  }
  await sleep(300);
}

const hostId = `invite-host-${Date.now()}`;
let host = await join({ profile: inviterSave(hostId) });
const pid = host.pub().pid;

const lookup = await (await fetch(`http://localhost:${PORT}/invite?with=${pid}`)).json();
check('an invite link says who it is from, and that they are on', lookup.name === 'Host' && lookup.here === true, JSON.stringify(lookup));
check('a made-up link says nothing', (await (await fetch(`http://localhost:${PORT}/invite?with=nobodyatall1`)).json()).name === null);

// A friend arrives.
const friend = await join({ name: 'Friend', invitedBy: pid });
const me = friend.pub();
const distance = Math.hypot(me.x - host.pub().x, me.y - host.pub().y);
check('a friend from an invite starts next to whoever invited them', distance < 160, `${Math.round(distance)}px`);
const invited = friend.notices.find((n) => n.kind === 'invited');
check('they are told who invited them, and what reaching the level is worth', invited?.name === 'Host' && invited.pid === pid && invited.here && invited.level === INVITE.level && invited.boil === INVITE.reward.boil);
check('the inviter hears they arrived', host.notices.some((n) => n.kind === 'inviteJoined' && n.name === 'Friend' && n.pid === friend.pub().pid));
check('the invite is in their save until it pays out', lastSave(friend).invitedBy === pid);

// Someone with a save already can't be "invited" (no reward for re-arriving).
const regular = await join({ profile: inviterSave(`invite-regular-${Date.now()}`), invitedBy: pid });
check('a returning player is not counted as invited', !regular.notices.some((n) => n.kind === 'invited'));
await regular.room.leave(true);

// Reaching the level pays both.
const boilBefore = host.me.inventory.boil;
const scrapsBefore = host.me.currency;
await levelUp(friend, 2);
const theirs = friend.notices.find((n) => n.kind === 'invite');
const hosts = host.notices.find((n) => n.kind === 'invite');
check(`reaching level ${INVITE.level} pays the friend`, theirs?.role === 'invitee' && theirs.name === 'Host' && friend.me.inventory.boil >= INVITE.reward.boil, `level ${friend.me?.level}`);
check('and the inviter', hosts?.role === 'inviter' && hosts.name === 'Friend' && host.me.inventory.boil === boilBefore + INVITE.reward.boil && host.me.currency === scrapsBefore + INVITE.reward.scraps);
check("it counts toward the inviter's Ringleader title", host.me.stats.invites === 1);
check('everyone hears about it', host.announce.some((a) => a.kind === 'gift' && a.text.includes('Friend') && a.text.includes('Host')));
await sleep(2200);  // saves go out at most every 2 seconds
check('the invite is spent, in their save too', lastSave(friend).invitedBy === null);

// The inviter is away when the next friend gets there: paid when they're back.
await host.room.leave(true);
await sleep(300);
const second = await join({ name: 'Second', invitedBy: pid });
check("a friend still gets the inviter's name when the inviter is away", second.notices.find((n) => n.kind === 'invited')?.name === 'Host');
await levelUp(second, 4);
check('the friend is paid either way', second.notices.some((n) => n.kind === 'invite' && n.role === 'invitee'));
host = await join({ profile: inviterSave(hostId) });
const owed = host.notices.filter((n) => n.kind === 'invite' && n.role === 'inviter');
check('an inviter who was away is paid when they come back', owed.length === 1 && owed[0].name === 'Second' && host.me.stats.invites === 2, JSON.stringify(owed));

// At most INVITE.perDay friends a day pay the inviter.
const third = await join({ name: 'Third', invitedBy: pid });
await levelUp(third, 6);
const fourth = await join({ name: 'Fourth', invitedBy: pid });
await levelUp(fourth, 8);
const paidToday = host.notices.filter((n) => n.kind === 'invite' && n.role === 'inviter').length + 1;  // + the one paid on return
check(`an inviter is paid for at most ${INVITE.perDay} friends a day`, paidToday === INVITE.perDay && host.me.stats.invites === INVITE.perDay, `${paidToday} paid`);
check('the friends past that are still paid', fourth.notices.some((n) => n.kind === 'invite' && n.role === 'invitee'));
check(`${INVITE.perDay} friends earn the Ringleader title`, host.me.titles.includes('ringleader'));

for (const p of [host, friend, second, third, fourth]) await p.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
