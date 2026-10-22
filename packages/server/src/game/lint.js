import { LANDMARKS, LINT } from '@hptm/shared';
import { present } from './spots.js';

const GURGLE_MS = 2000;  // a warning gurgle before the first cough

// Navel Lint (see LINT in @hptm/shared): the Navel coughs lint over its plaza
// a few times over. The balls are drops like a Pus Rain's (rain.cough), so
// they're grabbed the same way; it's over once it's done coughing and they're
// all gone (grabbed, or lain there their time).
export function createLint(room, scale, done) {
  let lint = null;
  const { x, y } = LANDMARKS.navel;

  return {
    start(now) {
      const players = present(room);
      if (!players.length) return false;
      lint = {
        coughsLeft: LINT.coughs,
        nextCoughAt: now + GURGLE_MS,
        perCough: Math.min(LINT.perCough.max, LINT.perCough.base + LINT.perCough.perPlayer * players.length),
        total: 0,
        expiresAt: now + GURGLE_MS + (LINT.coughs - 1) * LINT.coughEveryMs + LINT.lifeMs,
      };
      room.announce("The Navel is gurgling... it's going to cough up lint! Get to the middle of the world.", 'boss');
      room.broadcast('navelGurgle', {});
      room.markDirty();
      return true;
    },

    view() {
      return lint && {
        kind: 'lint', x, y, coughsLeft: lint.coughsLeft, nextCoughAt: lint.nextCoughAt,
        left: room.rain.lintLeft(), total: lint.total, expiresAt: lint.expiresAt,
      };
    },

    tick(now) {
      if (!lint) return;
      if (lint.coughsLeft > 0 && now >= lint.nextCoughAt) {
        room.rain.cough(x, y, lint.perCough, now);
        room.broadcast('navelCough', {});
        lint.coughsLeft -= 1;
        lint.total += lint.perCough;
        lint.nextCoughAt += LINT.coughEveryMs;
        room.markDirty();
      } else if (lint.coughsLeft === 0 && (room.rain.lintLeft() === 0 || now >= lint.expiresAt)) {
        lint = null;
        done(now);
        room.broadcast('eventOver', { kind: 'lint', x, y });
        room.announce('The Navel settles down again.', 'boss');
        room.markDirty();
      }
    },
  };
}
