/**
 * The headset's lean (#331): where the eye sits relative to the driver's eye
 * point, metres in the car frame, clamped (`carSpatialModel.HEAD_OFFSET_LIMIT`).
 *
 * Zero outside a WebXR session — a mouse has no position. Kept apart from
 * `cabinHeadStore` (the pose every mode has) so nothing that reads yaw/pitch
 * changes shape. Hot state: an external store, never React context; the car
 * loop applies it once per frame (`car/runtime/lifecycle.updateCarMode`).
 */
import { clampHeadOffset, NO_HEAD_OFFSET, type HeadOffset } from '../car/carSpatialModel';

let offset: HeadOffset = NO_HEAD_OFFSET;

export const cabinHeadOffsetStore = {
  get: (): HeadOffset => offset,
  set(next: HeadOffset): void {
    offset = clampHeadOffset(next);
  },
  reset(): void {
    offset = NO_HEAD_OFFSET;
  },
};
