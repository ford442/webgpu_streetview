import { useEffect } from 'react';
import { setCarLocationInfo, setCarCompassHeading } from '../car';
import { getPanoLocationBase } from '../utils/panoLocation';

/**
 * Car HUD location readout on each hop:
 *   `panorama.getLocation().description` + coords — no Geocoder, no extra
 *   StreetViewService call. Reverse-geocode is search/globe/full-address only.
 */
export function usePanoInfoPanel(
  panorama: google.maps.StreetViewPanorama | null,
  position: google.maps.LatLng | null,
  heading: number
): void {
  useEffect(() => {
    if (!panorama) return;
    setCarLocationInfo(getPanoLocationBase(panorama));
  }, [panorama, position]);

  useEffect(() => {
    setCarCompassHeading(heading);
  }, [heading]);
}
