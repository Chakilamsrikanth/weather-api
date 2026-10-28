'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TTLCache } = require('../src/cache');
const { RateLimiter } = require('../src/rateLimiter');
const { Metrics } = require('../src/metrics');

test('cache returns value before TTL and expires after', () => {
  let t = 0;
  const c = new TTLCache({ ttlMs: 1000, now: () => t });
  c.set('a', 1);
  assert.strictEqual(c.get('a'), 1);
  t = 1001;
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.hits, 1);
  assert.strictEqual(c.misses, 1);
});

test('cache evicts oldest entry past maxEntries', () => {
  const c = new TTLCache({ maxEntries: 2 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('c'), 3);
  assert.strictEqual(c.size, 2);
});

test('rate limiter blocks after capacity and refills over time', () => {
  let t = 0;
  const rl = new RateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
  assert.ok(rl.take('x').allowed);
  assert.ok(rl.take('x').allowed);
  const blocked = rl.take('x');
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.retryAfterSec, 1);
  t = 1000;
  assert.ok(rl.take('x').allowed);
  assert.ok(rl.take('other').allowed, 'separate clients have separate buckets');
});

test('metrics render counters and cumulative histogram', () => {
  const m = new Metrics([0.1, 1]);
  m.observe('/a', 200, 0.05);
  m.observe('/a', 200, 0.5);
  m.observe('/a', 500, 3);
  const out = m.render();
  assert.match(out, /http_requests_total\{route="\/a",status="200"\} 2/);
  assert.match(out, /le="0.1"\} 1/);
  assert.match(out, /le="1"\} 2/);
  assert.match(out, /le="\+Inf"\} 3/);
});
