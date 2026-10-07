import { useMemo } from 'react';
import { useStreetView } from '../hooks/useStreetView';
import { useEnvironmentSettings } from '../hooks/useEnvironmentSettings';
import { useAutoNight } from '../hooks/useAutoNight';

/**
 * Mounts `useAutoNight` for the whole app: while `autoNightMode` is on, the
 * night intensity and sun/moon uniforms follow the real clock at the current
 * panorama. Renders nothing. Must sit under both StreetView and
 * EnvironmentSettings providers (see AppProviders).
 */
export function AutoNightDriver(): null {
  const { position } = useStreetView();
  const {
    autoNightMode,
    nightIntensity,
    setNightIntensity,
    setSunAzimuth,
    setSunAltitude,
    setMoonAzimuth,
    setMoonAltitude,
    setMoonIntensity,
  } = useEnvironmentSettings();

  const lat = position?.lat();
  const lng = position?.lng();
  const coords = useMemo(
    () => (lat !== undefined && lng !== undefined ? { lat, lng } : null),
    [lat, lng],
  );

  useAutoNight(coords, autoNightMode, nightIntensity, setNightIntensity, (s) => {
    setSunAzimuth(s.sunAzimuth);
    setSunAltitude(s.sunAltitude);
    setMoonAzimuth(s.moonAzimuth);
    setMoonAltitude(s.moonAltitude);
    setMoonIntensity(s.moonIntensity);
  });

  return null;
}
