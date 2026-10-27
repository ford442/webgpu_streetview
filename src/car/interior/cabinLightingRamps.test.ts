import { describe, expect, it } from 'vitest';
import {
  CLUSTER_WELL_EMISSIVE,
  CONTENT_MAP_EMISSIVE,
  DASH_SPILL_COLOR,
  DISPLAY_HOUSING_EMISSIVE,
  cabinEmitterTargets,
  cabinFillTargets,
  cabinGlowScale,
  centerDisplayGlowFromNight,
  clusterGlowLevel,
  domeGlowLevel,
  gaugeDialGlow,
  gaugeNeedleGlow,
  iblIntensityFromNight,
  locationPanelGlowFromNight,
  sunBaseIntensityFromStrength,
  sunNightFactorFromAltitude,
  sunSideFromBearing,
  sunStrengthFromAltitude,
  sunIntensityUnderWeather,
  windowFillBalance,
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
    // Faint spill: at 0.32 the patch above the cluster measured luma 56 against
    // the cluster's 36 (software WebGPU, sedan, driver framing).
    expect(fill.dash).toBeGreaterThan(0.12);
    expect(fill.dash).toBeLessThan(0.2);
    expect(fill.bounce).toBeGreaterThan(0.1);
    expect(fill.bounce).toBeLessThan(0.2);
  });

  it('headlights lift the dash spill and bounce only a little at night', () => {
    const base = { effectiveNight: 1, rain: 0, domeLightOn: false };
    const off = cabinFillTargets({ ...base, headlightsOn: false });
    const on = cabinFillTargets({ ...base, headlightsOn: true });
    expect(off.bounce).toBe(0);
    expect(on.dash).toBeGreaterThan(off.dash);
    expect(on.dash).toBeLessThan(off.dash * 1.6);
  });

  it('dome halo is night-weighted: faint by day, strong at night', () => {
    const base = { rain: 0, headlightsOn: false, domeLightOn: true };
    const day = domeGlowLevel({ ...base, effectiveNight: 0 });
    const night = domeGlowLevel({ ...base, effectiveNight: 1 });
    expect(day).toBeGreaterThan(0);
    expect(day).toBeLessThan(0.2);
    expect(night).toBeGreaterThan(0.9);
    expect(domeGlowLevel({ ...base, domeLightOn: false, effectiveNight: 1 })).toBe(0);
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
    // The toggle has to be a visible change on seats/wheel/floor (real-GPU shots,
    // dome on, luma 0–255, this pass vs before: wheel 11 → 22, dash top 6 → 19),
    // and the dome stays the dominant source — the cluster spill is a small
    // fraction of it.
    expect(fill.dome).toBeGreaterThan(1.0);
    expect(fill.dash).toBeLessThan(fill.dome * 0.3);
    expect(fill.hemi).toBeLessThan(0.02);
    expect(emit.domeFixture).toBeGreaterThan(0.7);
    expect(emit.domeFixture).toBeLessThanOrEqual(0.9);
    // The dials carry the cluster's light; the backplate well stays under them
    // so the cluster doesn't read as one flat neon slab.
    const dial = gaugeDialGlow({ effectiveNight: 1, headlightsOn: false, rpmFrac: 0, breathe: 0 });
    expect(emit.cluster).toBeGreaterThan(0.08);
    expect(emit.cluster).toBeLessThan(dial * 0.5);
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
    expect(fill.ambient).toBeLessThan(0.04);
    // Overhead is a soft fill. The sun directional (not this rig) is the key,
    // so a second overhead sun does not flatten the leather.
    expect(fill.overhead).toBeGreaterThan(0);
    expect(fill.overhead).toBeLessThan(0.12);
    expect(fill.overhead).toBeLessThan(fill.hemi);
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
    const sedanNight = cabinFillTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    expect(day.hemi).toBeGreaterThan(sedanDay.hemi);
    expect(night.hemi).toBeLessThan(0.02);
    expect(night.ambient).toBeLessThan(0.01);
    expect(night.hemi).toBeCloseTo(sedanNight.hemi, 5);
    expect(night.ambient).toBeCloseTo(sedanNight.ambient, 5);
    expect(night.overhead).toBe(sedanNight.overhead);
    expect(night.leftWindow).toBeCloseTo(sedanNight.leftWindow, 5);
    expect(night.rightWindow).toBeCloseTo(sedanNight.rightWindow, 5);
  });

  it('clinical theme does not change emitter or glow ramps', () => {
    const base = {
      effectiveNight: 1,
      rain: 0,
      headlightsOn: true,
      domeLightOn: true,
    };
    expect(cabinEmitterTargets({ ...base, clinical: true })).toEqual(
      cabinEmitterTargets(base),
    );
    expect(clusterGlowLevel({ ...base, clinical: true })).toBe(
      clusterGlowLevel(base),
    );
    expect(domeGlowLevel({ ...base, clinical: true })).toBe(
      domeGlowLevel(base),
    );
  });
  it('keeps gauge dials and needles near-dark by day and brightest at night', () => {
    const still = { rpmFrac: 0, breathe: 0, headlightsOn: false };
    const day = { ...still, effectiveNight: 0 };
    const night = { ...still, effectiveNight: 1 };

    expect(gaugeDialGlow(day)).toBeLessThan(0.1);
    expect(gaugeNeedleGlow(day)).toBeLessThan(0.2);
    expect(gaugeDialGlow(night)).toBeGreaterThan(0.65);
    expect(gaugeNeedleGlow(night)).toBeGreaterThan(0.8);
    // The needle is the sharpest thing in the cluster at either extreme.
    expect(gaugeNeedleGlow(night)).toBeGreaterThan(gaugeDialGlow(night));
    expect(gaugeNeedleGlow(day)).toBeGreaterThan(gaugeDialGlow(day));
  });

  it('adds the headlight backlight bump only at night, and lifts with revs', () => {
    const base = { effectiveNight: 0, rpmFrac: 0, breathe: 0 };
    expect(gaugeDialGlow({ ...base, headlightsOn: true })).toBeCloseTo(
      gaugeDialGlow({ ...base, headlightsOn: false }),
      5,
    );
    expect(gaugeNeedleGlow({ ...base, headlightsOn: true })).toBeCloseTo(
      gaugeNeedleGlow({ ...base, headlightsOn: false }),
      5,
    );

    const night = { ...base, effectiveNight: 1 };
    expect(gaugeDialGlow({ ...night, headlightsOn: true })).toBeGreaterThan(
      gaugeDialGlow({ ...night, headlightsOn: false }),
    );
    expect(gaugeNeedleGlow({ ...night, headlightsOn: true })).toBeGreaterThan(
      gaugeNeedleGlow({ ...night, headlightsOn: false }),
    );
    expect(gaugeNeedleGlow({ ...night, headlightsOn: false, rpmFrac: 1 })).toBeGreaterThan(
      gaugeNeedleGlow({ ...night, headlightsOn: false }),
    );
  });

  it('clamps gauge glow inputs so out-of-range night/rpm cannot blow out the cluster', () => {
    const hot = { effectiveNight: 4, rpmFrac: 3, breathe: 0, headlightsOn: true };
    const max = { effectiveNight: 1, rpmFrac: 1, breathe: 0, headlightsOn: true };
    expect(gaugeDialGlow(hot)).toBeCloseTo(gaugeDialGlow(max), 5);
    expect(gaugeNeedleGlow(hot)).toBeCloseTo(gaugeNeedleGlow(max), 5);
  });

  it('drives both dash screens from the same night factor with clamped ramps', () => {
    // Day floors: readable, not glowing.
    expect(centerDisplayGlowFromNight(0)).toBeCloseTo(0.24, 5);
    expect(locationPanelGlowFromNight(0)).toBeCloseTo(0.6, 5);
    // Full night: brighter, VFD hotter than the LCD.
    expect(centerDisplayGlowFromNight(1)).toBeCloseTo(0.66, 5);
    expect(locationPanelGlowFromNight(1)).toBeCloseTo(1.2, 5);
    expect(locationPanelGlowFromNight(1)).toBeGreaterThan(centerDisplayGlowFromNight(1));
    // Infotainment screen agrees with the shared center-display emitter ramp.
    const emit = cabinEmitterTargets({
      effectiveNight: 1,
      rain: 0,
      headlightsOn: false,
      domeLightOn: false,
    });
    expect(centerDisplayGlowFromNight(1)).toBeCloseTo(emit.centerDisplay, 5);
    // Out-of-range preset values cannot blow out the screens.
    expect(centerDisplayGlowFromNight(4)).toBeCloseTo(centerDisplayGlowFromNight(1), 5);
    expect(centerDisplayGlowFromNight(-2)).toBeCloseTo(centerDisplayGlowFromNight(0), 5);
    expect(locationPanelGlowFromNight(4)).toBeCloseTo(locationPanelGlowFromNight(1), 5);
    expect(locationPanelGlowFromNight(-2)).toBeCloseTo(locationPanelGlowFromNight(0), 5);
  });

  it('keeps content maps white and the dash spill warm, not an accent flood', () => {
    const luma = (hex: number) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    expect(CONTENT_MAP_EMISSIVE).toBe(0xffffff);
    expect(luma(CLUSTER_WELL_EMISSIVE)).toBeLessThan(0.02);
    expect(luma(DISPLAY_HOUSING_EMISSIVE)).toBeLessThan(0.02);
    expect(luma(DASH_SPILL_COLOR)).toBeGreaterThan(0.6);
    const r = (DASH_SPILL_COLOR >> 16) & 255;
    const g = (DASH_SPILL_COLOR >> 8) & 255;
    const b = DASH_SPILL_COLOR & 255;
    expect(r).toBeGreaterThan(b + 20);
    expect(g).toBeGreaterThan(b);
  });

  it('rain cuts the sun by at most 75% and clamps out-of-range rain', () => {
    expect(sunIntensityUnderWeather(1.55, 0, 0)).toBeCloseTo(1.55);
    expect(sunIntensityUnderWeather(1.55, 1, 0)).toBeCloseTo(1.55 * 0.25);
    expect(sunIntensityUnderWeather(1.55, 2, 0)).toBeCloseTo(1.55 * 0.25);
    expect(sunIntensityUnderWeather(1.55, -1, 0)).toBeCloseTo(1.55);
  });

  it.each([0, 0.5, 1])('fades direct sun to zero through the night ramp at rain=%s', (rain) => {
    const day = 1.55 * (1 - rain * 0.75);
    for (const night of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sunIntensityUnderWeather(1.55, rain, night)).toBeCloseTo(day * (1 - night), 6);
    }
    expect(sunIntensityUnderWeather(1.55, rain, 1)).toBe(0);
  });

  it('clamps night without adding sun below the horizon or inverting the light', () => {
    expect(sunIntensityUnderWeather(1.55, 0, -1)).toBe(1.55);
    expect(sunIntensityUnderWeather(1.55, 0, 2)).toBe(0);
    for (const night of [0, 0.5, 1]) {
      expect(sunIntensityUnderWeather(0, 0, night)).toBe(0);
    }
  });

  it('sun side: low sun off one window takes a side, noon / ahead / below horizon do not', () => {
    // Bearing is car-relative: +π/2 = passenger (right) window.
    expect(sunSideFromBearing(Math.PI / 2, 10 * DEG)).toBeGreaterThan(0.9);
    expect(sunSideFromBearing(-Math.PI / 2, 10 * DEG)).toBeLessThan(-0.9);
    expect(sunSideFromBearing(0, 10 * DEG)).toBeCloseTo(0, 6);
    expect(sunSideFromBearing(Math.PI, 10 * DEG)).toBeCloseTo(0, 6);
    // High sun pours in evenly; the side term fades with cos²(altitude).
    expect(Math.abs(sunSideFromBearing(Math.PI / 2, 80 * DEG))).toBeLessThan(0.05);
    expect(sunSideFromBearing(Math.PI / 2, 45 * DEG)).toBeCloseTo(0.5, 6);
    // No direct sun below the horizon, whatever the bearing.
    expect(sunSideFromBearing(Math.PI / 2, -5 * DEG)).toBe(0);
    expect(sunSideFromBearing(Math.PI / 2, 0)).toBe(0);
  });

  it('window fill balance moves daylight to the sun side without adding any', () => {
    const even = windowFillBalance(0, 0);
    expect(even).toEqual({ left: 1, right: 1 });

    const right = windowFillBalance(1, 0);
    expect(right.right).toBeGreaterThan(right.left);
    expect(right.right).toBeLessThanOrEqual(1.6);
    expect(right.left).toBeGreaterThanOrEqual(0.4);
    expect((right.left + right.right) / 2).toBeCloseTo(1, 6);

    const left = windowFillBalance(-1, 0);
    expect(left.left).toBe(right.right);
    expect(left.right).toBe(right.left);

    // Overcast diffuses the skylight: the split flattens back toward even.
    const overcast = windowFillBalance(1, 1);
    expect(overcast).toEqual({ left: 1, right: 1 });
    const drizzle = windowFillBalance(1, 0.5);
    expect(drizzle.right - drizzle.left).toBeCloseTo((right.right - right.left) / 2, 6);

    // Out-of-range inputs clamp instead of inverting a window.
    expect(windowFillBalance(5, 0)).toEqual(windowFillBalance(1, 0));
    expect(windowFillBalance(0, -1)).toEqual(windowFillBalance(0, 0));
  });

  it('day window fills follow the sun side; night fills and the rest of the rig ignore it', () => {
    const base = { effectiveNight: 0, rain: 0, headlightsOn: false, domeLightOn: false };
    const even = cabinFillTargets(base);
    const sunRight = cabinFillTargets({ ...base, sunSide: 1 });
    const sunLeft = cabinFillTargets({ ...base, sunSide: -1 });

    expect(sunRight.rightWindow).toBeGreaterThan(even.rightWindow);
    expect(sunRight.leftWindow).toBeLessThan(even.leftWindow);
    expect(sunLeft.leftWindow).toBeGreaterThan(even.leftWindow);
    expect(sunLeft.rightWindow).toBeLessThan(even.rightWindow);
    // Sun off the passenger window flips the driver-side bias of the base fills.
    expect(sunRight.rightWindow).toBeGreaterThan(sunRight.leftWindow);
    // Omitted sunSide is the balanced rig.
    expect(cabinFillTargets({ ...base, sunSide: 0 })).toEqual(even);

    // Only the window fills move.
    for (const key of ['hemi', 'ambient', 'overhead', 'bounce', 'dash', 'dome', 'headlights'] as const) {
      expect(sunRight[key]).toBe(even[key]);
      expect(sunLeft[key]).toBe(even[key]);
    }

    // At night the day term is gone, so the streetlight hint stays flat.
    const night = { ...base, effectiveNight: 1 };
    expect(cabinFillTargets({ ...night, sunSide: 1 })).toEqual(cabinFillTargets(night));
  });
});
