import { useRef, useCallback } from 'react';

export interface CachedPano {
  panoId: string;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
}

const MAX_CACHE_SIZE = 30;

function makeKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)}_${lng.toFixed(6)}`;
}

/**
 * Very small LRU-style cache (max 30 entries) that stores the result of
 * `StreetViewService.getPanorama` for a given lat/lng.
 *
 * The cache lives for the whole lifetime of the component (via a ref) and is
 * shared by every navigation routine that uses the same hook instance.
 */
export function usePanoramaCache() {
  const cacheRef = useRef<Map<string, CachedPano>>(new Map());

  const get = useCallback((lat: number, lng: number): CachedPano | undefined => {
    return cacheRef.current.get(makeKey(lat, lng));
  }, []);

  const set = useCallback((pano: CachedPano): void => {
    const key = makeKey(pano.lat, pano.lng);
    // LRU eviction – keep the newest 30 entries
    if (cacheRef.current.size >= MAX_CACHE_SIZE) {
      const oldestKey = cacheRef.current.keys().next().value;
      if (oldestKey !== undefined) {
        cacheRef.current.delete(oldestKey);
      }
    }
    cacheRef.current.set(key, pano);
  }, []);

  /** Async fetch – resolves when Google returns a fully-ready panorama */
  const fetchPano = useCallback(
    (lat: number, lng: number): Promise<CachedPano> => {
      const cached = get(lat, lng);
      if (cached) return Promise.resolve(cached);

      const service = new google.maps.StreetViewService();
      const location = new google.maps.LatLng(lat, lng);

      return new Promise((resolve, reject) => {
        service.getPanorama({ location, radius: 50 }, (result, status) => {
          if (status !== google.maps.StreetViewStatus.OK || !result?.location?.pano) {
            reject(new Error('Panorama not found'));
            return;
          }
          const pano: CachedPano = {
            panoId: result.location.pano,
            lat: result.location.latLng?.lat() ?? lat,
            lng: result.location.latLng?.lng() ?? lng,
            heading: result.tiles?.centerHeading ?? 0,
            pitch: 0,
          };
          set(pano);
          resolve(pano);
        });
      });
    },
    [get, set]
  );

  return { get, set, fetch: fetchPano };
}
