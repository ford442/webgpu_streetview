// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveConditionsStore } from '../state/liveConditionsStore';
import { LIVE_CONDITIONS_SMOOTHING_MS, LiveConditionsDriver } from './LiveConditionsDriver';

const h = vi.hoisted(() => ({
  ctx: null as unknown as React.Context<unknown>,
  setAutoNight: vi.fn(),
  position: { lat: () => 56.68, lng: () => -5.1 },
}));

vi.mock('../hooks/useStreetView', () => ({ useStreetView: () => ({ position: h.position }) }));
vi.mock('../hooks/useEnvironmentSettings', async () => {
  const R = await import('react');
  h.ctx = R.createContext<unknown>(null);
  return {
    useWeatherSettings: () => R.useContext(h.ctx),
    useLightingSettings: () => ({ setAutoNightMode: h.setAutoNight }),
  };
});

type Weather = { rainIntensity: number; snowIntensity: number; fogDensity: number; wind: number };
let weather: Weather;
let setters: Record<string, (v: number) => void>;

function Harness() {
  const [rainIntensity, setRainIntensity] = useState(0);
  const [snowIntensity, setSnowIntensity] = useState(0);
  const [fogDensity, setFogDensity] = useState(0);
  const [wind, setWind] = useState(0);
  weather = { rainIntensity, snowIntensity, fogDensity, wind };
  setters = { setRainIntensity, setSnowIntensity, setFogDensity, setWind };
  return (
    <h.ctx.Provider value={{ ...weather, ...setters }}>
      <LiveConditionsDriver />
    </h.ctx.Provider>
  );
}

const RAINY = { weather_code: 63, precipitation: 2, snowfall: 0, cloud_cover: 100, visibility: 6000, wind_speed_10m: 0, wind_direction_10m: 0, temperature_2m: 8 };
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ current: RAINY }), { status: 200 }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  liveConditionsStore.resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function enable() {
  render(<Harness />);
  act(() => liveConditionsStore.setEnabled(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('LiveConditionsDriver', () => {
  it('eases the weather onto live conditions within 1 s and follows the local clock', async () => {
    await enable();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.setAutoNight).toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_CONDITIONS_SMOOTHING_MS / 2); });
    expect(weather.rainIntensity).toBeGreaterThan(0);
    expect(weather.rainIntensity).toBeLessThan(60);
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_CONDITIONS_SMOOTHING_MS / 2 + 50); });
    expect(weather).toEqual({ rainIntensity: 60, snowIntensity: 0, fogDensity: 11, wind: 0 });
    expect(liveConditionsStore.get().status).toBe('live');
  });

  it('makes at most one request per 10 minutes while the car stays nearby, even across toggles', async () => {
    await enable();
    act(() => liveConditionsStore.setEnabled(false));
    act(() => liveConditionsStore.setEnabled(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60 * 1000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000 + 30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hands control to the user on a manual change, until Resume', async () => {
    await enable();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    act(() => setters.setRainIntensity!(5));
    expect(liveConditionsStore.get().status).toBe('overridden');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(weather.rainIntensity).toBe(5);
    act(() => liveConditionsStore.resume());
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(weather.rainIntensity).toBe(60);
  });

  it('a failed request leaves the controls manual and says so', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 503 }));
    await enable();
    expect(liveConditionsStore.get()).toMatchObject({ status: 'error', error: 'Open-Meteo returned 503' });
    expect(weather.rainIntensity).toBe(0);
  });
});
