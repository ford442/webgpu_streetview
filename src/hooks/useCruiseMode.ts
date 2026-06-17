import { useRef, useEffect, useState } from 'react';

export interface UseCruiseModeOptions {
  panorama: google.maps.StreetViewPanorama | null;
  advanceSafe: (dir: 'forward', targetLatLng?: { lat: number; lng: number }, heading?: number) => Promise<void>;
  mapsAuthFailed: boolean;
  heading: number;
  isTransitioning: boolean;
  setNavPending: (pending: boolean) => void;
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
  const cruiseHeadingRef = useRef(heading);
  cruiseHeadingRef.current = heading;
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
