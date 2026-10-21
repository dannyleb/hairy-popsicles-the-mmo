// Strays: characters loose in the world, wandering about on their own. Each
// walks a leg from one spot to the next at a stroll, then stands about. The
// server decides the legs; everyone works out where a stray is from the same
// leg and clock, so all screens agree. One stray is the day's featured
// character, and catching it adds a copy to your album (once a day).
export const STRAYS = {
  count: 8,               // featured one included
  speed: 32,              // px a second
  leg: [80, 300],         // how far each leg goes
  pauseMs: [2500, 9000],  // standing about between legs
  margin: 120,            // kept this far in from the world's edge
  swapMs: 10 * 60_000,    // now and then one of the others wanders off and another turns up
};

// Where a stray is at `now`: along its leg in a straight line, then stopped.
export function strayPosition(stray, now) {
  const span = stray.t1 - stray.t0;
  const k = span > 0 ? Math.min(1, Math.max(0, (now - stray.t0) / span)) : 1;
  return { x: stray.x0 + (stray.x1 - stray.x0) * k, y: stray.y0 + (stray.y1 - stray.y0) * k, moving: k > 0 && k < 1 };
}
