import { useEffect } from 'react';
import { setCarLocationInfo, setCarCompassHeading } from '../car';
import { getPanoLocationBase } from '../services/maps/panoLocation';
import { usePovEffect } from '../state';

/**
 * Car HUD location readout on each hop:
 *   `panorama.getLocation().description` + coords — no Geocoder, no extra
 *   StreetViewService call. Reverse-geocode is search/globe/full-address only.
 */
export function usePanoInfoPanel(
  panorama: google.maps.StreetViewPanorama | null,
  position: google.maps.LatLng | null,
): void {
  useEffect(() => {
    if (!panorama) return;
    setCarLocationInfo(getPanoLocationBase(panorama));
  }, [panorama, position]);

  usePovEffect((p) => p.heading, setCarCompassHeading);
}
