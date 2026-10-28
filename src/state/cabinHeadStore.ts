/**
 * Car-local head pose for the cabin (see `car/carSpatialModel.ts`).
 *
 * `headYaw` / `headPitch` are radians relative to the car's nose: +yaw looks
 * LEFT, +pitch looks UP, clamped to ±90° / −45°..+45°. Like `povStore`, this is
 * hot state (written per mouse event, read per frame), so it lives in an
 * external store, never in React context.
 *
 * In car mode the Street View `heading`/`pitch` are derived from this plus
 * `carHeading` once per frame (`syncCabinPanoramaPov`); nothing else writes
 * the panorama POV while the cabin is up.
 */
import { clampHeadPitch, clampHeadYaw } from '../car/carSpatialModel';
import { createStore } from './createStore';

interface CabinHead {
  readonly headYaw: number;
  readonly headPitch: number;
}

const CENTERED_HEAD: CabinHead = { headYaw: 0, headPitch: 0 };

export interface CabinHeadStore {
  get(): CabinHead;
  subscribe(listener: () => void): () => void;
  /** Clamped write; notifies only on a real change. */
  set(next: Partial<CabinHead>): void;
  reset(next?: Partial<CabinHead>): void;
}

function createCabinHeadStore(initial: Partial<CabinHead> = {}): CabinHeadStore {
  const normalize = (h: CabinHead): CabinHead => ({
    headYaw: clampHeadYaw(h.headYaw),
    headPitch: clampHeadPitch(h.headPitch),
  });
  const store = createStore<CabinHead>(normalize({ ...CENTERED_HEAD, ...initial }));
  const commit = (next: CabinHead): void => store.set(normalize(next));

  return {
    get: store.get,
    subscribe: store.subscribe,
    set: (next) => commit({ ...store.get(), ...next }),
    reset: (next = {}) => commit({ ...CENTERED_HEAD, ...next }),
  };
}

export const cabinHeadStore: CabinHeadStore = createCabinHeadStore();
