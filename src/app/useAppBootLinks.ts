import { useEffect, useRef } from 'react';
import { parseDeepLinkParams } from '../utils/deepLink';
import { parseStudioLinkParams } from '../utils/studioLink';
import { pickHistoricalEntryForYear, type HistoricalPanoEntry } from '../utils/historicalImagery';
import type { VehicleType } from '../car/VehicleManager';

export interface UseAppBootLinksOptions {
  isConnected: boolean;
  panorama: google.maps.StreetViewPanorama | null;
  isPanoramaReady: boolean;
  /** Historical timeline for the current pano — drives the `?year=` hop. */
  historicalEntries: HistoricalPanoEntry[];
  isHistoricalLoading: boolean;
  teleportSafe: (lat: number, lng: number, heading: number, pitch: number) => Promise<void>;
  teleportToPanoSafe: (panoId: string) => Promise<void>;
  setHeading: (heading: number) => void;
  setPitch: (pitch: number) => void;
  setZoom: (zoom: number) => void;
  setSessionVehicle: (type: VehicleType) => void;
}

/**
 * One-shot boot params: `?lat=&lng=&heading=&pitch=&zoom=&pano=` deep links
 * plus the studio-link `?year=` / `?vehicle=` extras.
 *
 * Every param is consumed exactly once, guarded by a ref, so a later teleport
 * or timeline refresh never re-applies a boot value over what the user is
 * currently looking at.
 */
export function useAppBootLinks(options: UseAppBootLinksOptions): void {
  const {
    isConnected,
    panorama,
    isPanoramaReady,
    historicalEntries,
    isHistoricalLoading,
    teleportSafe,
    teleportToPanoSafe,
    setHeading,
    setPitch,
    setZoom,
    setSessionVehicle,
  } = options;

  const deepLinkConsumedRef = useRef(false);
  const studioBootRef = useRef(parseStudioLinkParams());
  const yearBootConsumedRef = useRef(!studioBootRef.current.year);
  const yearSawHistoricalLoadRef = useRef(false);
  const vehicleBootConsumedRef = useRef(!studioBootRef.current.vehicleType);

  useEffect(() => {
    if (vehicleBootConsumedRef.current) return;
    const vehicle = studioBootRef.current.vehicleType;
    if (!vehicle) {
      vehicleBootConsumedRef.current = true;
      return;
    }
    vehicleBootConsumedRef.current = true;
    setSessionVehicle(vehicle);
  }, [setSessionVehicle]);

  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    if (!isConnected || !panorama || !isPanoramaReady) return;
    deepLinkConsumedRef.current = true;

    const params = parseDeepLinkParams();
    if (!params) return;

    (async () => {
      try {
        if (params.panoId) {
          await teleportToPanoSafe(params.panoId);
        } else {
          await teleportSafe(params.lat, params.lng, params.heading, params.pitch);
        }
        setHeading(params.heading);
        setPitch(params.pitch);
        setZoom(params.zoom);
      } catch (error) {
        console.warn('[deepLink] Failed to apply deep link params:', error);
      }
    })();
  }, [
    isConnected,
    panorama,
    isPanoramaReady,
    teleportToPanoSafe,
    teleportSafe,
    setHeading,
    setPitch,
    setZoom,
  ]);

  // Solo `?year=YYYY` — pick from the existing historical timeline (no new crawl).
  useEffect(() => {
    if (yearBootConsumedRef.current) return;
    if (!isConnected || !isPanoramaReady) return;
    if (isHistoricalLoading) {
      yearSawHistoricalLoadRef.current = true;
      return;
    }
    if (!yearSawHistoricalLoadRef.current && historicalEntries.length === 0) {
      return;
    }
    const year = studioBootRef.current.year;
    yearBootConsumedRef.current = true;
    if (!year) return;
    const entry = pickHistoricalEntryForYear(historicalEntries, year);
    if (entry && entry.panoId !== panorama?.getPano()) {
      void teleportToPanoSafe(entry.panoId);
    }
  }, [
    isConnected,
    isPanoramaReady,
    isHistoricalLoading,
    historicalEntries,
    panorama,
    teleportToPanoSafe,
  ]);
}
