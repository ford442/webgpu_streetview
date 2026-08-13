import type { SessionState } from '../hooks/useSharedSession';

export type HostBroadcastPov = SessionState['pov'];
export type HostBroadcastViewMode = SessionState['viewMode'];

export type HostBroadcastPayload = Omit<SessionState, 'seq'>;

/** Minimal panorama surface needed to build a host broadcast payload. */
export interface HostBroadcastPanorama {
  getPano(): string | null | undefined;
  getPosition(): { lat(): number; lng(): number } | null | undefined;
}

export interface HostBroadcastExtras {
  weatherPreset?: string;
}

/**
 * Build the POV snapshot a host broadcasts to guests.
 * Returns null when pano id or position is unavailable.
 */
export function buildHostBroadcastPayload(
  panorama: HostBroadcastPanorama | null | undefined,
  pov: HostBroadcastPov,
  viewMode: HostBroadcastViewMode,
  extras?: HostBroadcastExtras,
): HostBroadcastPayload | null {
  if (!panorama) return null;
  const panoId = panorama.getPano();
  const pos = panorama.getPosition();
  if (!panoId || !pos) return null;
  return {
    panoId,
    position: { lat: pos.lat(), lng: pos.lng() },
    pov,
    viewMode,
    ...(extras?.weatherPreset ? { weatherPreset: extras.weatherPreset } : {}),
  };
}

/**
 * Whether a guest should teleport to an incoming host pano.
 * Skips when the pano is already current or was the last one we applied.
 */
export function shouldTeleportGuestToPano(
  incomingPanoId: string | null | undefined,
  currentPanoId: string | null | undefined,
  lastAppliedPanoId: string | null | undefined,
): boolean {
  if (!incomingPanoId) return false;
  if (incomingPanoId === currentPanoId) return false;
  if (incomingPanoId === lastAppliedPanoId) return false;
  return true;
}
