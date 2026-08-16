import { describe, expect, it } from 'vitest';
import {
  cabinEmitterTargets,
  cabinFillTargets,
  cabinGlowScale,
  clusterGlowLevel,
  domeGlowLevel,
  iblIntensityFromNight,
  sunBaseIntensityFromStrength,
  sunNightFactorFromAltitude,
  sunStrengthFromAltitude,
} from './cabinLightingRamps';

const DEG = Math.PI / 180;

describe('cabinLightingRamps', () => {
  it('treats altitudes at or below the horizon as night, full by nautical twilight', () => {
    expect(sunNightFactorFromAltitude(10 * DEG)).toBe(0);
    expect(sunNightFactorFromAltitude(0)).toBe(0);
    expect(sunNightFactorFromAltitude(-6 * DEG)).toBeGreaterThan(0.4);
    expect(sunNightFactorFromAltitude(-12 * DEG)).toBeCloseTo(1, 2);
    expect(sunNightFactorFromAltitude(-20 * DEG)).toBe(1);
  });

  it('ramps direct sun in over the first ~14° and maps that to a usable directional intensity', () => {
    expect(sunStrengthFromAltitude(-5 * DEG)).toBe(0);
    expect(sunStrengthFromAltitude(0)).toBe(0);
    const mid = sunStrengthFromAltitude(8 * DEG);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1);
    expect(sunStrengthFromAltitude(20 * DEG)).toBe(1);
    expect(sunBaseIntensityFromStrength(1)).toBeCloseTo(1.55, 5);
  });

  it('dims IBL hard at night so the room-cube / pano map does not wash the cabin', () => {
    expect(iblIntensityFromNight(0)).toBe(1);
    expect(iblIntensityFromNight(1)).toBeCloseTo(0.18, 5);
    expect(iblIntensityFromNight(0.5)).toBeCloseTo(0.59, 5);
  });

  it('keeps accent glow nearly off by day and raises it at night', () => {
    expect(cabinGlowScale(0, false, 0)).toBeCloseTo(0.07, 5);
    expect(cabinGlowScale(1, false, 0)).toBeCloseTo(1.12, 5);
    expect(cabinGlowScale(1, true, 0)).toBeGreaterThan(cabinGlowScale(1, false, 0));
    expect(cabinGlowScale(0, true, 0)).toBeCloseTo(0.07, 5);
  });

  it('night + headlights: dark fill, cluster-local dash spill, no ambient blanket', () => {
    const fill = cabinFillTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: true,
      domeLightOn: false,
    });
    expect(fill.hemi).toBeLessThan(0.02);
    expect(fill.ambient).toBeLessThan(0.01);
    expect(fill.overhead).toBe(0);
    expect(fill.dome).toBe(0);
    expect(fill.headlights).toBeGreaterThan(0);
    expect(fill.headlights).toBeLessThan(0.35);
    expect(fill.dash).toBeGreaterThan(0.15);
    expect(fill.dash).toBeLessThan(0.45);
    expect(fill.bounce).toBeGreaterThan(0.1);
    expect(fill.bounce).toBeLessThan(0.3);
  });

  it('night + dome on: overhead fixture is a real source; fills stay low', () => {
    const fill = cabinFillTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: true,
    });
    const emit = cabinEmitterTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: true,
    });
    expect(fill.dome).toBeGreaterThan(0.7);
    expect(fill.hemi).toBeLessThan(0.02);
    expect(emit.domeFixture).toBeGreaterThan(1.2);
    expect(emit.cluster).toBeGreaterThan(0.8);
    expect(domeGlowLevel({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: true,
    })).toBeGreaterThan(0.7);
  });

  it('day: sun/IBL dominate; emissives stay on for displays only', () => {
    const fill = cabinFillTargets({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    const emit = cabinEmitterTargets({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    expect(fill.hemi).toBeGreaterThan(0.1);
    expect(fill.hemi).toBeLessThan(0.25);
    expect(fill.ambient).toBeLessThan(0.06);
    expect(fill.dome).toBe(0);
    expect(fill.dash).toBe(0);
    expect(emit.cluster).toBeLessThan(0.3);
    expect(emit.centerDisplay).toBeGreaterThan(0.15);
    expect(emit.domeFixture).toBeLessThan(0.05);
    expect(clusterGlowLevel({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    })).toBe(0);
  });

  it('rain dims direct fill and adds bounce instead of ambient', () => {
    const clear = cabinFillTargets({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    const rain = cabinFillTargets({
      effectiveNight: 0,
      rain: 1,
      headlightsOn: false,
      domeLightOn: false,
    });
    expect(rain.overhead).toBeLessThan(clear.overhead);
    expect(rain.hemi).toBeLessThan(clear.hemi);
    expect(rain.ambient).toBeLessThan(clear.ambient);
    expect(rain.bounce).toBeGreaterThan(clear.bounce);
    expect(rain.bounce).toBeGreaterThan(0.05);
  });

  it('clinical theme brightens day fill without lifting the night floor', () => {
    const day = cabinFillTargets({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
      clinical: true,
    });
    const night = cabinFillTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
      clinical: true,
    });
    const sedanDay = cabinFillTargets({
      effectiveNight: 0,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    expect(day.hemi).toBeGreaterThan(sedanDay.hemi);
    expect(night.hemi).toBeLessThan(0.02);
    expect(night.ambient).toBeLessThan(0.01);
  });
});
