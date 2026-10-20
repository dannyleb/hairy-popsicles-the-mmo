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
