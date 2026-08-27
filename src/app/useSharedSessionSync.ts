import { useEffect, useRef } from 'react';
import type { UseSharedSessionResult } from '../hooks/useSharedSession';
import {
  buildHostBroadcastPayload,
  normalizeIncomingSessionFields,
  shouldApplyGuestHeadLook,
  shouldTeleportGuestToPano,
  type CabinView,
  type HostBroadcastExtras,
} from './sharedSessionSync';
import { parseWeatherPreset } from '../utils/weatherPresetSync';
import type { TimeOfDay } from '../hooks/useEnvironmentSettings';
import type { VehicleType } from '../car/VehicleManager';

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
  lookId?: string | null;
  imageDate?: string | null;
  vehicleType?: string | null;
  cabinView?: CabinView | null;
  carHeading?: number;
  hdr?: boolean;
  applyLookPack?: (id: string) => void;
  setVehicleType?: (type: VehicleType) => void;
  setViewMode?: (mode: 'freelook' | 'car') => void;
  setCarHeading?: (heading: number) => void;
  setCabinView?: (view: CabinView) => void;
}

/**
 * AppShell glue for shared sessions: host 10Hz POV broadcast + guest film-set follow.
 * Guests lock pano / look / vehicle / year (via pano) / chassis; head look stays local after the first packet.
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
  lookId,
  imageDate,
  vehicleType,
  cabinView,
  carHeading,
  hdr,
  applyLookPack,
  setVehicleType,
  setViewMode,
  setCarHeading,
  setCabinView,
}: UseSharedSessionSyncParams): void {
  const lastAppliedPanoRef = useRef<string | null>(null);
  const lastWeatherPresetRef = useRef<string | null>(null);
  const lastLookIdRef = useRef<string | null>(null);
  const lastVehicleRef = useRef<string | null>(null);
  const lastViewModeRef = useRef<string | null>(null);
  const lastCabinViewRef = useRef<string | null>(null);
  const appliedInitialLookRef = useRef(false);

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
      const extras: HostBroadcastExtras = {
        ...(weatherPreset ? { weatherPreset } : {}),
        lookId: lookId ?? undefined,
        imageDate: imageDate ?? undefined,
        vehicleType: vehicleType ?? undefined,
        cabinView: cabinView ?? undefined,
        carHeading,
        hdr,
      };
      const payload = buildHostBroadcastPayload(
        panorama,
        { heading, pitch, zoom },
        viewMode,
        extras,
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
    lookId,
    imageDate,
    vehicleType,
    cabinView,
    carHeading,
    hdr,
  ]);

  // Guests follow the host film set as it arrives.
  useEffect(() => {
    if (sessionRole !== 'guest') return;
    if (!latestState) return;

    const film = normalizeIncomingSessionFields(latestState);

    const currentPanoId = panorama?.getPano();
    if (shouldTeleportGuestToPano(latestState.panoId, currentPanoId, lastAppliedPanoRef.current)) {
      lastAppliedPanoRef.current = latestState.panoId;
      void teleportToPanoSafe(latestState.panoId);
    }

    if (shouldApplyGuestHeadLook(appliedInitialLookRef.current)) {
      setHeading(latestState.pov.heading);
      setPitch(latestState.pov.pitch);
      appliedInitialLookRef.current = true;
    }
    setZoom(latestState.pov.zoom);

    if (latestState.viewMode && latestState.viewMode !== lastViewModeRef.current) {
      lastViewModeRef.current = latestState.viewMode;
      setViewMode?.(latestState.viewMode);
    }

    if (typeof film.carHeading === 'number') {
      setCarHeading?.(film.carHeading);
    }

    if (film.lookId && film.lookId !== lastLookIdRef.current) {
      lastLookIdRef.current = film.lookId;
      applyLookPack?.(film.lookId);
    }

    if (film.vehicleType && film.vehicleType !== lastVehicleRef.current) {
      lastVehicleRef.current = film.vehicleType;
      setVehicleType?.(film.vehicleType);
    }

    if (film.cabinView && film.cabinView !== lastCabinViewRef.current) {
      lastCabinViewRef.current = film.cabinView;
      setCabinView?.(film.cabinView);
    }

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
    applyLookPack,
    setVehicleType,
    setViewMode,
    setCarHeading,
    setCabinView,
  ]);
}
