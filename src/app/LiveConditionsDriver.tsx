import { useEffect, useRef } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useLightingSettings, useWeatherSettings } from '../hooks/useEnvironmentSettings';
import {
  fetchLiveConditions,
  mapConditionsToWeather,
  shouldFetchConditions,
  type WeatherTarget,
} from '../services/conditions/openMeteo';
import { liveConditionsStore, useLiveConditions } from '../state/liveConditionsStore';

/** Time the weather takes to ease onto new live conditions — a hop never snaps the sky. */
export const LIVE_CONDITIONS_SMOOTHING_MS = 1000;

/** How often the driver re-checks the fetch policy while enabled. */
const POLICY_TICK_MS = 30_000;

const KEYS = ['rainIntensity', 'snowIntensity', 'fogDensity', 'wind'] as const;

/**
 * Live local conditions (opt-in): fetch the real weather at the panorama under
 * the Open-Meteo request policy, ease the weather controls onto it, and hand
 * control back to the user the moment they move a weather slider. Time of day
 * follows pano-local real time (auto-night) while live conditions are on.
 * Renders nothing; mounted under the providers next to `AutoNightDriver`.
 */
export function LiveConditionsDriver(): null {
  const { position } = useStreetView();
  const weather = useWeatherSettings();
  const { setAutoNightMode } = useLightingSettings();
  const enabled = useLiveConditions((s) => s.enabled);
  const status = useLiveConditions((s) => s.status);
  const target = useLiveConditions((s) => s.target);

  const setters = useRef(weather);
  setters.current = weather;
  const lastFetch = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const inFlight = useRef(false);
  /** Values this driver last wrote; anything else on the controls is the user. */
  const written = useRef<WeatherTarget | null>(null);
  const tweening = useRef(false);

  const lat = position?.lat();
  const lng = position?.lng();

  // Live conditions mean the real local sky: auto-night follows the pano's clock.
  useEffect(() => {
    if (enabled) setAutoNightMode(true);
  }, [enabled, setAutoNightMode]);

  // Fetch under the policy, on position changes and on a slow tick.
  useEffect(() => {
    if (!enabled) {
      // lastFetch survives a toggle: flipping it must not buy extra requests.
      written.current = null;
      return;
    }
    const controller = new AbortController();
    const maybeFetch = (): void => {
      if (lat === undefined || lng === undefined || inFlight.current) return;
      const now = Date.now();
      if (!shouldFetchConditions(lastFetch.current, { lat, lng }, now)) return;
      lastFetch.current = { lat, lng, at: now };
      inFlight.current = true;
      fetchLiveConditions(lat, lng, { signal: controller.signal, now })
        .then((conditions) => {
          const s = liveConditionsStore.get();
          liveConditionsStore.update({
            conditions,
            target: mapConditionsToWeather(conditions),
            error: null,
            status: s.status === 'overridden' ? 'overridden' : 'live',
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          liveConditionsStore.update({ status: 'error', error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          inFlight.current = false;
        });
    };
    maybeFetch();
    const timer = setInterval(maybeFetch, POLICY_TICK_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
      inFlight.current = false;
    };
  }, [enabled, lat, lng]);

  // Ease the controls onto the target over LIVE_CONDITIONS_SMOOTHING_MS.
  useEffect(() => {
    if (!enabled || status !== 'live' || !target) return;
    const s = setters.current;
    const from: WeatherTarget = {
      rainIntensity: s.rainIntensity,
      snowIntensity: s.snowIntensity,
      fogDensity: s.fogDensity,
      wind: s.wind,
    };
    if (KEYS.every((k) => from[k] === target[k])) {
      written.current = target;
      return;
    }
    const apply = (v: WeatherTarget): void => {
      written.current = v;
      setters.current.setRainIntensity(v.rainIntensity);
      setters.current.setSnowIntensity(v.snowIntensity);
      setters.current.setFogDensity(v.fogDensity);
      setters.current.setWind(v.wind);
    };
    const t0 = performance.now();
    let raf = 0;
    tweening.current = true;
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / LIVE_CONDITIONS_SMOOTHING_MS);
      const e = k * k * (3 - 2 * k);
      apply({
        rainIntensity: Math.round(from.rainIntensity + (target.rainIntensity - from.rainIntensity) * e),
        snowIntensity: Math.round(from.snowIntensity + (target.snowIntensity - from.snowIntensity) * e),
        fogDensity: Math.round(from.fogDensity + (target.fogDensity - from.fogDensity) * e),
        wind: Math.round(from.wind + (target.wind - from.wind) * e),
      });
      if (k < 1) raf = requestAnimationFrame(step);
      else tweening.current = false;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      tweening.current = false;
    };
  }, [enabled, status, target]);

  // A weather control that no longer reads what we wrote was moved by the user.
  const { rainIntensity, snowIntensity, fogDensity, wind } = weather;
  useEffect(() => {
    const w = written.current;
    if (!enabled || status !== 'live' || !w) return;
    const current: WeatherTarget = { rainIntensity, snowIntensity, fogDensity, wind };
    if (KEYS.some((k) => current[k] !== w[k])) {
      written.current = null;
      liveConditionsStore.update({ status: 'overridden' });
    }
  }, [enabled, status, rainIntensity, snowIntensity, fogDensity, wind]);

  return null;
}
