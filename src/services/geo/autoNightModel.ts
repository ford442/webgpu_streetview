import SunCalc from 'suncalc';

/**
 * Pure sun/moon → night-intensity model behind auto-night (`useAutoNight`).
 * Kept free of React/timers so the clock-follows-sun contract is unit-testable.
 *
 * Sun altitude → base nightIntensity:
 *   > 0.0 rad      → 0.0  (full daylight)
 *   0.0 → -0.105  → 0.0 → 0.5  (sunset / civil twilight, -6°)
 *  -0.105 → -0.314 → 0.5 → 1.0  (nautical / astronomical dusk, -18°)
 *   < -0.314       → 1.0  (full night)
 * Full-night is softened to as low as 0.85 by moonlight (phase × altitude × opposition surge).
 */
export interface AutoNightSample {
  /** Target night intensity 0–1 (before smoothing). */
  nightIntensity: number;
  sunAzimuth: number;
  sunAltitude: number;
  moonAzimuth: number;
  moonAltitude: number;
  moonIntensity: number;
}

export function sunAltitudeToBaseNight(altitude: number): number {
  if (altitude > 0.0) return 0.0;
  if (altitude > -0.105) return (0.0 - altitude) / 0.105 * 0.5;
  if (altitude > -0.314) return 0.5 + (-0.105 - altitude) / 0.209 * 0.5;
  return 1.0;
}

export function computeAutoNight(date: Date, lat: number, lng: number): AutoNightSample {
  const sun = SunCalc.getPosition(date, lat, lng);
  const moon = SunCalc.getMoonPosition(date, lat, lng);
  const moonPhase = SunCalc.getMoonIllumination(date).fraction; // 0–1 illuminated

  const base = sunAltitudeToBaseNight(sun.altitude);

  const moonAltitudeFactor = moon.altitude > 0 ? Math.sin(moon.altitude) : 0;
  // Opposition surge: the full moon is brighter than its illuminated fraction implies.
  const oppositionSurge = 1.0 + 0.5 * moonPhase;
  const moonIntensity = moonPhase * moonAltitudeFactor * oppositionSurge;

  // Twilight needs no moonlight correction; full night is lifted by up to 15%.
  const nightIntensity =
    base < 1.0 ? base : 1.0 - Math.min(moonIntensity / 1.5, 1.0) * 0.15;

  return {
    nightIntensity,
    sunAzimuth: sun.azimuth,
    sunAltitude: sun.altitude,
    moonAzimuth: moon.azimuth,
    moonAltitude: moon.altitude,
    moonIntensity,
  };
}

/** Max step per tick for normal drift (the sun is slow — pops would be visible). */
export const NIGHT_STEP_MIN = 0.002;

/**
 * One smoothing step toward `target`. Normal drift is capped at NIGHT_STEP_MIN;
 * a large gap (teleport across time zones, re-enabling Auto) closes ~10%/tick
 * instead of taking minutes.
 */
export function stepNightIntensity(current: number, target: number): number {
  const diff = target - current;
  if (Math.abs(diff) < 0.001) return current;
  const step = Math.min(Math.abs(diff), Math.max(NIGHT_STEP_MIN, Math.abs(diff) * 0.1));
  return parseFloat((current + Math.sign(diff) * step).toFixed(4));
}
