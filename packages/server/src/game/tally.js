// Counting who did how much at a world event: Maps of id → count.
export const addTo = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

// Whoever did the most (the first of them, on a tie), or undefined.
export const topOf = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
