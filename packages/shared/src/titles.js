import { CHARACTERS } from './characters.js';

// Lifetime goals. Each earns a title a player can show under their name.
// `stat` is one of the player's lifetime stats, or 'album' (characters owned)
// or 'streak' (days in a row).
export const TITLES = [
  { id: 'picker', name: 'Picker', goal: 'Harvest 25 characters', stat: 'harvests', count: 25 },
  { id: 'pus-farmer', name: 'Pus Farmer', goal: 'Harvest 150 characters', stat: 'harvests', count: 150 },
  { id: 'good-neighbor', name: 'Good Neighbor', goal: "Squeeze 20 of your neighbors' crops", stat: 'squeezes', count: 20 },
  { id: 'boil-buster', name: 'Boil Buster', goal: 'Be the top squeezer of The Boil 3 times', stat: 'bossTops', count: 3 },
  { id: 'glob-goblin', name: 'Glob Goblin', goal: 'Grab 50 globs in Pus Rains', stat: 'globs', count: 50 },
  { id: 'shiny-hunter', name: 'Shiny Hunter', goal: 'Grow 3 shinies', stat: 'shinies', count: 3 },
  { id: 'chatterbox', name: 'Chatterbox', goal: 'Say 50 things in chat', stat: 'chats', count: 50 },
  { id: 'scratcher', name: 'Scratcher', goal: 'Help scratch The Itch 5 times', stat: 'itches', count: 5 },
  { id: 'generous', name: 'Generous', goal: 'Give 10 characters to other players', stat: 'gifts', count: 10 },
  { id: 'regular', name: 'Regular', goal: 'Visit 7 days in a row', stat: 'streak', count: 7 },
  { id: 'collector', name: 'Collector', goal: 'Have 15 characters in your album', stat: 'album', count: 15 },
  { id: 'completionist', name: 'Completionist', goal: 'Have every character in your album', stat: 'album', count: CHARACTERS.length },
];
export const TITLE_BY_ID = Object.fromEntries(TITLES.map((t) => [t.id, t]));
export const STAT_NAMES = ['harvests', 'squeezes', 'bossTops', 'globs', 'shinies', 'chats', 'gifts', 'itches'];

// Where a player stands on a title's goal.
export function titleProgress(title, stats, albumSize, streak) {
  if (title.stat === 'album') return albumSize;
  if (title.stat === 'streak') return streak;
  return stats[title.stat] ?? 0;
}
