import { useEffect, useRef } from 'react';
import type { UseSharedSessionResult } from '../hooks/useSharedSession';
import { buildHostBroadcastPayload, shouldTeleportGuestToPano } from './sharedSessionSync';
import { parseWeatherPreset } from '../utils/weatherPresetSync';
import type { TimeOfDay } from '../hooks/useEnvironmentSettings';

export interface UseSharedSessionSyncParams {
  sharedSession: UseSharedSessionResult;
  panorama: google.maps.StreetViewPanorama | null;
  heading: number;
  pitch: number;
  zoom: number;
  viewMode: 'freelook' | 'car';
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  /** Serialized weather preset broadcast by host (see weatherPresetSync). */
  weatherPreset?: string;
  applyTimeOfDayPreset?: (preset: TimeOfDay) => void;
  setRainIntensity?: (v: number) => void;
  setSnowIntensity?: (v: number) => void;
  setFogDensity?: (v: number) => void;
}

/**
 * AppShell glue for shared sessions: host 10Hz POV broadcast + guest follow.
 */
export function useSharedSessionSync({
  sharedSession,
  panorama,
  heading,
  pitch,
  zoom,
  viewMode,
  teleportToPanoSafe,
  setHeading,
  setPitch,
  setZoom,
  weatherPreset,
  applyTimeOfDayPreset,
  setRainIntensity,
  setSnowIntensity,
  setFogDensity,
}: UseSharedSessionSyncParams): void {
  const lastAppliedPanoRef = useRef<string | null>(null);
  const lastWeatherPresetRef = useRef<string | null>(null);

  const {
    role: sessionRole,
    isConnected: sessionConnected,
    broadcastState,
    latestState,
  } = sharedSession;

  // Host broadcasts POV at 10Hz to connected guests.
  useEffect(() => {
    if (sessionRole !== 'host' || !sessionConnected) return;
    const interval = setInterval(() => {
      const payload = buildHostBroadcastPayload(
        panorama,
        { heading, pitch, zoom },
        viewMode,
        weatherPreset ? { weatherPreset } : undefined,
      );
      if (!payload) return;
      broadcastState(payload);
    }, 100);
    return () => clearInterval(interval);
  }, [
    sessionRole,
    sessionConnected,
    broadcastState,
    panorama,
    heading,
    pitch,
    zoom,
    viewMode,
    weatherPreset,
  ]);

  // Guests follow the host's POV as it arrives.
  useEffect(() => {
    if (sessionRole !== 'guest') return;
    if (!latestState) return;

    const currentPanoId = panorama?.getPano();
    if (shouldTeleportGuestToPano(latestState.panoId, currentPanoId, lastAppliedPanoRef.current)) {
      lastAppliedPanoRef.current = latestState.panoId;
      void teleportToPanoSafe(latestState.panoId);
    }
    setHeading(latestState.pov.heading);
    setPitch(latestState.pov.pitch);
    setZoom(latestState.pov.zoom);

    if (
      latestState.weatherPreset &&
      latestState.weatherPreset !== lastWeatherPresetRef.current
    ) {
      lastWeatherPresetRef.current = latestState.weatherPreset;
      const parsed = parseWeatherPreset(latestState.weatherPreset);
      if (parsed) {
        if (parsed.timeOfDay && applyTimeOfDayPreset) applyTimeOfDayPreset(parsed.timeOfDay);
        if (parsed.rainIntensity !== undefined && setRainIntensity) setRainIntensity(parsed.rainIntensity);
        if (parsed.snowIntensity !== undefined && setSnowIntensity) setSnowIntensity(parsed.snowIntensity);
        if (parsed.fogDensity !== undefined && setFogDensity) setFogDensity(parsed.fogDensity);
      }
    }
  }, [
    sessionRole,
    latestState,
    panorama,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
    applyTimeOfDayPreset,
    setRainIntensity,
    setSnowIntensity,
    setFogDensity,
  ]);
}
