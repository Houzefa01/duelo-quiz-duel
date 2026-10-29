// Rate-limit mémoire (suffisant pour vieux PC, 300 joueurs). Clé -> timestamps.
const buckets = new Map();
export function hitRate(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return { allowed: arr.length <= max, count: arr.length };
}
export function resetRate() { buckets.clear(); }
