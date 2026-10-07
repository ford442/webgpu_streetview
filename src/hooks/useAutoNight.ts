import { useEffect, useRef } from 'react';
import { computeAutoNight, stepNightIntensity, type AutoNightSample } from '../utils/autoNightModel';

interface Coords { lat: number; lng: number; }

/** Sun moves ~0.25°/min — recomputing faster than this is imperceptible. */
export const AUTO_NIGHT_RECOMPUTE_MS = 30_000;
export const AUTO_NIGHT_SMOOTH_MS = 250;

/**
 * Drives nightIntensity and the sun/moon uniforms from the real clock at the
 * current Street View location (model: `utils/autoNightModel.ts`).
 *
 * @param coords           Current lat/lng; null until the first panorama resolves.
 * @param enabled          Auto-night mode on/off.
 * @param currentNight     The live nightIntensity (the smoother steps from it, so
 *                         re-enabling Auto from a manual preset eases instead of jumping).
 * @param onNightIntensity Called with each smoothed nightIntensity value.
 * @param onSunMoon        Called on every recompute with raw sun/moon angles (radians).
 */
export function useAutoNight(
  coords: Coords | null,
  enabled: boolean,
  currentNight: number,
  onNightIntensity: (value: number) => void,
  onSunMoon?: (sample: AutoNightSample) => void,
  now: () => Date = () => new Date(),
): void {
  const targetRef = useRef<number | null>(null);
  const currentRef = useRef(currentNight);
  currentRef.current = currentNight;
  const onNightRef = useRef(onNightIntensity);
  onNightRef.current = onNightIntensity;
  const onSunMoonRef = useRef(onSunMoon);
  onSunMoonRef.current = onSunMoon;
  const nowRef = useRef(now);
  nowRef.current = now;

  const lat = coords?.lat;
  const lng = coords?.lng;

  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined) {
      targetRef.current = null;
      return;
    }
    const recompute = () => {
      const sample = computeAutoNight(nowRef.current(), lat, lng);
      targetRef.current = sample.nightIntensity;
      onSunMoonRef.current?.(sample);
    };
    recompute();
    const recomputeId = setInterval(recompute, AUTO_NIGHT_RECOMPUTE_MS);
    const smoothId = setInterval(() => {
      const target = targetRef.current;
      if (target === null) return;
      const next = stepNightIntensity(currentRef.current, target);
      if (next !== currentRef.current) {
        currentRef.current = next;
        onNightRef.current(next);
      }
    }, AUTO_NIGHT_SMOOTH_MS);
    return () => {
      clearInterval(recomputeId);
      clearInterval(smoothId);
    };
  }, [enabled, lat, lng]);
}
