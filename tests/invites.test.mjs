// Invite links: a friend arrives next to whoever invited them, and once they
// reach INVITE.level both are paid (the inviter at most INVITE.perDay a day,
// and later if they're away when it happens). A second server stands in for
// the first one restarted: same secret, nothing in memory.
process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');
const { INVITE } = await import('@hptm/shared');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const PORT = 2586;
const URL = `ws://localhost:${PORT}`;
const RESTARTED = 'ws://localhost:2587';

async function join(options, url = URL) {
  const room = await new Client(url).joinOrCreate('world', options);
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
// A friend's save from just before INVITE.level, invite unspent: what someone
// could keep a copy of, to try again after a restart.
const stashed = (id, name, invitedBy) => saveToken({
  profileId: id, name, avatar: 'pimples', xp: 100, currency: 100, collection: { pimples: 1 }, shinies: {},
  inventory: { boil: 0 }, quests: [], daily: { last: today, streak: 1 }, dailyQuest: null, stats: {}, titles: [], title: null, invitedBy,
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
const code = host.me.inviteCode;
check('each player gets their own signed invite code', typeof code === 'string' && code.startsWith(`${pid}.`), code);

const lookup = await (await fetch(`http://localhost:${PORT}/invite?with=${code}`)).json();
check('an invite link says who it is from, and that they are on', lookup.name === 'Host' && lookup.here === true, JSON.stringify(lookup));
const forgedCode = `${pid}.AAAAAAAA`;
const says = async (w) => (await (await fetch(`http://localhost:${PORT}/invite?with=${w}`)).json()).name;
check('a made-up or forged link says nothing', await says('nobodyatall1') === null && await says(pid) === null && await says(forgedCode) === null);

// A link made up for someone (to land next to them, or claim the reward) does nothing.
const forger = await join({ name: 'Forger', invitedBy: forgedCode });
check('joining by a forged link is not an invite', !forger.notices.some((n) => n.kind === 'invited') && !host.notices.some((n) => n.kind === 'inviteJoined'));
await forger.room.leave(true);

// A friend arrives.
const friend = await join({ name: 'Friend', invitedBy: code });
const me = friend.pub();
const distance = Math.hypot(me.x - host.pub().x, me.y - host.pub().y);
check('a friend from an invite starts next to whoever invited them', distance < 160, `${Math.round(distance)}px`);
const invited = friend.notices.find((n) => n.kind === 'invited');
check('they are told who invited them, and what reaching the level is worth', invited?.name === 'Host' && invited.pid === pid && invited.here && invited.level === INVITE.level && invited.boil === INVITE.reward.boil);
check('the inviter hears they arrived', host.notices.some((n) => n.kind === 'inviteJoined' && n.name === 'Friend' && n.pid === friend.pub().pid));
check('the invite is in their save until it pays out', lastSave(friend).invitedBy === pid);

// Someone with a save already can't be "invited" (no reward for re-arriving).
const regular = await join({ profile: inviterSave(`invite-regular-${Date.now()}`), invitedBy: code });
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
check("the inviter's save remembers the friend it paid for", lastSave(host).inviteLog?.paid.includes(friend.pub().pid) && lastSave(host).inviteLog.count === 1);
const hostAfterFirst = host.saves.at(-1);
const friendId = friend.me.profileId;

// The inviter is away when the next friend gets there: paid when they're back.
await host.room.leave(true);
await sleep(300);
const second = await join({ name: 'Second', invitedBy: code });
check("a friend still gets the inviter's name when the inviter is away", second.notices.find((n) => n.kind === 'invited')?.name === 'Host');
await levelUp(second, 4);
check('the friend is paid either way', second.notices.some((n) => n.kind === 'invite' && n.role === 'invitee'));
host = await join({ profile: inviterSave(hostId) });
const owed = host.notices.filter((n) => n.kind === 'invite' && n.role === 'inviter');
check('an inviter who was away is paid when they come back', owed.length === 1 && owed[0].name === 'Second' && host.me.stats.invites === 2, JSON.stringify(owed));

// At most INVITE.perDay friends a day pay the inviter.
const third = await join({ name: 'Third', invitedBy: code });
await levelUp(third, 6);
const fourth = await join({ name: 'Fourth', invitedBy: code });
await levelUp(fourth, 8);
const paidToday = host.notices.filter((n) => n.kind === 'invite' && n.role === 'inviter').length + 1;  // + the one paid on return
check(`an inviter is paid for at most ${INVITE.perDay} friends a day`, paidToday === INVITE.perDay && host.me.stats.invites === INVITE.perDay, `${paidToday} paid`);
check('the friends past that are still paid', fourth.notices.some((n) => n.kind === 'invite' && n.role === 'invitee'));
check(`${INVITE.perDay} friends earn the Ringleader title`, host.me.titles.includes('ringleader'));

for (const p of [host, friend, second, third, fourth]) await p.room.leave(true);

// After a restart: the friend's stashed save (from before they were paid for)
// doesn't pay the inviter again, and the inviter's count for today carries on.
const host2 = await join({ profile: hostAfterFirst }, RESTARTED);
const paid2 = () => host2.notices.filter((n) => n.kind === 'invite' && n.role === 'inviter').map((n) => n.name);
const replay = await join({ profile: stashed(friendId, 'Friend', pid) }, RESTARTED);
await levelUp(replay, 2);
check('a replayed save does not pay the inviter again', replay.me.level >= INVITE.level && paid2().length === 0, JSON.stringify(paid2()));
const later = [];
for (const [i, name] of ['Bea', 'Cal', 'Dot'].entries()) {
  const p = await join({ profile: stashed(`invite-later-${name}-${Date.now()}`, name, pid) }, RESTARTED);
  await levelUp(p, 4 + i * 2);
  later.push(p);
}
check("the day's count carries over a restart, in the inviter's save", paid2().join(',') === 'Bea,Cal', JSON.stringify(paid2()));
for (const p of [host2, replay, ...later]) await p.room.leave(true);
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
