'use strict';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function getJson(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new UpstreamError(`Upstream returned ${res.status}`);
  return res.json();
}

/** Look up a city and return a normalized current + 3-day forecast. Uses Open-Meteo (no API key). */
async function fetchForecast(city, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const geo = await getJson(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1`, fetchImpl, timeoutMs);
  const place = geo.results && geo.results[0];
  if (!place) { const e = new UpstreamError(`City not found: ${city}`, 404); throw e; }

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '3',
    timezone: 'auto',
  });
  const data = await getJson(`${FORECAST_URL}?${params}`, fetchImpl, timeoutMs);

  return {
    city: place.name,
    country: place.country,
    current: {
      temperatureC: data.current.temperature_2m,
      windKmh: data.current.wind_speed_10m,
    },
    daily: data.daily.time.map((date, i) => ({
      date,
      maxC: data.daily.temperature_2m_max[i],
      minC: data.daily.temperature_2m_min[i],
    })),
  };
}

module.exports = { fetchForecast, UpstreamError };
