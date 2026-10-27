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

export interface CabinHead {
  readonly headYaw: number;
  readonly headPitch: number;
}

export const CENTERED_HEAD: CabinHead = { headYaw: 0, headPitch: 0 };

export interface CabinHeadStore {
  get(): CabinHead;
  subscribe(listener: () => void): () => void;
  /** Clamped write; notifies only on a real change. */
  set(next: Partial<CabinHead>): void;
  reset(next?: Partial<CabinHead>): void;
}

export function createCabinHeadStore(initial: Partial<CabinHead> = {}): CabinHeadStore {
  const normalize = (h: CabinHead): CabinHead => ({
    headYaw: clampHeadYaw(h.headYaw),
    headPitch: clampHeadPitch(h.headPitch),
  });
  let state = normalize({ ...CENTERED_HEAD, ...initial });
  const listeners = new Set<() => void>();

  const commit = (next: CabinHead): void => {
    const n = normalize(next);
    if (n.headYaw === state.headYaw && n.headPitch === state.headPitch) return;
    state = n;
    for (const l of Array.from(listeners)) l();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => commit({ ...state, ...next }),
    reset: (next = {}) => commit({ ...CENTERED_HEAD, ...next }),
  };
}

export const cabinHeadStore: CabinHeadStore = createCabinHeadStore();
