import { panoramaPovFromCabin } from '../carSpatialModel';
import { povStore as defaultPovStore, type PovStore } from '../../state/povStore';
import { cabinHeadStore as defaultHeadStore, type CabinHeadStore } from '../../state/cabinHeadStore';

const DEG = Math.PI / 180;

export interface CabinPovSync {
  /**
   * Derive the Street View heading/pitch from `carHeading` + head pose and
   * write them to `povStore` (which `useStreetView` forwards to Maps, honouring
   * hold-pause). Call once per frame — never per mouse event.
   */
  sync(): void;
}

/**
 * Per-frame panorama sync for car mode.
 *
 * Other writers still aim the view directly through `povStore` (tours, shared
 * sessions, deep links, captures). A heading/pitch that differs from what
 * this sync last wrote is such a write: the car turns so the view lands there
 * with the head where it is, and a pitch goes to the head. The first frame
 * absorbs the same way, so entering car mode keeps the current view.
 */
export function createCabinPovSync(
  pov: PovStore = defaultPovStore,
  head: CabinHeadStore = defaultHeadStore,
): CabinPovSync {
  let last: { heading: number; pitch: number } | null = null;

  return {
    sync() {
      const current = pov.get();
      if (!last || current.heading !== last.heading) {
        pov.setCarHeading(current.heading + head.get().headYaw / DEG);
      }
      if (!last || current.pitch !== last.pitch) {
        head.set({ headPitch: current.pitch * DEG });
      }
      const { headYaw, headPitch } = head.get();
      const next = panoramaPovFromCabin(pov.get().carHeading, headYaw, headPitch);
      pov.setView(next.heading, next.pitch);
      const written = pov.get();
      last = { heading: written.heading, pitch: written.pitch };
    },
  };
}
