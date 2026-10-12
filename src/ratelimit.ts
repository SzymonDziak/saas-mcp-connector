/** Per-key token bucket. `now` is injectable so tests need no real timers. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number, private now: () => number = Date.now) {}

  /** Returns 0 if allowed, else the seconds to wait before retrying. */
  take(key: string): number {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 1000) * this.refillPerSec);
    b.at = t;
    this.buckets.set(key, b);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.ceil((1 - b.tokens) / this.refillPerSec);
  }
}
