import {
  CONDITIONS_REFRESH_MS,
  buildOpenMeteoUrl,
  describeConditions,
  mapConditionsToWeather,
  parseOpenMeteoCurrent,
  shouldFetchConditions,
  type LiveConditions,
} from './openMeteo';

const base: LiveConditions = {
  lat: 56.68, lng: -5.1, fetchedAt: 0, weatherCode: 0, precipitationMm: 0, snowfallCm: 0,
  cloudCoverPct: 0, visibilityM: 24000, windSpeedKmh: 0, windFromDeg: 0, temperatureC: 9,
};

describe('Open-Meteo conditions', () => {
  it('asks for the current variables it maps, keyless', () => {
    const url = buildOpenMeteoUrl(56.6826, -5.1023);
    expect(url).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=56\.6826&longitude=-5\.1023&current=/);
    expect(url).toContain('weather_code');
    expect(url).toContain('visibility');
    expect(url).not.toMatch(/key|apikey/i);
  });

  it('parses the current block and rejects a body without one', () => {
    const c = parseOpenMeteoCurrent({
      current: { weather_code: 63, precipitation: 2.4, snowfall: 0, cloud_cover: 100, visibility: 6000, wind_speed_10m: 30, wind_direction_10m: 270, temperature_2m: 8.2 },
    }, 1, 2, 5);
    expect(c).toMatchObject({ weatherCode: 63, precipitationMm: 2.4, visibilityM: 6000, windSpeedKmh: 30, fetchedAt: 5 });
    expect(() => parseOpenMeteoCurrent({ hourly: {} }, 1, 2, 5)).toThrow();
  });

  it.each([
    ['clear', { weatherCode: 0 }, { rainIntensity: 0, snowIntensity: 0, fogDensity: 0 }],
    ['moderate rain', { weatherCode: 63, precipitationMm: 2 }, { rainIntensity: 60, snowIntensity: 0 }],
    ['a downpour beats its code floor', { weatherCode: 61, precipitationMm: 6 }, { rainIntensity: 75 }],
    ['heavy snow, no rain', { weatherCode: 75, precipitationMm: 3, snowfallCm: 1 }, { rainIntensity: 0, snowIntensity: 85 }],
    ['fog code', { weatherCode: 45, visibilityM: null }, { fogDensity: 60 }],
    ['thick fog by visibility', { weatherCode: 3, visibilityM: 200 }, { fogDensity: 85 }],
  ] as const)('maps %s', (_label, patch, expected) => {
    expect(mapConditionsToWeather({ ...base, ...patch })).toMatchObject(expected);
  });

  it('turns a westerly into a left-to-right push and caps the strength', () => {
    expect(mapConditionsToWeather({ ...base, windSpeedKmh: 25, windFromDeg: 270 }).wind).toBe(50);
    expect(mapConditionsToWeather({ ...base, windSpeedKmh: 90, windFromDeg: 90 }).wind).toBe(-100);
  });

  it('describes the sky', () => {
    expect(describeConditions({ ...base, weatherCode: 63 })).toBe('Rain, 9°C');
    expect(describeConditions({ ...base, weatherCode: 96, temperatureC: null })).toBe('Thunderstorm');
  });
});

describe('request policy', () => {
  const here = { lat: 56.68, lng: -5.1 };
  it('fetches once, then at most every 10 minutes while nearby', () => {
    expect(shouldFetchConditions(null, here, 0)).toBe(true);
    const last = { ...here, at: 0 };
    expect(shouldFetchConditions(last, { lat: 56.7, lng: -5.1 }, CONDITIONS_REFRESH_MS - 1)).toBe(false);
    expect(shouldFetchConditions(last, here, CONDITIONS_REFRESH_MS)).toBe(true);
  });

  it('a jump of more than 25 km refetches, but never twice a minute', () => {
    const last = { ...here, at: 0 };
    const far = { lat: 55.95, lng: -3.19 }; // Glencoe → Edinburgh, ~140 km
    expect(shouldFetchConditions(last, far, 30_000)).toBe(false);
    expect(shouldFetchConditions(last, far, 60_000)).toBe(true);
    expect(shouldFetchConditions(last, { lat: 56.75, lng: -5.1 }, 120_000)).toBe(false);
  });
});
