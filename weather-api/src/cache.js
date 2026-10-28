'use strict';

/** Small TTL cache with a max size (oldest entry evicted first). */
class TTLCache {
  constructor({ ttlMs = 600000, maxEntries = 500, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key, value) {
    this.map.delete(key); // re-insert so it counts as newest
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  get size() { return this.map.size; }
}

module.exports = { TTLCache };
