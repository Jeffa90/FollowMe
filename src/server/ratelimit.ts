import { tooMany } from "./errors";

// In-process sliding window. Adequate for a single instance; swap for a shared store (Redis) when scaling out.
// See docs/known-limitations.md.
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    throw tooMany();
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 50_000) for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size < 25_000) break; }
}

export function resetRateLimits() {
  buckets.clear();
}
