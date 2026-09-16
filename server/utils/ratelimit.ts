// utils/ratelimit.ts

interface Bucket {
  tokens: number;
  last: number;
}

interface LimiterOptions {
  capacity: number;
  refillPerSec: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Token-bucket rate limiter. Returns true if the action for `key` is
 * allowed right now (and consumes a token), false if the key is
 * currently rate-limited.
 *
 * `key` should encode whatever scope you want to limit on, e.g.
 * `pw:${ip}:${noteId}` or `sub:${ip}`. Different scopes should use
 * different key prefixes so they don't share buckets by accident.
 */
export function allow(
  key: string,
  { capacity = 10, refillPerSec = 1 }: Partial<LimiterOptions> = {},
): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Convenience wrapper for defining a reusable limiter with fixed
 * capacity/refill so call sites don't repeat the numbers everywhere.
 *
 *   const passwordLimiter = createLimiter({ capacity: 5, refillPerSec: 0.1 });
 *   if (!passwordLimiter(`pw:${ip}:${noteId}`)) return;
 */
export function createLimiter(options: LimiterOptions) {
  return (key: string) => allow(key, options);
}

// Periodic cleanup so the Map doesn't grow forever. A bucket that
// hasn't been touched in 10 minutes is safe to drop — it'll just be
// recreated at full capacity next time that key is used, which is
// the same as it sitting idle and refilling to capacity anyway.
const CLEANUP_INTERVAL_MS = 60_000;
const BUCKET_TTL_MS = 10 * 60_000;

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - BUCKET_TTL_MS;
  for (const [key, b] of buckets) {
    if (b.last < cutoff) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS);

// Don't let the interval keep the process alive on its own (relevant
// for tests / clean shutdowns under Bun and Node).
cleanupTimer.unref?.();
