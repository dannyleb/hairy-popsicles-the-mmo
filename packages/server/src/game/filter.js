// A small filter for chat and names in a public, anonymous game: slurs and the
// worst sexual terms are masked. Gross is fine (it's that kind of game); hate isn't.
// Words are compared after undoing common disguises (l33t letters, repeats,
// punctuation inside the word). Short roots must match a whole word, so
// "spice" and "scunthorpe" survive.
const ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'retard', 'tranny', 'cunt', 'kike', 'wetback',
  'raghead', 'towelhead', 'beaner', 'gook', 'molest', 'jizz', 'blowjob', 'pedophil',
];
const WHOLE_WORD = [
  'fag', 'fags', 'spic', 'spics', 'coon', 'coons', 'chink', 'chinks', 'dyke', 'dykes', 'nazi', 'nazis',
  'rape', 'raped', 'rapes', 'raping', 'rapist', 'rapists', 'pedo', 'pedos', 'paedo', 'cum', 'cums', 'porn', 'whore', 'slut',
];
// Fine words that contain a root above.
const ALLOWED = ['scunthorpe', 'retardant', 'retardants', 'niger', 'nigeria', 'nigerian', 'nigerians'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalize(word) {
  const plain = [...word.toLowerCase()].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  return plain.replace(/(.)\1+/g, '$1');
}

const squash = (word) => word.replace(/(.)\1+/g, '$1');
const ANYWHERE_N = ANYWHERE.map(squash);
const WHOLE_N = new Set(WHOLE_WORD.map(squash));
const ALLOWED_N = new Set(ALLOWED.map(squash));

function blocked(word) {
  // Gamer-tag decoration ("xXwordXx") doesn't hide a whole word.
  const n = normalize(word).replace(/^x+|x+$/g, '');
  if (!n || ALLOWED_N.has(n)) return false;
  return WHOLE_N.has(n) || ANYWHERE_N.some((root) => n.includes(root));
}

// The text with any blocked word replaced by asterisks.
export function maskText(text) {
  return text.replace(/\S+/g, (word) => (blocked(word) ? '*'.repeat(word.length) : word));
}

export function hasBlocked(text) {
  return text.split(/\s+/).some(blocked);
}
