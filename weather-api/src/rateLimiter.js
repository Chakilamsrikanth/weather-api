'use strict';

/** Token-bucket rate limiter, one bucket per client key. */
class RateLimiter {
  constructor({ capacity = 30, refillPerSec = 0.5, now = Date.now } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.buckets = new Map();
  }

  /** Returns { allowed, retryAfterSec }. */
  take(key) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: t }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 1000) * this.refillPerSec);
    b.last = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, retryAfterSec: 0 };
    }
    return { allowed: false, retryAfterSec: Math.ceil((1 - b.tokens) / this.refillPerSec) };
  }
}

module.exports = { RateLimiter };
