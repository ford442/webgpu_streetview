import { useRef, useEffect, useState } from 'react';

export interface UseCruiseModeOptions {
  panorama: google.maps.StreetViewPanorama | null;
  advanceSafe: (dir: 'forward', targetLatLng?: { lat: number; lng: number }, heading?: number) => Promise<void>;
  mapsAuthFailed: boolean;
  heading: number;
  isTransitioning: boolean;
  setNavPending: (pending: boolean) => void;
}

/** Initial bearing (degrees, 0–360) from point A to point B. */
function bearingBetween(
  from: google.maps.LatLng,
  to: google.maps.LatLng
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(from.lat());
  const lat2 = toRad(to.lat());
  const dLng = toRad(to.lng() - from.lng());
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function useCruiseMode({
  panorama,
  advanceSafe,
  mapsAuthFailed,
  heading,
  isTransitioning,
  setNavPending,
}: UseCruiseModeOptions) {
  const [isCruiseMode, setIsCruiseMode] = useState(false);

  // Live view heading — tracks head-look every render but is NOT the travel
  // direction. Used only to seed the committed heading when cruise starts.
  const liveHeadingRef = useRef(heading);
  liveHeadingRef.current = heading;

  // Committed travel heading. Frozen against passive head-look so that looking
  // around in free-look/car mode never redirects cruise. Self-corrects to the
  // road after each successful hop via the position-change bearing.
  const cruiseHeadingRef = useRef(heading);

  const cruiseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const useTransitionRef = useRef(isTransitioning);
  useTransitionRef.current = isTransitioning;
  const cruiseFailCountRef = useRef(0);

  useEffect(() => {
    if (!isCruiseMode || !panorama || !advanceSafe) {
      if (cruiseIntervalRef.current) {
        clearInterval(cruiseIntervalRef.current);
        cruiseIntervalRef.current = null;
      }
      cruiseFailCountRef.current = 0;
      return;
    }
    // Commit the current view heading as the travel direction the moment cruise
    // engages. From here it evolves only from real movement, not head-look.
    cruiseHeadingRef.current = liveHeadingRef.current;
    const hop = async () => {
      if (useTransitionRef.current) {
        console.log('[CruiseMode] Skipping hop - still transitioning');
        return;
      }
      if (mapsAuthFailed) {
        setIsCruiseMode(false);
        return;
      }
      const panoIdBefore = panorama.getPano();
      const posBefore = panorama.getPosition() ?? null;
      setNavPending(true);
      try {
        await advanceSafe('forward', undefined, cruiseHeadingRef.current);
      } finally {
        setNavPending(false);
      }
      await new Promise(r => setTimeout(r, 1500));
      const panoIdAfter = panorama.getPano();
      if (panoIdAfter && panoIdAfter !== panoIdBefore) {
        cruiseFailCountRef.current = 0;
        // Follow the road: steer future hops along the direction actually
        // travelled, independent of where the head is looking.
        const posAfter = panorama.getPosition() ?? null;
        if (posBefore && posAfter) {
          cruiseHeadingRef.current = bearingBetween(posBefore, posAfter);
        }
      } else {
        cruiseFailCountRef.current += 1;
        console.warn(`[CruiseMode] Hop did not advance (${cruiseFailCountRef.current}/3)`);
        if (cruiseFailCountRef.current >= 3) {
          console.error('[CruiseMode] 3 consecutive stuck hops — auto-disabling cruise mode');
          setIsCruiseMode(false);
          cruiseFailCountRef.current = 0;
        }
      }
    };
    cruiseIntervalRef.current = setInterval(hop, 3000);
    return () => {
      if (cruiseIntervalRef.current) clearInterval(cruiseIntervalRef.current);
      cruiseIntervalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCruiseMode, panorama, advanceSafe, mapsAuthFailed]);

  return { isCruiseMode, setIsCruiseMode };
}
