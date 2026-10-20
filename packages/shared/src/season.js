// Limited-time seasons. While one is on, harvests can drop its token, and the
// token buys things sold only during the season. Days are UTC; `ends` is the
// first day it's over.
export const SEASONS = [
  {
    id: 'rot',
    name: 'The Rotting Season',
    starts: '2026-10-20',
    ends: '2026-11-02',
    token: { one: 'tooth', many: 'teeth', icon: '🦷' },
    // Chance a harvest drops a tooth, by rarity (shinies always do).
    drop: { common: 0.15, uncommon: 0.3, rare: 0.6, legendary: 1 },
    color: { id: 'pumpkin', name: 'Pumpkin', cost: 13 },
    title: 'trick-or-treater',
  },
];

export const seasonOn = (day) => SEASONS.find((s) => day >= s.starts && day < s.ends) ?? null;

// Name colors sold only during a season, for its token instead of scraps.
export const SEASON_COLORS = new Set(SEASONS.map((s) => s.color.id));
