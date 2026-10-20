// Grow times are short while nothing persists: a plot is lost when you close
// the tab or the server sleeps, so a long timer just means losing the plant.
export const RARITIES = {
  common: { label: 'Common', weight: 55, growMs: 30_000, scraps: 7, color: '#d9c7b8' },
  uncommon: { label: 'Uncommon', weight: 28, growMs: 90_000, scraps: 12, color: '#a8c66c' },
  rare: { label: 'Rare', weight: 13, growMs: 4 * 60_000, scraps: 25, color: '#7fb2e5' },
  legendary: { label: 'Legendary', weight: 4, growMs: 8 * 60_000, scraps: 60, color: '#e8b04a' },
};

// `id` is the sprite slug in packages/client/public/characters/ and, for the
// original cast, the character's id in the first game's src/roster.js.
export const CHARACTERS = [
  { id: 'pimples', name: 'Pimples', rarity: 'common' },
  { id: 'stubble', name: 'Stubble', rarity: 'common' },
  { id: 'droopy', name: 'Droopy', rarity: 'common' },
  { id: 'sweats', name: 'Sweats', rarity: 'common' },
  { id: 'weeper', name: 'Weeper', rarity: 'common' },
  { id: 'screamer', name: 'Screamer', rarity: 'common' },
  { id: 'roast', name: 'Roast', rarity: 'common' },
  { id: 'toad', name: 'Toad', rarity: 'common' },
  { id: 'shiv', name: 'Shiv', rarity: 'uncommon' },
  { id: 'conehead', name: 'Conehead', rarity: 'uncommon' },
  { id: 'redeye', name: 'Red Eye', rarity: 'uncommon' },
  { id: 'tendrils', name: 'Tendrils', rarity: 'uncommon' },
  { id: 'melter', name: 'Melter', rarity: 'uncommon' },
  { id: 'bricks', name: 'Bricks', rarity: 'uncommon' },
  { id: 'bigeye', name: 'Big Eye', rarity: 'uncommon' },
  { id: 'mirror', name: 'Mirror', rarity: 'rare' },
  { id: 'leprechaun', name: 'Leprechaun', rarity: 'rare' },
  { id: 'snoot', name: 'Snoot', rarity: 'rare' },
  { id: 'fairy', name: 'Fairy', rarity: 'rare' },
  { id: 'antenna', name: 'Antenna', rarity: 'rare' },
  { id: 'spoon-nana', name: 'Spoon Nana', rarity: 'rare' },
  { id: 'bat-rat', name: 'Bat Rat', rarity: 'rare' },
  { id: 'head-bloom', name: 'Head Bloom', rarity: 'legendary' },
  { id: 'snoot-2', name: 'Wide-Eye Snoot', rarity: 'legendary' },
  { id: 'snoot-3', name: 'Gauged Snoot', rarity: 'legendary' },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
