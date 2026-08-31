import { useCallback } from 'react';
import { useStreetView } from './useStreetView';
import { usePanoramaCache } from './usePanoramaCache';

export interface AdvanceSafeOptions {
  /** If provided, pre-fetch this target before advancing */
  targetLatLng?: { lat: number; lng: number };
  /** Heading to pass to the underlying advance call */
  heading?: number;
}

export interface TeleportSafeOptions {
  lat: number;
  lng: number;
  targetHeading?: number;
  targetPitch?: number;
}

/**
 * Safe wrapper around `advance` and `teleport` that:
 *  - Waits for the *current* panorama to be ready.
 *  - Pre-fetches the *target* panorama (if lat/lng is known) via StreetViewService.
 *  - Returns a Promise that resolves when the transition has finished.
 *
 * Does not call Geocoder. Cruise hops are `getLinks` + `setPano` only.
 */
export function useAdvanceSafe() {
  const { isPanoramaReady, readyPromise, advance, teleport, teleportToPano } = useStreetView();
  const panoCache = usePanoramaCache();

  const advanceSafe = useCallback(
    async (
      dir: 'forward' | 'backward' | 'left' | 'right',
      targetLatLng?: { lat: number; lng: number },
      heading?: number
    ) => {
      // 1️⃣ Make sure we are *currently* ready
      if (!isPanoramaReady) {
        await readyPromise();
      }

      // 2️⃣ If we have a target location, pre-fetch it now
      if (targetLatLng) {
        try {
          await panoCache.fetch(targetLatLng.lat, targetLatLng.lng);
        } catch (e) {
          console.warn('[advanceSafe] Could not pre-fetch target pano', e);
          // We still attempt the normal advance – Google will show a loading spinner.
        }
      }

      // 3️⃣ Finally call the original advance
      advance(dir, heading);
    },
    [isPanoramaReady, readyPromise, advance, panoCache]
  );

  const teleportSafe = useCallback(
    async (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => {
      // 1️⃣ Make sure we are *currently* ready
      if (!isPanoramaReady) {
        await readyPromise();
      }

      // 2️⃣ Pre-fetch the target location
      try {
        await panoCache.fetch(lat, lng);
      } catch (e) {
        console.warn('[teleportSafe] Could not pre-fetch target pano', e);
      }

      // 3️⃣ Finally call the original teleport
      teleport(lat, lng, targetHeading, targetPitch);
    },
    [isPanoramaReady, readyPromise, teleport, panoCache]
  );

  const teleportToPanoSafe = useCallback(
    async (panoId: string) => {
      if (!isPanoramaReady) {
        await readyPromise();
      }
      teleportToPano(panoId);
    },
    [isPanoramaReady, readyPromise, teleportToPano]
  );

  return { advanceSafe, teleportSafe, teleportToPanoSafe, panoCache };
}
