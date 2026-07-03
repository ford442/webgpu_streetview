import { useEffect } from 'react';
import SunCalc from 'suncalc';
import { setCarPanoEnvironment, setCarSunPosition } from '../car';
import { fetchPanoEquirect } from '../utils/panoEquirect';

/**
 * Lights the car cabin consistently with the surrounding panorama and the
 * real sun at the pano's location:
 *  - On each pano hop, fetches a low-res equirect of the panorama and hands
 *    it to the car interior, which PMREM-filters it into `scene.environment`
 *    (cached per pano id; failures keep the previous environment).
 *  - Aims the cabin's sun DirectionalLight via SunCalc for the current
 *    coordinates, refreshed on every hop and once a minute so day/night and
 *    golden-hour tinting track the real sky.
 */
export function useCabinEnvironment(
  panorama: google.maps.StreetViewPanorama | null,
  position: google.maps.LatLng | null
): void {
  // Pano → IBL environment. `position` changes on every hop.
  useEffect(() => {
    if (!panorama) return;
    const panoId = panorama.getPano();
    if (!panoId) return;
    let cancelled = false;

    fetchPanoEquirect(panoId).then((result) => {
      if (!cancelled && result) {
        setCarPanoEnvironment(result.canvas, result.centerHeading);
      }
    });

    return () => { cancelled = true; };
  }, [panorama, position]);

  // Real sun azimuth/altitude for the pano's coordinates.
  useEffect(() => {
    const update = () => {
      const pos = position ?? panorama?.getPosition() ?? null;
      if (!pos) return;
      const sun = SunCalc.getPosition(new Date(), pos.lat(), pos.lng());
      setCarSunPosition(sun.azimuth, sun.altitude);
    };
    update();
    // Sun moves ~0.25°/min — once a minute is imperceptible but keeps
    // sunrise/sunset transitions live during long sessions.
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [panorama, position]);
}
