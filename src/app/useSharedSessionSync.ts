import { useEffect, useRef } from 'react';
import type { UseSharedSessionResult } from '../hooks/useSharedSession';
import { buildHostBroadcastPayload, shouldTeleportGuestToPano } from './sharedSessionSync';

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
}: UseSharedSessionSyncParams): void {
  const lastAppliedPanoRef = useRef<string | null>(null);

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
      const payload = buildHostBroadcastPayload(panorama, { heading, pitch, zoom }, viewMode);
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
  }, [
    sessionRole,
    latestState,
    panorama,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
  ]);
}
