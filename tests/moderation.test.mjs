// Chat safety (game/moderation.js): hate, sexual talk and harassment aren't
// sent and are a strike, with a warning; the third bans the save (and, for a
// day, new saves from its network, but not anyone already playing there);
// swearing goes out masked; the admin page sees every flagged line and can pardon.
import { check, finish, sleep, waitFor } from './lib.mjs';

process.env.PROFILE_SECRET = 'test';
const { saveToken } = await import('../packages/server/src/game/profile.js');
const { Client } = await import('colyseus.js');

const URL = 'ws://localhost:2597';
const HTTP = 'http://localhost:2597';
const KEY = 'test-admin-key';
const HOUR = 3600_000;

// A save as the server would have signed it, started at `startedAt`.
const saveFor = (name, startedAt = Date.now()) => saveToken({
  profileId: `mod-${name}`, name, avatar: 'droopy', xp: 400, currency: 50, collection: { droopy: 1 }, shinies: {},
  inventory: { boil: 0, fertilizer: 0, teeth: 0 }, quests: [], daily: { last: null, streak: 0 }, dailyQuest: null,
  stats: {}, titles: [], title: null, rows: [], colors: [], nameColor: null, inviteLog: { day: null, count: 0, paid: [] }, startedAt,
}, null, null);

async function join(options) {
  const room = await new Client(URL).joinOrCreate('world', options);
  const p = { room, chat: [], flagged: [], banned: null, left: null };
  room.onMessage('*', () => {});
  room.onMessage('init', (s) => { p.state = s; });
  room.onMessage('state', (s) => { p.state = { ...s, plots: s.plots ?? p.state?.plots }; });
  room.onMessage('chat', (line) => p.chat.push(line));
  room.onMessage('chatFlagged', (m) => p.flagged.push(m));
  room.onMessage('banned', (m) => { p.banned = m; });
  room.onLeave((code) => { p.left = code; });
  room.send('sync');
  await sleep(400);
  p.pid = p.state.players[room.sessionId].pid;
  return p;
}
// The error a join is turned away with, or null if it got in.
async function turnedAway(options) {
  try {
    const room = await new Client(URL).joinOrCreate('world', options);
    await room.leave(true);
    return null;
  } catch (error) {
    return error;
  }
}
const say = async (p, text) => {
  p.room.send('chat', { text });
  await sleep(1300);  // past the chat cooldown
};
const adminData = async () => (await fetch(`${HTTP}/admin/data`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
const pardon = (profileId, key = KEY) => fetch(`${HTTP}/admin/pardon`, {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }),
});

// A regular who's been playing a while, and someone about to misbehave.
const regularSave = saveFor('Regular', Date.now() - HOUR);
const regular = await join({ profile: regularSave });
const troll = await join({ profile: saveFor('Troll') });
troll.room.send('claimPlot', { plotX: 3, plotY: 3 });
await sleep(400);

// ---- swearing: out, masked; noted, no strike
await say(troll, 'oh shit the boil');
check('swearing goes out masked', regular.chat.some((l) => l.text === 'oh **** the boil'));
check('...and is no strike', troll.flagged.length === 0);

// ---- strikes
await say(troll, 'you absolute fag');
check('a slur is not sent', !regular.chat.some((l) => l.text.includes('absolute')));
check('...and is strike 1 of 3, with a warning', troll.flagged[0]?.category === 'hate' && troll.flagged[0]?.strikes === 1 && troll.flagged[0]?.max === 3, JSON.stringify(troll.flagged));
await say(troll, 'k y s');
check('telling someone to kill themselves: strike 2', troll.flagged[1]?.category === 'harassment' && troll.flagged[1]?.strikes === 2);
regular.room.send('chat', { text: 'hello there' });
await sleep(400);
check('everyone else chats as normal', troll.chat.some((l) => l.text === 'hello there'));
let data = await adminData();
const trollRow = data.moderation.players.find((p) => p.name === 'Troll');
check('the admin page lists their strikes', trollRow?.strikes === 2 && !trollRow.bannedAt);
check('...and every flagged line, as it was typed, swearing too', ['you absolute fag', 'k y s', 'oh shit the boil'].every((t) => data.moderation.flags.some((f) => f.text === t)), data.moderation.flags.map((f) => f.text).join(' | '));

// ---- the third: banned
const reconnectionToken = troll.room.reconnectionToken;
await say(troll, 'send nudes');
check('strike 3', troll.flagged[2]?.strikes === 3);
check('banned: told, and sent off', troll.banned?.pid === troll.pid && await waitFor(() => troll.left === 4003, 3000), `left ${troll.left}`);
check('gone from the world, plot and all', await waitFor(() => !Object.values(regular.state.players).some((p) => p.name === 'Troll') && !regular.state.plots['3,3'], 3000));
let back = null;
try {
  back = await new Client(URL).reconnect(reconnectionToken);
} catch {
  // Turned away, as it should be.
}
check("can't slip back in on the old connection", !back);
let refused = await turnedAway({ profile: saveFor('Troll') });
check('the save is banned', refused?.code === 403 && /banned/.test(refused.message), refused?.message);
refused = await turnedAway({ name: 'Fresh', bannedAs: troll.pid });
check('a fresh save on the same phone is turned away too', refused?.code === 403, refused?.message);
refused = await turnedAway({ name: 'Newcomer' });
check('...as are new players from the same network, for a while', refused?.code === 403 && /network/.test(refused.message), refused?.message);
refused = await turnedAway({ profile: saveFor('Alt') });
check('...and a save made after the ban', refused?.code === 403);
check('anyone already playing from there still gets in', (await turnedAway({ profile: saveFor('Neighbour', Date.now() - HOUR) })) === null);
check('...and the regular is still here', regular.left === null && regular.state.players[regular.room.sessionId]);
data = await adminData();
check('the admin page shows the ban', Boolean(data.moderation.players.find((p) => p.name === 'Troll')?.bannedAt) && data.moderation.networkBans === 1);

// ---- pardon
check('pardon needs the key', (await pardon('mod-Troll', 'wrong')).status === 401);
check('pardon only for someone with strikes', (await pardon('mod-Nobody')).status === 404);
check('pardoned', (await pardon('mod-Troll')).status === 200);
const again = await join({ profile: saveFor('Troll') });
check('...and back in, strikes cleared', again.state.players[again.room.sessionId]?.name === 'Troll');
check('new players from the network can join again', (await turnedAway({ name: 'Newcomer' })) === null);
check('a phone that was banned gets in after the pardon', (await turnedAway({ name: 'Fresh', bannedAs: troll.pid })) === null);
await say(again, 'u r trash');
check('strikes start over', again.flagged[0]?.strikes === 1 && again.flagged[0]?.category === 'harassment');

await again.room.leave(true);
await regular.room.leave(true);
finish();
