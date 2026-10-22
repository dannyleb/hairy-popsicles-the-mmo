// What every suite shares: a PASS or FAIL line per check, a few waits, and
// the exit at the end (non-zero if anything failed, for the runner).
let failures = 0;

export const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

export function finish() {
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Until `test()` holds, or `ms` is up; whether it held.
export const waitFor = async (test, ms) => {
  for (let t = 0; t < ms && !test(); t += 100) await sleep(100);
  return test();
};

// A player (as the event suites join them) walks somewhere, and is there.
export const walk = async (p, x, y) => {
  p.room.send('move', { x, y });
  await sleep(1500);
};
