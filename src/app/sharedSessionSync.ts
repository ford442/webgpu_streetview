import type { SessionState } from '../hooks/useSharedSession';
import { isLookId } from '../config/lookPacks';
import { isValidVehicleType, type VehicleType } from '../car/VehicleManager';
import { isCabinView, type CabinView } from '../car/cabinView';

export type { CabinView } from '../car/cabinView';

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
  lookId?: string | null;
  imageDate?: string | null;
  vehicleType?: string | null;
  cabinView?: CabinView | null;
  carHeading?: number;
  hdr?: boolean;
}

export interface NormalizedSessionFilmSet {
  lookId?: string;
  imageDate?: string;
  vehicleType?: VehicleType;
  cabinView?: CabinView;
  carHeading?: number;
  hdr?: boolean;
}

/**
 * Drop unknown look / vehicle / cabin ids so a stale or forked peer cannot
 * white-screen a guest. Seq ordering is handled separately.
 */
export function normalizeIncomingSessionFields(
  incoming: Partial<NormalizedSessionFilmSet> & {
    lookId?: unknown;
    imageDate?: unknown;
    vehicleType?: unknown;
    cabinView?: unknown;
    carHeading?: unknown;
    hdr?: unknown;
  },
): NormalizedSessionFilmSet {
  const out: NormalizedSessionFilmSet = {};
  if (typeof incoming.lookId === 'string' && isLookId(incoming.lookId)) {
    out.lookId = incoming.lookId;
  }
  if (typeof incoming.imageDate === 'string' && /^\d{4}(?:-\d{2})?$/.test(incoming.imageDate)) {
    out.imageDate = incoming.imageDate;
  }
  if (typeof incoming.vehicleType === 'string' && isValidVehicleType(incoming.vehicleType)) {
    out.vehicleType = incoming.vehicleType;
  }
  if (isCabinView(incoming.cabinView)) {
    out.cabinView = incoming.cabinView;
  }
  if (typeof incoming.carHeading === 'number' && Number.isFinite(incoming.carHeading)) {
    out.carHeading = ((incoming.carHeading % 360) + 360) % 360;
  }
  if (typeof incoming.hdr === 'boolean') {
    out.hdr = incoming.hdr;
  }
  return out;
}

/** First packet may seed guest heading; later ticks leave head look local. */
export function shouldApplyGuestHeadLook(hasAppliedInitialLook: boolean): boolean {
  return !hasAppliedInitialLook;
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

  const film = extras
    ? normalizeIncomingSessionFields({
        lookId: extras.lookId ?? undefined,
        imageDate: extras.imageDate ?? undefined,
        vehicleType: extras.vehicleType ?? undefined,
        cabinView: extras.cabinView ?? undefined,
        carHeading: extras.carHeading,
        hdr: extras.hdr,
      })
    : {};

  return {
    panoId,
    position: { lat: pos.lat(), lng: pos.lng() },
    pov,
    viewMode,
    ...(extras?.weatherPreset ? { weatherPreset: extras.weatherPreset } : {}),
    ...film,
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
