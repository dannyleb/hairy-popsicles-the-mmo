export const CHAT_MAX = 80;
export const CHAT_COOLDOWN_MS = 1200;
export const EMOTE_COOLDOWN_MS = 900;

export const EMOTES = [
  { id: 'wave', label: 'Wave', text: '*waves a damp hand*' },
  { id: 'drool', label: 'Drool', text: '*drools*' },
  { id: 'scream', label: 'Scream', text: 'AAAAAAAH' },
  { id: 'weep', label: 'Weep', text: '*weeps quietly*' },
  { id: 'gag', label: 'Gag', text: '*gags*' },
  { id: 'pick', label: 'Pick', text: '*picks at a scab*' },
];
export const EMOTE_BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

// Giving a spare copy of a character (you keep at least one) to another player.
export const GIFT_COOLDOWN_MS = 10_000;

// Bringing a friend: a new player who arrives by someone's invite link starts
// next to them, and once they reach `level` both get the reward. An inviter is
// paid for at most `perDay` friends a day (so a pile of alts isn't a seed farm).
export const INVITE = { level: 3, reward: { scraps: 50, boil: 1 }, perDay: 3 };
export const INVITE_PAID_KEPT = 50;  // friends an inviter's save remembers being paid for
// A public id (who someone is to other players), and an invite code: the
// inviter's public id plus the server's signature, so links can't be made up.
export const isPublicId = (value) => typeof value === 'string' && /^[\w-]{12}$/.test(value);
export const isInviteCode = (value) => typeof value === 'string' && /^[\w-]{12}\.[\w-]{8}$/.test(value);
