/**
 * In-process token bucket rate limiter.
 * Good enough for a single Vercel function instance / local dev; it is
 * per-instance, so swap for a shared store (Postgres/Upstash) when measured
 * traffic requires global limits.
 */
type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

export function rateLimit(key: string, opts: { capacity: number; refillPerSecond: number }, now = Date.now()): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
    bucket = { tokens: opts.capacity, updatedAt: now };
    buckets.set(key, bucket);
  }
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * opts.refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }
  const retryAfterMs = Math.ceil(((1 - bucket.tokens) / opts.refillPerSecond) * 1000);
  return { allowed: false, remaining: 0, retryAfterMs };
}

export function resetRateLimits() {
  buckets.clear();
}
