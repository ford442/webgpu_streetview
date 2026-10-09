/**
 * src/services/conditions/openMeteo.ts
 * Live local conditions (opt-in): the current weather at the panorama from
 * Open-Meteo (keyless, CORS-enabled), mapped onto the app's weather controls.
 *
 * Licence: Open-Meteo data is CC BY 4.0 (attribution shown in the weather
 * panel while live conditions are on); the free API is for non-commercial use
 * — a commercial deployment needs an Open-Meteo API plan. Responses are kept
 * in memory only, never in Cache Storage / IndexedDB.
 *
 * Request policy: one request per 10 minutes while the car stays within 25 km
 * of the last fetch (a road trip at cruise pace never leaves that radius in
 * 10 minutes); a jump of more than 25 km refetches, at most once a minute.
 */

import { getWasmModule } from '../../wasm';
import { JS_FALLBACK } from '../../wasm/jsFallback';

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export const CONDITIONS_REFRESH_MS = 10 * 60 * 1000;
export const CONDITIONS_REFETCH_DISTANCE_M = 25_000;
export const CONDITIONS_MIN_SPACING_MS = 60 * 1000;

export interface LiveConditions {
  lat: number;
  lng: number;
  fetchedAt: number;
  /** WMO weather interpretation code. */
  weatherCode: number;
  /** Precipitation over the preceding hour, mm. */
  precipitationMm: number;
  /** Snowfall over the preceding hour, cm. */
  snowfallCm: number;
  cloudCoverPct: number;
  /** Metres; null when the model does not report it. */
  visibilityM: number | null;
  windSpeedKmh: number;
  /** Direction the wind blows *from*, degrees. */
  windFromDeg: number;
  temperatureC: number | null;
}

/** Targets in the weather panel's own units (rain/snow/fog 0–100, wind −100…100). */
export interface WeatherTarget {
  rainIntensity: number;
  snowIntensity: number;
  fogDensity: number;
  wind: number;
}

export function buildOpenMeteoUrl(lat: number, lng: number): string {
  const current = [
    'weather_code', 'precipitation', 'snowfall', 'cloud_cover', 'visibility',
    'wind_speed_10m', 'wind_direction_10m', 'temperature_2m',
  ].join(',');
  return `${OPEN_METEO_ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=${current}&wind_speed_unit=kmh`;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function parseOpenMeteoCurrent(json: unknown, lat: number, lng: number, now: number): LiveConditions {
  const current = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!current || typeof current !== 'object' || typeof current.weather_code !== 'number') {
    throw new Error('Open-Meteo response has no current conditions');
  }
  return {
    lat,
    lng,
    fetchedAt: now,
    weatherCode: current.weather_code,
    precipitationMm: Math.max(0, num(current.precipitation)),
    snowfallCm: Math.max(0, num(current.snowfall)),
    cloudCoverPct: Math.max(0, Math.min(100, num(current.cloud_cover))),
    visibilityM: typeof current.visibility === 'number' && Number.isFinite(current.visibility) ? current.visibility : null,
    windSpeedKmh: Math.max(0, num(current.wind_speed_10m)),
    windFromDeg: num(current.wind_direction_10m),
    temperatureC: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
  };
}

export async function fetchLiveConditions(
  lat: number,
  lng: number,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; now?: number } = {},
): Promise<LiveConditions> {
  const fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const res = await fetchImpl(buildOpenMeteoUrl(lat, lng), { signal: opts.signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  return parseOpenMeteoCurrent(await res.json(), lat, lng, opts.now ?? Date.now());
}

/** Whether to fetch now, given the last fetch (if any) and where the car is. */
export function shouldFetchConditions(
  last: { lat: number; lng: number; at: number } | null,
  pos: { lat: number; lng: number },
  now: number,
): boolean {
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed >= CONDITIONS_REFRESH_MS) return true;
  if (elapsed < CONDITIONS_MIN_SPACING_MS) return false;
  const moved = (getWasmModule() ?? JS_FALLBACK).haversine(last.lat, last.lng, pos.lat, pos.lng);
  return moved > CONDITIONS_REFETCH_DISTANCE_M;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Rain floor per WMO code class (0–100). */
function rainForCode(code: number): number {
  if (code >= 95) return 95; // thunderstorm
  if (code === 82) return 90;
  if (code === 81) return 65;
  if (code === 80) return 40;
  if (code === 65 || code === 67) return 85;
  if (code === 63) return 60;
  if (code === 61 || code === 66) return 35;
  if (code === 55 || code === 57) return 30;
  if (code === 53) return 20;
  if (code === 51 || code === 56) return 12;
  return 0;
}

function snowForCode(code: number): number {
  if (code === 75 || code === 86) return 85;
  if (code === 73) return 55;
  if (code === 71 || code === 85) return 30;
  if (code === 77) return 20;
  return 0;
}

/**
 * Map conditions onto the weather controls. The WMO code sets the character
 * (drizzle vs downpour vs snow), the measured amounts can push it higher;
 * visibility (and fog codes 45/48) drive fog.
 */
export function mapConditionsToWeather(c: LiveConditions): WeatherTarget {
  const snowing = snowForCode(c.weatherCode) > 0 || c.snowfallCm > 0;
  const rainByAmount = clamp((c.precipitationMm / 8) * 100, 0, 100);
  const rain = snowing ? 0 : Math.max(rainForCode(c.weatherCode), c.precipitationMm > 0 ? rainByAmount : 0);
  const snow = Math.max(snowForCode(c.weatherCode), clamp((c.snowfallCm / 3) * 100, 0, 100));

  let fog = c.weatherCode === 45 ? 60 : c.weatherCode === 48 ? 70 : 0;
  if (c.visibilityM !== null && c.visibilityM < 10_000) {
    // 10 km → 0, 1 km → ~50, 200 m → ~85.
    fog = Math.max(fog, clamp(Math.log10(10_000 / Math.max(50, c.visibilityM)) * 50, 0, 95));
  }

  // The wind slider is a screen-lateral push: + blows left→right. Use the
  // east–west component of the wind (blowing *from* the west → toward east → +).
  const strength = clamp(c.windSpeedKmh / 50, 0, 1) * 100;
  const wind = -Math.sin((c.windFromDeg * Math.PI) / 180) * strength;

  return {
    rainIntensity: Math.round(rain),
    snowIntensity: Math.round(snow),
    fogDensity: Math.round(fog),
    wind: Math.round(wind),
  };
}

/** Short human summary for the weather panel. */
export function describeConditions(c: LiveConditions): string {
  const code = c.weatherCode;
  const sky = code === 0 ? 'Clear'
    : code <= 2 ? 'Partly cloudy'
    : code === 3 ? 'Overcast'
    : code === 45 || code === 48 ? 'Fog'
    : code <= 57 ? 'Drizzle'
    : code <= 67 ? 'Rain'
    : code <= 77 ? 'Snow'
    : code <= 82 ? 'Rain showers'
    : code <= 86 ? 'Snow showers'
    : 'Thunderstorm';
  const temp = c.temperatureC === null ? '' : `, ${Math.round(c.temperatureC)}°C`;
  return `${sky}${temp}`;
}
