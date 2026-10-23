import { SERVER_HTTP } from './server.js';

// How many are playing, asked as soon as the page opens. It's also the free
// server's wake-up call: it naps when nobody's around and takes up to a minute
// to get going, so better that starts while the title screen is being read.
export const worldStatus = fetch(`${SERVER_HTTP}/stats`, { cache: 'no-store' })
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null);

// Who's here now and who's been by lately (server: game/seen.js); null if the
// server can't be reached, or { error } if it says why not.
export const fetchWho = () => fetch(`${SERVER_HTTP}/players`, { cache: 'no-store' })
  .then((res) => res.json())
  .catch(() => null);
