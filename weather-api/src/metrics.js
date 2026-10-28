'use strict';

/** Minimal Prometheus text-format metrics (counters + a latency histogram). */
class Metrics {
  constructor(buckets = [0.01, 0.05, 0.1, 0.5, 1, 5]) {
    this.requests = new Map(); // "route|status" -> count
    this.buckets = buckets;
    this.bucketCounts = new Array(buckets.length + 1).fill(0);
    this.sum = 0;
    this.count = 0;
  }

  observe(route, status, seconds) {
    const k = `${route}|${status}`;
    this.requests.set(k, (this.requests.get(k) || 0) + 1);
    this.sum += seconds;
    this.count++;
    let i = this.buckets.findIndex((b) => seconds <= b);
    if (i === -1) i = this.buckets.length;
    this.bucketCounts[i]++;
  }

  render(extra = {}) {
    const out = ['# TYPE http_requests_total counter'];
    for (const [k, v] of this.requests) {
      const [route, status] = k.split('|');
      out.push(`http_requests_total{route="${route}",status="${status}"} ${v}`);
    }
    out.push('# TYPE http_request_duration_seconds histogram');
    let cumulative = 0;
    this.buckets.forEach((b, i) => {
      cumulative += this.bucketCounts[i];
      out.push(`http_request_duration_seconds_bucket{le="${b}"} ${cumulative}`);
    });
    out.push(`http_request_duration_seconds_bucket{le="+Inf"} ${this.count}`);
    out.push(`http_request_duration_seconds_sum ${this.sum}`);
    out.push(`http_request_duration_seconds_count ${this.count}`);
    for (const [name, value] of Object.entries(extra)) {
      out.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    }
    return out.join('\n') + '\n';
  }
}

module.exports = { Metrics };
