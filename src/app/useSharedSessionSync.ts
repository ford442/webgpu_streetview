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

  // Host broadcasts POV at 10Hz to connected guests.
  useEffect(() => {
    if (sharedSession.role !== 'host' || !sharedSession.isConnected) return;
    const interval = setInterval(() => {
      const payload = buildHostBroadcastPayload(panorama, { heading, pitch, zoom }, viewMode);
      if (!payload) return;
      sharedSession.broadcastState(payload);
    }, 100);
    return () => clearInterval(interval);
  }, [
    sharedSession.role,
    sharedSession.isConnected,
    sharedSession.broadcastState,
    panorama,
    heading,
    pitch,
    zoom,
    viewMode,
  ]);

  // Guests follow the host's POV as it arrives.
  useEffect(() => {
    if (sharedSession.role !== 'guest') return;
    const state = sharedSession.latestState;
    if (!state) return;

    const currentPanoId = panorama?.getPano();
    if (shouldTeleportGuestToPano(state.panoId, currentPanoId, lastAppliedPanoRef.current)) {
      lastAppliedPanoRef.current = state.panoId;
      void teleportToPanoSafe(state.panoId);
    }
    setHeading(state.pov.heading);
    setPitch(state.pov.pitch);
    setZoom(state.pov.zoom);
  }, [
    sharedSession.role,
    sharedSession.latestState,
    panorama,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
  ]);
}
