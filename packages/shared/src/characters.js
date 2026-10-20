// Grow times are short while nothing persists: a plot is lost when you close
// the tab or the server sleeps, so a long timer just means losing the plant.
// The odds of each rarity depend on the seed (see SEEDS in progression.js).
export const RARITIES = {
  common: { label: 'Common', growMs: 30_000, scraps: 7, color: '#d9c7b8' },
  uncommon: { label: 'Uncommon', growMs: 90_000, scraps: 14, color: '#a8c66c' },
  rare: { label: 'Rare', growMs: 4 * 60_000, scraps: 35, color: '#7fb2e5' },
  legendary: { label: 'Legendary', growMs: 8 * 60_000, scraps: 90, color: '#e8b04a' },
};
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

// What anyone without lines of their own says (the first game's GRUNTS).
export const GRUNTS = ['hhhnnngh.', '*drip*', '...', 'go away.', 'hrrk.', 'mm.', "don't.", '*wet noise*'];

const SNOOT_LINES = ['I can smell how you feel.', "It's not a nose, it's a personality."];

// `id` is the sprite slug in packages/client/public/characters/ and, for the
// original cast, the character's id in the first game's src/roster.js, where
// these lines come from.
export const CHARACTERS = [
  { id: 'pimples', name: 'Pimples', rarity: 'common', lines: ["Don't pick. Don't pick. Don't pick.", "Don't look at my face.", "Something's been growing in there for weeks.", "It's ripe. I can feel it."] },
  { id: 'stubble', name: 'Stubble', rarity: 'common', lines: ['I shaved this morning. It came back angrier.', 'Stop looking at my pores.'] },
  { id: 'droopy', name: 'Droopy', rarity: 'common', lines: ['Everything sags eventually.', "I'm not tired. I'm just... like this."] },
  { id: 'sweats', name: 'Sweats', rarity: 'common', lines: ['Is it warm in here, or is it me?', 'I sweat when people look at me. Like now.'] },
  { id: 'weeper', name: 'Weeper', rarity: 'common', lines: ["I'm not crying. My face is just like this.", 'Everyone can see right through me.', 'Do my tears look normal to you?'] },
  { id: 'screamer', name: 'Screamer', rarity: 'common', lines: ["AAAH. Sorry. That's just my resting face.", 'I caught my reflection again.'] },
  { id: 'roast', name: 'Roast', rarity: 'common' },
  { id: 'toad', name: 'Toad', rarity: 'common' },
  { id: 'shiv', name: 'Shiv', rarity: 'uncommon', lines: ["Taller doesn't mean better. Trust me.", "My nose grows when I say I'm fine."] },
  { id: 'conehead', name: 'Conehead', rarity: 'uncommon', lines: ["I'm smiling! Can't you tell I'm smiling?", 'Happy tears. Probably.'] },
  { id: 'redeye', name: 'Red Eye', rarity: 'uncommon', lines: ["Haven't slept since I was drawn.", 'My eyes do that on their own.'] },
  { id: 'tendrils', name: 'Tendrils', rarity: 'uncommon', lines: ['Something keeps growing out of me.', "Pluck it. No, don't."] },
  { id: 'melter', name: 'Melter', rarity: 'uncommon', lines: ["Don't look. I'm having a face day.", 'I used to hold my shape.', 'Is it hot, or is it just me leaking?'] },
  { id: 'bricks', name: 'Bricks', rarity: 'uncommon', lines: ['I built myself up one block at a time.', "There's a crack. Don't mention the crack."] },
  { id: 'bigeye', name: 'Big Eye', rarity: 'uncommon', lines: ['I see everything. Too much.', 'What are YOU looking at?', "This eye's been loose since Tuesday."] },
  { id: 'mirror', name: 'Mirror', rarity: 'rare', lines: ['Look at me. No, really look.', 'I only show what you bring.', 'What do you see? Be honest.', 'You look... the same. For now.'] },
  { id: 'leprechaun', name: 'Leprechaun', rarity: 'rare', lines: ["Pot of gold? I've got a pot of pus.", "The beard's the best part of me."] },
  { id: 'snoot', name: 'Snoot', rarity: 'rare', lines: SNOOT_LINES },
  { id: 'fairy', name: 'Fairy', rarity: 'rare', lines: ['Make a wish. Make it gross.', "My planet's smaller than my problems."] },
  { id: 'antenna', name: 'Antenna', rarity: 'rare' },
  { id: 'spoon-nana', name: 'Spoon Nana', rarity: 'rare' },
  { id: 'bat-rat', name: 'Bat Rat', rarity: 'rare' },
  { id: 'head-bloom', name: 'Head Bloom', rarity: 'legendary' },
  { id: 'snoot-2', name: 'Wide-Eye Snoot', rarity: 'legendary', lines: SNOOT_LINES },
  { id: 'snoot-3', name: 'Gauged Snoot', rarity: 'legendary', lines: SNOOT_LINES },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

export function linesOf(characterId) {
  return CHARACTER_BY_ID[characterId]?.lines ?? GRUNTS;
}
