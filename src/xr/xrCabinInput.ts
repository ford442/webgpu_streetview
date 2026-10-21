/**
 * The WebXR session's input, on its way to the cabin input machine (#331).
 *
 * The session (`xr/xrSession.ts`) lives outside React; the machine's state
 * lives in `useViewMode` and its steering path in `CarInputHandler`. The
 * handler subscribes here while the car view is mounted and feeds every event
 * through `dispatchCabinInput` — so the left stick steers through STEER's
 * `steer()` exactly like the mouse, never by writing `carHeading` itself.
 */
import type { CabinInputEvent } from '../car/input/cabinInputMachine';

export type XrCabinInputEvent = Extract<CabinInputEvent, { type: 'XR_ENTER' | 'XR_EXIT' | 'XR_STICK' }>;

type Listener = (event: XrCabinInputEvent) => void;

let listener: Listener | null = null;

/** The car view's input handler; null when it unmounts. One at a time. */
export function setXrCabinInputListener(next: Listener | null): void {
    listener = next;
}

/** Deliver to the car view. False when no car view is listening (nothing to steer). */
export function emitXrCabinInput(event: XrCabinInputEvent): boolean {
    if (!listener) return false;
    listener(event);
    return true;
}
