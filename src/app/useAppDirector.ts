import { useCallback, useMemo } from 'react';
import { vehicleManager } from '../car/VehicleManager';
import { serializeWeatherPreset } from '../utils/weatherPresetSync';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { DirectorSnapshot } from '../hooks/useTours';
import type { TourDirectorKeyframe } from '../utils/tourDirector';

export interface UseAppDirectorResult {
  /** Serialized weather preset broadcast to shared-session guests. */
  weatherPresetBroadcast: ReturnType<typeof serializeWeatherPreset>;
  /** Current look, captured when a tour records a director keyframe. */
  getDirectorSnapshot: () => DirectorSnapshot | null;
  /** Apply a recorded keyframe during tour playback. */
  applyDirectorKeyframe: (frame: TourDirectorKeyframe) => void;
}

/**
 * Tour-director + shared-session weather bindings.
 *
 * Both directions of the same state: `getDirectorSnapshot` reads the live
 * environment when a tour records a keyframe, `applyDirectorKeyframe` writes it
 * back on playback, and `weatherPresetBroadcast` is the wire form the shared
 * session sends to guests. Keeping them together means the set of axes a tour
 * can drive is defined in one place.
 */
export function useAppDirector(env: EnvironmentSettingsState): UseAppDirectorResult {
  const { timeOfDay, rainIntensity, snowIntensity, fogDensity } = env;

  const weatherPresetBroadcast = useMemo(
    () =>
      serializeWeatherPreset({
        timeOfDay,
        rainIntensity,
        snowIntensity,
        fogDensity,
      }),
    [timeOfDay, rainIntensity, snowIntensity, fogDensity],
  );

  const getDirectorSnapshot = useCallback(
    (): DirectorSnapshot | null => ({
      timeOfDay,
      vehicle: vehicleManager.getCurrentVehicle(),
      rainIntensity,
      snowIntensity,
      fogDensity,
    }),
    [timeOfDay, rainIntensity, snowIntensity, fogDensity],
  );

  const applyDirectorKeyframe = useCallback(
    (frame: TourDirectorKeyframe) => {
      if (frame.timeOfDay) env.applyTimeOfDayPreset(frame.timeOfDay);
      if (frame.rainIntensity !== undefined) env.setRainIntensity(frame.rainIntensity);
      if (frame.snowIntensity !== undefined) env.setSnowIntensity(frame.snowIntensity);
      if (frame.fogDensity !== undefined) env.setFogDensity(frame.fogDensity);
      if (frame.colorGradingPreset) env.applyColorGradingPreset(frame.colorGradingPreset);
      if (frame.vehicle) vehicleManager.setVehicle(frame.vehicle);
    },
    [env],
  );

  return { weatherPresetBroadcast, getDirectorSnapshot, applyDirectorKeyframe };
}
