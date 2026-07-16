/**
 * panoLocation.ts
 *
 * Resolves human-readable location metadata for a Street View panorama using
 * the already-loaded Google Maps JS API (no extra dependency):
 *   - description / lat-lng / pano id come straight from `panorama.getLocation()`
 *   - a fuller street address is reverse-geocoded via `google.maps.Geocoder`
 *   - the capture date (`imageDate`) is fetched via `StreetViewService.getPanorama`
 *
 * Results are cached per pano id so we never repeat a lookup, and concurrent
 * requests for the same pano are de-duplicated. All network fields degrade
 * gracefully to `null` on failure or quota limits.
 */

export interface PanoLocationInfo {
  panoId: string;
  /** Google's short place description (road/area), available synchronously. */
  description: string | null;
  lat: number | null;
  lng: number | null;
  /** Reverse-geocoded street address (enriched, async). */
  address: string | null;
  /** Capture date string, e.g. "2022-05" (async). */
  captureDate: string | null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Quantize a bearing in degrees to an 8-point compass label. */
export function headingToCompass(heading: number): string {
  const h = (((heading % 360) + 360) % 360);
  // Math.round(h / 45) % 8 is always in [0,7], a valid index into COMPASS.
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
  const gc = getGeocoder();
  if (!gc) return Promise.resolve(null);
  return new Promise((resolve) => {
    gc.geocode({ location: latLng }, (results, status) => {
      // OVER_QUERY_LIMIT / ZERO_RESULTS / errors all fall back to null.
      if (status === 'OK' && results && results[0]) {
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

/** Synchronous, no-network base info from the loaded panorama. */
export function getPanoLocationBase(
  panorama: google.maps.StreetViewPanorama
): PanoLocationInfo | null {
  const panoId = panorama.getPano();
  if (!panoId) return null;
  if (cache.has(panoId)) return cache.get(panoId)!;

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

/**
 * Resolve full location info for the current panorama, enriching the base data
 * with a reverse-geocoded address and capture date. Cached per pano id.
 */
export function resolvePanoLocation(
  panorama: google.maps.StreetViewPanorama
): Promise<PanoLocationInfo | null> {
  const base = getPanoLocationBase(panorama);
  if (!base) return Promise.resolve(null);

  const { panoId } = base;
  if (cache.has(panoId)) return Promise.resolve(cache.get(panoId)!);
  const pending = inFlight.get(panoId);
  if (pending) return pending;

  const latLng = base.lat != null && base.lng != null
    ? new google.maps.LatLng(base.lat, base.lng)
    : null;

  const task = (async (): Promise<PanoLocationInfo> => {
    const [address, captureDate] = await Promise.all([
      latLng ? reverseGeocode(latLng).catch(() => null) : Promise.resolve(null),
      fetchImageDate(panoId).catch(() => null),
    ]);
    const info: PanoLocationInfo = { ...base, address, captureDate };
    cache.set(panoId, info);
    inFlight.delete(panoId);
    return info;
  })();

  inFlight.set(panoId, task);
  return task;
}
