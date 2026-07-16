import { useState, useEffect, useRef } from 'react';
import { getHistoricalImagery, type HistoricalPanoEntry } from '../utils/historicalImagery';

export interface UseHistoricalImageryResult {
  entries: HistoricalPanoEntry[];
  isLoading: boolean;
  error: string | null;
  /** True once entries has >= 2 distinct dates (acceptance criterion for a usable timeline). */
  hasTimeline: boolean;
}

const DEBOUNCE_MS = 400;

/**
 * Crawls nearby Street View panoramas for distinct capture dates whenever
 * (lat, lng) settles on a new position. Debounced so rapid navigation
 * (cruise mode, dragging the mini-map) doesn't spam StreetViewService.
 *
 * `currentPanoId` / `currentImageDate` (from the already-loaded panorama)
 * are merged in as a guaranteed entry so the timeline always includes
 * "now" even if the nearby-crawl doesn't happen to resample it.
 */
export function useHistoricalImagery(
  lat: number | null,
  lng: number | null,
  currentPanoId?: string | null,
  currentImageDate?: string | null
): UseHistoricalImageryResult {
  const [entries, setEntries] = useState<HistoricalPanoEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (lat == null || lng == null) return;

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const crawled = await getHistoricalImagery(lat, lng);
        if (requestIdRef.current !== requestId) return; // superseded by a newer position

        let merged = crawled;
        if (currentPanoId && currentImageDate) {
          const alreadyPresent = crawled.some((e) => e.imageDate === currentImageDate);
          if (!alreadyPresent) {
            merged = [
              ...crawled,
              { panoId: currentPanoId, imageDate: currentImageDate, lat, lng, copyright: null },
            ].sort((a, b) => a.imageDate.localeCompare(b.imageDate));
          }
        }
        setEntries(merged);
      } catch (e) {
        if (requestIdRef.current !== requestId) return;
        setError(e instanceof Error ? e.message : 'Failed to load historical imagery');
        setEntries([]);
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [lat, lng, currentPanoId, currentImageDate]);

  return { entries, isLoading, error, hasTimeline: entries.length >= 2 };
}
