import { useEffect } from 'react';
import { setCarLocationInfo, setCarCompassHeading } from '../car';
import { getPanoLocationBase, resolvePanoLocation } from '../utils/panoLocation';

/**
 * Drives the car interior's location readout panel:
 *  - On each pano hop, pushes immediate base info (description + coords), then
 *    enriches it asynchronously with a reverse-geocoded address + capture date
 *    (cached per pano id so hops never repeat a lookup).
 *  - Feeds the live view heading to the panel's compass (the panel itself gates
 *    redraws to 8-point sector changes).
 */
export function usePanoInfoPanel(
  panorama: google.maps.StreetViewPanorama | null,
  position: google.maps.LatLng | null,
  heading: number
): void {
  // Resolve location on pano change. `position` changes on every hop.
  useEffect(() => {
    if (!panorama) return;
    let cancelled = false;

    // Immediate, no-network base so coords/description show without delay.
    setCarLocationInfo(getPanoLocationBase(panorama));

    resolvePanoLocation(panorama)
      .then((info) => {
        if (!cancelled && info) setCarLocationInfo(info);
      })
      .catch(() => { /* graceful fallback: keep base info */ });

    return () => { cancelled = true; };
  }, [panorama, position]);

  // Live compass heading.
  useEffect(() => {
    setCarCompassHeading(heading);
  }, [heading]);
}
