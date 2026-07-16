import { useState, useEffect, useMemo } from 'react';
import { resolvePanoLocation } from '../utils/panoLocation';
import { useHistoricalImagery } from './useHistoricalImagery';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';

export interface UseHistoricalTimelineResult {
  entries: HistoricalPanoEntry[];
  isLoading: boolean;
  error: string | null;
  hasTimeline: boolean;
  /** Index of the panorama currently on screen within `entries` (-1 if not present). */
  currentIndex: number;
  currentPanoId: string | null;
}

/**
 * Combines the current panorama's own capture date (via `resolvePanoLocation`,
 * cached per pano id) with a nearby-imagery crawl (`useHistoricalImagery`) to
 * produce the full list of dates the `<HistoricalTimeline />` slider scrubs
 * through.
 */
export function useHistoricalTimeline(
  panorama: google.maps.StreetViewPanorama | null
): UseHistoricalTimelineResult {
  const [currentPanoId, setCurrentPanoId] = useState<string | null>(null);
  const [currentImageDate, setCurrentImageDate] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  useEffect(() => {
    if (!panorama) return;
    let cancelled = false;

    const position = panorama.getPosition();
    if (position) {
      setLat(position.lat());
      setLng(position.lng());
    }
    setCurrentPanoId(panorama.getPano() || null);

    resolvePanoLocation(panorama)
      .then((info) => {
        if (cancelled || !info) return;
        setCurrentImageDate(info.captureDate);
        if (info.lat != null) setLat(info.lat);
        if (info.lng != null) setLng(info.lng);
      })
      .catch(() => { /* keep whatever synchronous info we already have */ });

    return () => { cancelled = true; };
  }, [panorama, panorama?.getPano()]); // eslint-disable-line react-hooks/exhaustive-deps -- re-resolve on every pano hop

  const { entries, isLoading, error, hasTimeline } = useHistoricalImagery(
    lat,
    lng,
    currentPanoId,
    currentImageDate
  );

  const currentIndex = useMemo(
    () => entries.findIndex((e) => e.panoId === currentPanoId),
    [entries, currentPanoId]
  );

  return { entries, isLoading, error, hasTimeline, currentIndex, currentPanoId };
}
