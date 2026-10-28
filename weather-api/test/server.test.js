'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../src/server');
const { RateLimiter } = require('../src/rateLimiter');

function fakeUpstream({ failForecast = false } = {}) {
  const calls = { geo: 0, forecast: 0 };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('geocoding')) {
      calls.geo++;
      const found = u.includes('Nashville');
      return { ok: true, json: async () => (found ? { results: [{ name: 'Nashville', country: 'United States', latitude: 36.16, longitude: -86.78 }] } : {}) };
    }
    calls.forecast++;
    if (failForecast) return { ok: false, status: 500, json: async () => ({}) };
    await new Promise((r) => setTimeout(r, 20)); // widen the window for concurrent requests
    return { ok: true, json: async () => ({
      current: { temperature_2m: 21.5, wind_speed_10m: 9 },
      daily: { time: ['2026-10-28', '2026-10-29', '2026-10-30'], temperature_2m_max: [24, 22, 20], temperature_2m_min: [12, 11, 9] },
    }) };
  };
  return { fetchImpl, calls };
}

async function withServer(opts, fn) {
  const server = createServer({ log: () => {}, ...opts });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

test('returns normalized forecast, then serves repeat from cache', async () => {
  const up = fakeUpstream();
  await withServer({ fetchImpl: up.fetchImpl }, async (base) => {
    const r1 = await fetch(`${base}/api/weather?city=Nashville`);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.headers.get('x-cache'), 'MISS');
    const body = await r1.json();
    assert.strictEqual(body.city, 'Nashville');
    assert.strictEqual(body.daily.length, 3);
    assert.deepStrictEqual(body.daily[0], { date: '2026-10-28', maxC: 24, minC: 12 });

    const r2 = await fetch(`${base}/api/weather?city=nashville`);
    assert.strictEqual(r2.headers.get('x-cache'), 'HIT');
    assert.strictEqual(up.calls.forecast, 1, 'second request must not hit upstream');
  });
});

test('concurrent requests for the same city share one upstream call', async () => {
  const up = fakeUpstream();
  await withServer({ fetchImpl: up.fetchImpl }, async (base) => {
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => fetch(`${base}/api/weather?city=Nashville`)));
    assert.ok(rs.every((r) => r.status === 200));
    assert.strictEqual(up.calls.forecast, 1);
  });
});

test('validates input and maps errors', async () => {
  const up = fakeUpstream();
  await withServer({ fetchImpl: up.fetchImpl }, async (base) => {
    assert.strictEqual((await fetch(`${base}/api/weather`)).status, 400);
    assert.strictEqual((await fetch(`${base}/api/weather?city=Atlantis`)).status, 404);
    assert.strictEqual((await fetch(`${base}/nope`)).status, 404);
  });
  const bad = fakeUpstream({ failForecast: true });
  await withServer({ fetchImpl: bad.fetchImpl }, async (base) => {
    assert.strictEqual((await fetch(`${base}/api/weather?city=Nashville`)).status, 502);
  });
});

test('rate limiting returns 429 with Retry-After', async () => {
  const up = fakeUpstream();
  const limiter = new RateLimiter({ capacity: 2, refillPerSec: 0.1 });
  await withServer({ fetchImpl: up.fetchImpl, limiter }, async (base) => {
    await fetch(`${base}/api/weather?city=Nashville`);
    await fetch(`${base}/api/weather?city=Nashville`);
    const r = await fetch(`${base}/api/weather?city=Nashville`);
    assert.strictEqual(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
  });
});

test('/healthz and /metrics work and reflect traffic', async () => {
  const up = fakeUpstream();
  await withServer({ fetchImpl: up.fetchImpl }, async (base) => {
    assert.deepStrictEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
    await fetch(`${base}/api/weather?city=Nashville`);
    await fetch(`${base}/api/weather?city=Nashville`);
    const text = await (await fetch(`${base}/metrics`)).text();
    assert.match(text, /http_requests_total\{route="\/api\/weather",status="200"\} 2/);
    assert.match(text, /weather_cache_hits_total 1/);
    assert.match(text, /weather_cache_misses_total 1/);
  });
});
