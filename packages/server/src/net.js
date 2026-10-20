// Who's asking, for per-address limits. On Render, requests come through its
// edge (Cloudflare), which stamps CF-Connecting-IP with the real address. Any
// X-Forwarded-For the client sends is kept and appended to, so only its last
// entry (added by the nearest proxy) can be trusted. Locally there are no
// proxies, and the socket's own address is used.
export function clientAddress(req) {
  const headers = req?.headers ?? {};
  const edge = headers['cf-connecting-ip'];
  if (typeof edge === 'string' && edge.trim()) return { address: edge.trim().slice(0, 64), source: 'CF-Connecting-IP' };
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return { address: forwarded.split(',').at(-1).trim().slice(0, 64), source: 'X-Forwarded-For (last entry)' };
  }
  return { address: String(req?.socket?.remoteAddress ?? 'unknown').slice(0, 64), source: 'socket' };
}

// At most `limit` events per address per `windowMs`. Remembers at most
// `maxAddresses` addresses (the longest quiet go first), so a flood of made-up
// addresses can't grow it without bound.
export function createLimiter({ limit, windowMs, maxAddresses = 5000 }) {
  const seen = new Map();  // address → { count, since }, most recently touched last

  function current(address) {
    const entry = seen.get(address);
    return entry && Date.now() - entry.since <= windowMs ? entry : null;
  }

  return {
    blocked: (address) => (current(address)?.count ?? 0) >= limit,

    // Counts one; false if that's over the limit.
    take(address) {
      const entry = current(address) ?? { count: 0, since: Date.now() };
      seen.delete(address);
      seen.set(address, entry);
      while (seen.size > maxAddresses) seen.delete(seen.keys().next().value);
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },

    clear: (address) => seen.delete(address),
  };
}
