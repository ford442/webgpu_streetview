import { useCallback } from 'react';
import { vehicleManager } from '../car/eager';
import type { EnvironmentSettingsState } from '../hooks/useEnvironmentSettings';
import type { DirectorSnapshot } from '../hooks/useTours';
import type { TourDirectorKeyframe } from '../hooks/tourDirector';

export interface UseAppDirectorResult {
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
 * back on playback, and the wire form the shared session
 * sends to guests lives with the sync (`SharedSessionSync`). Keeping them together means the set of axes a tour
 * can drive is defined in one place.
 */
export function useAppDirector(getEnv: () => EnvironmentSettingsState): UseAppDirectorResult {
  // Both read the environment when called, so the shell never re-renders on a slider.
  const getDirectorSnapshot = useCallback((): DirectorSnapshot | null => {
    const { timeOfDay, rainIntensity, snowIntensity, fogDensity } = getEnv();
    return { timeOfDay, vehicle: vehicleManager.getCurrentVehicle(), rainIntensity, snowIntensity, fogDensity };
  }, [getEnv]);

  const applyDirectorKeyframe = useCallback(
    (frame: TourDirectorKeyframe) => {
      const env = getEnv();
      if (frame.timeOfDay) env.applyTimeOfDayPreset(frame.timeOfDay);
      if (frame.rainIntensity !== undefined) env.setRainIntensity(frame.rainIntensity);
      if (frame.snowIntensity !== undefined) env.setSnowIntensity(frame.snowIntensity);
      if (frame.fogDensity !== undefined) env.setFogDensity(frame.fogDensity);
      if (frame.colorGradingPreset) env.applyColorGradingPreset(frame.colorGradingPreset);
      if (frame.vehicle) vehicleManager.setVehicle(frame.vehicle);
    },
    [getEnv],
  );

  return { getDirectorSnapshot, applyDirectorKeyframe };
}
