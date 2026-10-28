# Session summary: production-style backend for my Weather App

> **Transparency note:** this was built in a conversation with Claude (not the Claude Code CLI), with Claude writing the code and running the tests in a sandbox. I reviewed the design and am publishing it as my own project. 

## Goal
My Weather-Application repo was front-end only. I wanted to give it a backend with the reliability features I work with professionally (I build Golang/Azure microservices at GEICO), without pulling in dependencies.

## What was built
A Node.js service (`src/`) that proxies Open-Meteo and adds:

- TTL cache with a size cap
- Request de-duplication for concurrent lookups of the same city
- Per-client token-bucket rate limiting (`429` + `Retry-After`)
- Upstream timeouts and proper error mapping (400 / 404 / 429 / 502)
- Prometheus `/metrics` (request counters, latency histogram, cache hit/miss) and `/healthz`
- Structured JSON logging and graceful shutdown

## Key decisions
1. **Zero dependencies.** Node 18+ has `fetch`, `AbortSignal.timeout` and `node:test`, so the whole thing runs with `npm start` and `npm test`.
2. **Injectable clock and `fetch`.** Cache expiry and rate-limit refill are tested by moving a fake clock, not by sleeping.
3. **De-duplicate in-flight requests.** Caching alone doesn't help when 5 users ask for the same uncached city at once. Sharing one promise per city key fixes that.
4. **Cache key is the lowercased city,** so `Nashville` and `nashville` share an entry.

## How it was verified
- 9 automated tests, all passing: cache TTL and eviction, rate limiter refill and per-client isolation, histogram output, cache hit/miss via `X-Cache`, the concurrency test (5 parallel requests, exactly 1 upstream call), input validation, error mapping, 429 behaviour, and `/metrics` reflecting real traffic.
- A smoke test of the real server (`/healthz`, validation error, `/metrics`, SIGTERM shutdown).
- Not tested here: calls to the live Open-Meteo API (the sandbox had no network). Tests use a fake upstream matching Open-Meteo's response shape.

## Bug found along the way
`node --test test/` failed on Node 22 (it treats the directory as a module path). Fixed by using `node --test` with auto-discovery.

## What I'd do next
Wire the front-end to `/api/weather`, add a Dockerfile and a GitHub Actions workflow, and add Redis for a shared cache across instances.
