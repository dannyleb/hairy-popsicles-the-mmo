import { WORLD_EVENT } from '@hptm/shared';

// World events take turns, one at a time: each is a module with start(now)
// (false if it can't start, with nobody here), tick(now) and view(), which
// calls done(now, { again }) when it's over. WORLD_EVENTS (e.g. "scab,gash")
// changes the order, for testing.
export function createWorldEvents(scale, makers) {
  const wanted = (process.env.WORLD_EVENTS ?? '').split(',').filter((k) => makers[k]);
  const order = wanted.length ? wanted : WORLD_EVENT.order.filter((k) => makers[k]);
  let turn = 0;
  let current = null;
  let again = null;     // a kind that comes back next, out of turn
  let comeback = false; // the one on now is such a comeback (it gets one, no more)
  let nextAt = Date.now() + WORLD_EVENT.firstMs * scale;

  const done = (now, { again: kind = null } = {}) => {
    if (comeback) kind = null;
    current = null;
    again = kind;
    nextAt = now + (kind ? WORLD_EVENT.soonMs : WORLD_EVENT.everyMs) * scale;
  };
  const events = Object.fromEntries(Object.entries(makers).map(([kind, make]) => [kind, make(done)]));

  return {
    events,

    // The one going on (not The Boil, which has its own place in the state), or null.
    view() {
      return current && current !== 'boil' ? events[current].view() : null;
    },

    tick(now) {
      if (current) {
        events[current].tick(now);
        return;
      }
      if (now < nextAt) return;
      const kind = again ?? order[turn % order.length];
      if (events[kind].start(now)) {
        current = kind;
        comeback = Boolean(again);
        if (!again) turn++;
        again = null;
      } else {
        nextAt = now + 30_000 * scale;  // nobody here: try again in a bit
      }
    },

    renamePlayer(oldId, newId) {
      for (const event of Object.values(events)) event.renamePlayer?.(oldId, newId);
    },
  };
}
