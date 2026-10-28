'use strict';

const http = require('http');
const { TTLCache } = require('./cache');
const { RateLimiter } = require('./rateLimiter');
const { Metrics } = require('./metrics');
const { fetchForecast, UpstreamError } = require('./weather');

function createServer({
  fetchImpl = fetch,
  cache = new TTLCache(),
  limiter = new RateLimiter(),
  metrics = new Metrics(),
  log = (obj) => console.log(JSON.stringify(obj)),
} = {}) {
  const inflight = new Map(); // dedupe concurrent lookups for the same city

  async function lookup(city) {
    const key = city.toLowerCase();
    const cached = cache.get(key);
    if (cached) return { data: cached, cacheHit: true };
    if (!inflight.has(key)) {
      inflight.set(key, fetchForecast(city, { fetchImpl })
        .then((d) => { cache.set(key, d); return d; })
        .finally(() => inflight.delete(key)));
    }
    return { data: await inflight.get(key), cacheHit: false };
  }

  const send = (res, status, body, headers = {}) => {
    const isText = typeof body === 'string';
    res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
    res.end(isText ? body : JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    const start = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    let status = 200;

    try {
      if (route === '/healthz') {
        send(res, 200, { status: 'ok' });
      } else if (route === '/metrics') {
        send(res, 200, metrics.render({ weather_cache_entries: cache.size, weather_cache_hits_total: cache.hits, weather_cache_misses_total: cache.misses }));
      } else if (route === '/api/weather') {
        const ip = req.socket.remoteAddress || 'unknown';
        const rl = limiter.take(ip);
        if (!rl.allowed) {
          status = 429;
          send(res, 429, { error: 'Too many requests' }, { 'Retry-After': String(rl.retryAfterSec) });
        } else {
          const city = (url.searchParams.get('city') || '').trim();
          if (!city || city.length > 80) {
            status = 400;
            send(res, 400, { error: 'Provide a city query parameter (1-80 chars)' });
          } else {
            const { data, cacheHit } = await lookup(city);
            send(res, 200, data, { 'X-Cache': cacheHit ? 'HIT' : 'MISS' });
          }
        }
      } else {
        status = 404;
        send(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      status = err instanceof UpstreamError ? err.status : 502;
      send(res, status, { error: err instanceof UpstreamError ? err.message : 'Upstream failure' });
    } finally {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.observe(route, status, seconds);
      log({ method: req.method, route, status, ms: +(seconds * 1000).toFixed(2) });
    }
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const server = createServer();
  server.listen(port, () => console.log(JSON.stringify({ msg: 'listening', port })));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer };
