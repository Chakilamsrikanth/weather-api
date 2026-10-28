# Weather API

A small, dependency-free Node.js service that sits in front of [Open-Meteo](https://open-meteo.com/) (no API key needed) and adds the things a production backend needs: caching, rate limiting, request de-duplication, structured logs and Prometheus metrics.

Built as the backend for my [Weather-Application](https://github.com/Chakilamsrikanth/Weather-Application) front-end.

## Run

```bash
npm start          # listens on $PORT or 3000
npm test           # 9 tests, no network required
```

## Endpoints

| Route | Description |
|---|---|
| `GET /api/weather?city=Nashville` | Current conditions + 3-day forecast. `X-Cache: HIT/MISS` header. |
| `GET /healthz` | Liveness check |
| `GET /metrics` | Prometheus text format (request counts, latency histogram, cache stats) |

Errors: `400` bad input, `404` unknown city, `429` rate limited (with `Retry-After`), `502` upstream failure.

## Design

- **TTL cache** (10 min, max 500 entries) so repeat lookups never hit the upstream API.
- **In-flight de-duplication**: concurrent requests for the same city share one upstream call.
- **Token-bucket rate limiter** per client IP.
- **Timeouts** on every upstream call (5 s).
- **Structured JSON logs** and **graceful shutdown** on SIGTERM/SIGINT.
- Time and the upstream `fetch` are injectable, so tests are fast and deterministic.
