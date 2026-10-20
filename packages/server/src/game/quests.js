import { QUEST_KINDS } from '@hptm/shared';
import { pick } from './roll.js';

export const QUESTS_ACTIVE = 3;
let nextId = 1;

function deal(player, { othersPresent, exclude }) {
  const kinds = Object.entries(QUEST_KINDS).filter(([kind, q]) =>
    !exclude.includes(kind)
    && (!q.minLevel || player.level >= q.minLevel)
    && (!q.needsOthers || othersPresent));
  const [kind, def] = pick(kinds);
  return makeQuest(kind, pick(def.counts), 0);
}

function makeQuest(kind, target, progress) {
  const def = QUEST_KINDS[kind];
  return { id: nextId++, kind, target, progress, text: def.text(target), scraps: def.scraps * target, xp: def.xp * target };
}

// Quests from a save, rebuilt from their kind and target (so a change to a
// quest's text or pay applies to saved ones too). Anything unrecognized is dropped.
export function restoreQuests(saved) {
  if (!Array.isArray(saved)) return [];
  const kinds = new Set();
  const quests = [];
  for (const q of saved.slice(0, QUESTS_ACTIVE)) {
    const def = Object.hasOwn(QUEST_KINDS, q?.kind) ? QUEST_KINDS[q.kind] : null;
    if (!def || kinds.has(q.kind) || !def.counts.includes(q.target)) continue;
    kinds.add(q.kind);
    const progress = Number.isInteger(q.progress) ? Math.min(Math.max(q.progress, 0), q.target - 1) : 0;
    quests.push(makeQuest(q.kind, q.target, progress));
  }
  return quests;
}

// Fill the player's quest list back up to three, never two of the same kind.
export function topUp(player, othersPresent) {
  while (player.quests.length < QUESTS_ACTIVE) {
    player.quests.push(deal(player, { othersPresent, exclude: player.quests.map((q) => q.kind) }));
  }
}

// Advance every quest of `kind`; returns the ones that just completed (already removed).
export function advance(player, kind, amount = 1) {
  const done = [];
  for (const quest of player.quests) {
    if (quest.kind !== kind) continue;
    quest.progress = Math.min(quest.target, quest.progress + amount);
    if (quest.progress >= quest.target) done.push(quest);
  }
  player.quests = player.quests.filter((q) => !done.includes(q));
  return done;
}

// Drop quests nobody can currently help with (e.g. squeezing neighbors when you're alone).
export function dropImpossible(player, othersPresent) {
  if (othersPresent) return false;
  const before = player.quests.length;
  player.quests = player.quests.filter((q) => !QUEST_KINDS[q.kind].needsOthers);
  return player.quests.length !== before;
}
