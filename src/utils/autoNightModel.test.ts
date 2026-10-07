import { describe, expect, it } from 'vitest';
import {
  computeAutoNight,
  stepNightIntensity,
  sunAltitudeToBaseNight,
  NIGHT_STEP_MIN,
} from './autoNightModel';

// Equator / prime meridian near the March equinox: solar noon ≈ 12:00 UTC.
const LAT = 0;
const LNG = 0;
const at = (hourUtc: number) => new Date(Date.UTC(2024, 2, 20, hourUtc, 0, 0));

describe('autoNightModel', () => {
  it('maps sun altitude to the documented night curve', () => {
    expect(sunAltitudeToBaseNight(0.5)).toBe(0);
    expect(sunAltitudeToBaseNight(-0.0525)).toBeCloseTo(0.25, 5);
    expect(sunAltitudeToBaseNight(-0.105)).toBeCloseTo(0.5, 5);
    expect(sunAltitudeToBaseNight(-0.314)).toBeCloseTo(1.0, 2);
    expect(sunAltitudeToBaseNight(-1.2)).toBe(1);
  });

  it('follows the clock: sun above horizon at noon, below at midnight', () => {
    const noon = computeAutoNight(at(12), LAT, LNG);
    const midnight = computeAutoNight(at(0), LAT, LNG);
    expect(noon.sunAltitude).toBeGreaterThan(1.2);
    expect(noon.nightIntensity).toBe(0);
    expect(midnight.sunAltitude).toBeLessThan(-1.2);
    expect(midnight.nightIntensity).toBeGreaterThanOrEqual(0.85);
  });

  it('night intensity rises monotonically from noon through dusk', () => {
    const samples = [12, 16, 17, 18, 19, 20, 22].map((h) => computeAutoNight(at(h), LAT, LNG));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.sunAltitude).toBeLessThan(samples[i - 1]!.sunAltitude);
      expect(samples[i]!.nightIntensity).toBeGreaterThanOrEqual(samples[i - 1]!.nightIntensity - 0.16);
    }
  });

  it('depends on longitude: the same instant is day on one side of the world and night on the other', () => {
    const date = at(12);
    expect(computeAutoNight(date, 0, 0).nightIntensity).toBe(0);
    expect(computeAutoNight(date, 0, 180).nightIntensity).toBeGreaterThanOrEqual(0.85);
  });

  it('never exceeds [0,1] and keeps moonIntensity non-negative', () => {
    for (let h = 0; h < 24; h++) {
      const s = computeAutoNight(at(h), 37.8, -122.25);
      expect(s.nightIntensity).toBeGreaterThanOrEqual(0);
      expect(s.nightIntensity).toBeLessThanOrEqual(1);
      expect(s.moonIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  describe('stepNightIntensity', () => {
    it('drifts at the minimum step for small gaps', () => {
      expect(stepNightIntensity(0.5, 0.52)).toBeCloseTo(0.502, 4);
      expect(stepNightIntensity(0.5, 0.48)).toBeCloseTo(0.498, 4);
    });

    it('closes large gaps faster than the drift step', () => {
      const next = stepNightIntensity(0, 1);
      expect(next).toBeGreaterThan(NIGHT_STEP_MIN * 10);
    });

    it('settles exactly when within tolerance and never overshoots', () => {
      expect(stepNightIntensity(0.4995, 0.5)).toBe(0.4995);
      let v = 0;
      for (let i = 0; i < 400; i++) v = stepNightIntensity(v, 1);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThan(0.99);
    });
  });
});
