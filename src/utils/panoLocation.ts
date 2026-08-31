/**
 * panoLocation.ts
 *
 * Location labels for a Street View panorama:
 *   - HUD uses `panorama.getLocation().description` (sync, no extra APIs)
 *   - Capture date comes from `StreetViewService.getPanorama` (not Geocoding)
 *   - Reverse-geocode (`Geocoder.geocode({ location })`) is opt-in only:
 *     search / globe drop / explicit full-address. Never on cruise hops.
 *
 * Cached per pano id. REQUEST_DENIED trips a session circuit (geocodeAuth)
 * so we log once and skip further Geocoder calls.
 */

import { isGeocodeDenied, noteGeocodeStatus } from '../search/geocodeAuth';

export interface PanoLocationInfo {
  panoId: string;
  /** Google's short place description (road/area), available synchronously. */
  description: string | null;
  lat: number | null;
  lng: number | null;
  /** Reverse-geocoded street address — only after `includeAddress`. */
  address: string | null;
  /** Capture date string, e.g. "2022-05" (async, Street View metadata). */
  captureDate: string | null;
}

export interface ResolvePanoLocationOptions {
  /**
   * Call Geocoding API for a formatted street address.
   * Default false — cruise / HUD / hop must never set this.
   */
  includeAddress?: boolean;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Quantize a bearing in degrees to an 8-point compass label. */
export function headingToCompass(heading: number): string {
  const h = (((heading % 360) + 360) % 360);
  return COMPASS[Math.round(h / 45) % 8]!;
}

const cache = new Map<string, PanoLocationInfo>();
const inFlight = new Map<string, Promise<PanoLocationInfo>>();

let geocoder: google.maps.Geocoder | null = null;
let svService: google.maps.StreetViewService | null = null;

function getGeocoder(): google.maps.Geocoder | null {
  if (typeof google === 'undefined' || !google.maps) return null;
  if (!geocoder) geocoder = new google.maps.Geocoder();
  return geocoder;
}

function getSvService(): google.maps.StreetViewService | null {
  if (typeof google === 'undefined' || !google.maps) return null;
  if (!svService) svService = new google.maps.StreetViewService();
  return svService;
}

function reverseGeocode(latLng: google.maps.LatLng): Promise<string | null> {
  if (isGeocodeDenied()) return Promise.resolve(null);
  const gc = getGeocoder();
  if (!gc) return Promise.resolve(null);
  return new Promise((resolve) => {
    gc.geocode({ location: latLng }, (results, status) => {
      const statusText = String(status);
      noteGeocodeStatus(statusText);
      if (statusText === 'OK' && results && results[0]) {
        resolve(results[0].formatted_address ?? null);
      } else {
        resolve(null);
      }
    });
  });
}

function fetchImageDate(panoId: string): Promise<string | null> {
  const sv = getSvService();
  if (!sv) return Promise.resolve(null);
  return new Promise((resolve) => {
    sv.getPanorama({ pano: panoId }, (data, status) => {
      if (status === google.maps.StreetViewStatus.OK && data) {
        resolve((data as google.maps.StreetViewPanoramaData).imageDate ?? null);
      } else {
        resolve(null);
      }
    });
  });
}

function readBase(panorama: google.maps.StreetViewPanorama): PanoLocationInfo | null {
  const panoId = panorama.getPano();
  if (!panoId) return null;
  const loc = panorama.getLocation();
  const latLng = loc?.latLng ?? panorama.getPosition() ?? null;
  return {
    panoId,
    description: loc?.description || loc?.shortDescription || null,
    lat: latLng ? latLng.lat() : null,
    lng: latLng ? latLng.lng() : null,
    address: null,
    captureDate: null,
  };
}

/** Synchronous HUD fields from the loaded panorama — no Geocoder, no SV metadata. */
export function getPanoLocationBase(
  panorama: google.maps.StreetViewPanorama
): PanoLocationInfo | null {
  const panoId = panorama.getPano();
  if (!panoId) return null;
  const cached = cache.get(panoId);
  if (cached) {
    return {
      ...cached,
      description: cached.description ?? readBase(panorama)?.description ?? null,
    };
  }
  return readBase(panorama);
}

/**
 * Enrich location with capture date, and optionally a reverse-geocoded address.
 * Cached per pano id. `includeAddress` is opt-in (search / globe / full address).
 */
export function resolvePanoLocation(
  panorama: google.maps.StreetViewPanorama,
  options?: ResolvePanoLocationOptions
): Promise<PanoLocationInfo | null> {
  const includeAddress = options?.includeAddress === true;
  const base = readBase(panorama);
  if (!base) return Promise.resolve(null);

  const { panoId } = base;
  const cached = cache.get(panoId);
  if (cached && !includeAddress) return Promise.resolve(cached);
  if (cached && includeAddress && (cached.address != null || isGeocodeDenied())) {
    return Promise.resolve(cached);
  }

  const flightKey = `${panoId}:${includeAddress ? 'addr' : 'meta'}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;

  const latLng = includeAddress && base.lat != null && base.lng != null
    ? new google.maps.LatLng(base.lat, base.lng)
    : null;

  const task = (async (): Promise<PanoLocationInfo> => {
    const prev = cache.get(panoId);
    const [address, captureDate] = await Promise.all([
      includeAddress && latLng
        ? reverseGeocode(latLng).catch(() => null)
        : Promise.resolve(prev?.address ?? null),
      prev?.captureDate
        ? Promise.resolve(prev.captureDate)
        : fetchImageDate(panoId).catch(() => null),
    ]);
    const info: PanoLocationInfo = {
      ...base,
      description: base.description ?? prev?.description ?? null,
      address: includeAddress ? address : (prev?.address ?? null),
      captureDate: captureDate ?? prev?.captureDate ?? null,
    };
    cache.set(panoId, info);
    inFlight.delete(flightKey);
    return info;
  })();

  inFlight.set(flightKey, task);
  return task;
}

/** Test-only: drop caches and the Geocoder singleton. */
export function resetPanoLocationForTests(): void {
  cache.clear();
  inFlight.clear();
  geocoder = null;
  svService = null;
}
