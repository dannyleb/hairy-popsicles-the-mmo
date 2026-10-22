// Who's asking, for per-address limits. On Render, requests come through its
// edge (Cloudflare), which stamps CF-Connecting-IP with the real address. Any
// X-Forwarded-For the client sends is kept and appended to, so only its last
// entry (added by the nearest proxy) can be trusted. Locally there are no
// proxies, and the socket's own address is used.
//
// Limits go by `network`: one home or phone on IPv6 gets a whole /64 of
// addresses to pick from, so those count as one.
export function clientAddress(req) {
  const headers = req?.headers ?? {};
  const edge = headers['cf-connecting-ip'];
  const forwarded = headers['x-forwarded-for'];
  let found = { address: String(req?.socket?.remoteAddress ?? 'unknown'), source: 'socket' };
  if (typeof edge === 'string' && edge.trim()) found = { address: edge.trim(), source: 'CF-Connecting-IP' };
  else if (typeof forwarded === 'string' && forwarded.trim()) found = { address: forwarded.split(',').at(-1).trim(), source: 'X-Forwarded-For (last entry)' };
  const address = found.address.slice(0, 64);
  return { address, network: networkOf(address), source: found.source };
}

// An IPv4 address as it is; an IPv6 one as its /64.
export function networkOf(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const [head, tail] = address.split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
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
