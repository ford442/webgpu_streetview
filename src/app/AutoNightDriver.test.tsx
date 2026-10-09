// @vitest-environment jsdom
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = {
  autoNightMode: true,
  nightIntensity: 0,
  setNightIntensity: vi.fn(),
  setSunAzimuth: vi.fn(),
  setSunAltitude: vi.fn(),
  setMoonAzimuth: vi.fn(),
  setMoonAltitude: vi.fn(),
  setMoonIntensity: vi.fn(),
};
const sv = { position: { lat: () => 0, lng: () => 0 } as google.maps.LatLng | null };

vi.mock('../hooks/useStreetView', () => ({ useStreetView: () => sv }));
vi.mock('../hooks/useEnvironmentSettings', () => ({ useLightingSettings: () => env }));

import { AutoNightDriver } from './AutoNightDriver';

describe('AutoNightDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 2, 20, 12, 0, 0)));
    Object.values(env).forEach((v) => typeof v === 'function' && (v as ReturnType<typeof vi.fn>).mockClear());
    env.autoNightMode = true;
    sv.position = { lat: () => 0, lng: () => 0 } as google.maps.LatLng;
  });
  afterEach(() => vi.useRealTimers());

  it('pushes the real-clock sun position into the environment while enabled', () => {
    render(<AutoNightDriver />);
    expect(env.setSunAltitude).toHaveBeenCalledTimes(1);
    expect(env.setSunAltitude.mock.calls[0]![0]).toBeGreaterThan(1.2); // noon at 0°E
  });

  it('is inert when auto-night is off or no panorama position exists yet', () => {
    env.autoNightMode = false;
    render(<AutoNightDriver />);
    sv.position = null;
    env.autoNightMode = true;
    render(<AutoNightDriver />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(env.setSunAltitude).not.toHaveBeenCalled();
  });
});
