// What players type, in chat and names, sorted by how bad it is:
//   hate        slurs and hate slogans
//   sexual      explicit sexual talk
//   harassment  threats, telling someone to hurt themselves, abuse aimed at someone
//   profanity   ordinary swearing and body words
// In chat the first three are a strike (game/moderation.js) and the line isn't
// sent; swearing is masked. A name with any of them isn't used. Gross is fine
// (it's that kind of game: pus, scabs and The Gash are the whole point); hate isn't.
//
// Text is compared after undoing common disguises: l33t letters, repeated
// letters, punctuation inside a word, and words spelled out a letter at a time
// ("k y s"). Short roots must match a whole word, so "spice", "grape" and
// "scunthorpe" survive.
const WORDS = {
  hate: {
    anywhere: ['nigger', 'nigga', 'faggot', 'retard', 'tranny', 'kike', 'wetback', 'raghead', 'towelhead', 'beaner', 'shemale'],
    whole: ['fag', 'fags', 'spic', 'spics', 'coon', 'coons', 'chink', 'chinks', 'gook', 'gooks', 'dyke', 'dykes', 'nazi', 'nazis', 'paki', 'pakis', 'kkk', 'heil', 'hitler'],
  },
  sexual: {
    anywhere: ['molest', 'jizz', 'blowjob', 'handjob', 'pedophil', 'paedophil', 'masturbat', 'dildo', 'bukkake', 'creampie'],
    whole: ['rape', 'raped', 'rapes', 'raping', 'rapist', 'rapists', 'pedo', 'pedos', 'paedo', 'cum', 'cums', 'cumming', 'porn', 'porno', 'whore', 'whores', 'slut', 'sluts', 'nudes', 'orgasm', 'sexting'],
  },
  harassment: {
    anywhere: ['cunt'],
    whole: ['kys'],
  },
  profanity: {
    anywhere: ['fuck', 'shit', 'bitch', 'asshole', 'wank', 'motherf'],
    whole: ['fuk', 'fck', 'stfu', 'bastard', 'bastards', 'dick', 'dicks', 'cock', 'cocks', 'twat', 'twats', 'tits', 'titties', 'boobs', 'penis', 'vagina', 'boner', 'horny', 'anal', 'sex', 'sexy'],
  },
};
// Said to someone, these are a strike even though some are only swearing on their own.
const PHRASES = {
  sexual: ['send nudes', 'suck my dick', 'suck my cock', 'suck my balls', 'sit on my face', 'wanna fuck', 'want to fuck', 'lets fuck'],
  harassment: [
    'kill yourself', 'kill urself', 'kill ur self', 'kill your self', 'go die', 'hope you die', 'hope u die', 'you should die', 'u should die',
    'neck yourself', 'neck urself', 'hang yourself', 'hang urself', 'unalive yourself', 'slit your wrists', 'drink bleach',
    'i will kill you', 'ill kill you', 'im going to kill you', 'gonna kill you', 'i know where you live', 'dox you',
    'fuck you', 'fuck u', 'fuk you', 'fuk u', 'fck you', 'fck u', 'fuck off', 'fuck your', 'fuck yourself', 'fuck urself',
  ],
};
// Insults, when they're aimed at someone: "you idiot", "u r trash", "you're so
// stupid", "are you dumb" (only linking words between "you" and the insult, so
// "you got trash luck" and "thank you, that was dumb of me" are fine).
const INSULTS = ['idiot', 'moron', 'loser', 'stupid', 'dumb', 'dumbass', 'trash', 'garbage', 'ugly', 'fat', 'worthless', 'pathetic', 'scum', 'braindead', 'jackass', 'asshole', 'bitch', 'retard', 'whore', 'slut', 'cunt'];
const YOU = ['you', 'u', 'ur', 'youre', 'yur', 'ya', 'yu'];
const LINKING = ['are', 'r', 're', 'is', 'look', 'so', 'such', 'a', 'an', 'the', 'total', 'fucking', 'fking', 'fkn', 'really', 'very', 'big', 'lil', 'little', 'dirty', 'stinky'];
// Fine words that contain a root above.
const ALLOWED = ['scunthorpe', 'retardant', 'retardants', 'niger', 'nigeria', 'nigerian', 'nigerians', 'shiitake', 'shitake'];
// Worst first: a line is sorted by the worst thing in it.
const SEVERITY = ['hate', 'sexual', 'harassment', 'profanity'];
// Which ones are a strike, not just masked.
export const STRIKE = new Set(['hate', 'sexual', 'harassment']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const squash = (word) => word.replace(/(.)\1+/g, '$1');
// A word with its disguise undone: plain letters, then with repeats squashed.
const plain = (word) => [...word.toLowerCase()].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');

const ROOTS = Object.fromEntries(Object.entries(WORDS).map(([category, { anywhere, whole }]) => [category, {
  anywhere: anywhere.map(squash),
  whole: new Set(whole),
  // Squashed too ("fagg"), unless that shortens it to a different short word ("kkk" to "k").
  wholeSquashed: new Set(whole.map(squash).filter((w) => w.length >= 3)),
}]));
const ALLOWED_SET = new Set(ALLOWED);
const INSULT_SET = new Set(INSULTS.map(squash));
const YOU_SET = new Set(YOU.map(squash));
const LINKING_SET = new Set(LINKING.map(squash));
const PHRASE_PATTERNS = Object.fromEntries(Object.entries(PHRASES).map(([category, phrases]) => [
  category,
  // Spaces between the words are optional ("killyourself").
  phrases.map((p) => new RegExp(`(^| )${p.split(' ').map((w) => squash(plain(w))).join(' ?')}( |$)`)),
]));

// Which category one word falls in, or null.
function wordCategory(raw) {
  // Gamer-tag decoration ("xXwordXx") doesn't hide a whole word.
  const p = plain(raw).replace(/^x+|x+$/g, '');
  if (!p || ALLOWED_SET.has(p)) return null;
  const s = squash(p);
  return SEVERITY.find((c) => ROOTS[c].whole.has(p) || ROOTS[c].wholeSquashed.has(s) || ROOTS[c].anywhere.some((root) => s.includes(root))) ?? null;
}

// The words, undisguised, with runs of single letters joined up ("k y s" → "kys").
function words(text) {
  const out = [];
  let letters = '';
  for (const raw of text.split(/\s+/)) {
    const p = plain(raw);
    if (p.length === 1) {
      letters += p;
      continue;
    }
    if (letters) out.push(letters);
    letters = '';
    if (p) out.push(p);
  }
  if (letters) out.push(letters);
  return out;
}

// How bad a line is: { category (the worst in it, or null), strike, masked },
// where `masked` has each bad word starred out.
export function checkText(text) {
  const found = new Set();
  const masked = text.replace(/\S+/g, (word) => {
    const category = wordCategory(word);
    if (!category) return word;
    found.add(category);
    return '*'.repeat(word.length);
  });
  const list = words(text);
  for (const word of list) {
    const category = wordCategory(word);
    if (category) found.add(category);
  }
  const line = list.map(squash).join(' ');
  for (const [category, patterns] of Object.entries(PHRASE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(line))) found.add(category);
  }
  const squashed = list.map(squash);
  squashed.forEach((word, i) => {
    if (!YOU_SET.has(word)) return;
    let j = i + 1;
    while (LINKING_SET.has(squashed[j])) j++;
    if (INSULT_SET.has(squashed[j])) found.add('harassment');
  });
  const category = SEVERITY.find((c) => found.has(c)) ?? null;
  return { category, strike: STRIKE.has(category), masked };
}

// Player text on one line, without the invisible characters that can hide
// words, fake someone else's name, or flip the text around it: control
// characters, bidi overrides, zero-width spaces. (Keeps the zero-width joiner
// that builds emoji like 👨‍👩‍👧.)
const INVISIBLE = /[\p{Cc}\u2028\u2029]|(?!\u200D)\p{Cf}/gu;

export function plainText(text, max) {
  return text.replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// The text with any bad word replaced by asterisks.
export const maskText = (text) => checkText(text).masked;

// Anything in it at all (for names).
export const hasBlocked = (text) => checkText(text).category !== null;
