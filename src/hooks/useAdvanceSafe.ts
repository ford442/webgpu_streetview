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
 *  - Pre-fetches the *target* panorama (if lat/lng is known).
 *  - Returns a Promise that resolves when the transition has finished.
 */
export function useAdvanceSafe() {
  const { navigationIdlePromise, advance, teleport, teleportToPano } = useStreetView();
  const panoCache = usePanoramaCache();

  const advanceSafe = useCallback(
    async (
      dir: 'forward' | 'backward' | 'left' | 'right',
      targetLatLng?: { lat: number; lng: number },
      heading?: number
    ) => {
      // Wait until the previous hop's hold + release crossfade finished.
      // readyPromise alone fires when the canvas stabilizes, while advance()
      // still refuses calls while isTransitioning is true.
      await navigationIdlePromise();

      // If we have a target location, pre-fetch it now
      if (targetLatLng) {
        try {
          await panoCache.fetch(targetLatLng.lat, targetLatLng.lng);
        } catch (e) {
          console.warn('[advanceSafe] Could not pre-fetch target pano', e);
          // We still attempt the normal advance – Google will show a loading spinner.
        }
      }

      // Finally call the original advance
      advance(dir, heading);
    },
    [navigationIdlePromise, advance, panoCache]
  );

  const teleportSafe = useCallback(
    async (lat: number, lng: number, targetHeading?: number, targetPitch?: number) => {
      await navigationIdlePromise();

      // Pre-fetch the target location
      try {
        await panoCache.fetch(lat, lng);
      } catch (e) {
        console.warn('[teleportSafe] Could not pre-fetch target pano', e);
      }

      // Finally call the original teleport
      teleport(lat, lng, targetHeading, targetPitch);
    },
    [navigationIdlePromise, teleport, panoCache]
  );

  const teleportToPanoSafe = useCallback(
    async (panoId: string) => {
      await navigationIdlePromise();
      teleportToPano(panoId);
    },
    [navigationIdlePromise, teleportToPano]
  );

  return { advanceSafe, teleportSafe, teleportToPanoSafe, panoCache };
}
