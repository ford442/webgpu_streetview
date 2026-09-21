/**
 * Single-slot handoff of the cabin's GPU texture from the car runtime to the
 * Street View renderer.
 *
 * The two live on opposite sides of a lazy chunk boundary: `Renderer` is part
 * of the eager bundle, the car interior is behind `carRuntimeLoader`, and the
 * React tree between them (`CarModeView` → `useCarDashboardBridge` →
 * `CarInterior`) has no reason to carry a renderer handle down four levels just
 * so one texture can go back up. So the cabin **publishes** and the renderer
 * **reads**, exactly like `car/runtime/frameCapture.ts` publishes the "cabin
 * just drew" moment for cinema.
 *
 * Single-slot on purpose: there is one cabin at a time, and a car-mode remount
 * that forgets to clear should replace the previous entry rather than stack.
 */
import type { CabinOverlaySource } from './cabinComposite';

let source: CabinOverlaySource | null = null;

/**
 * Publish (or, with `null`, retract) the cabin overlay. The car runtime calls
 * this when its frame target comes up and again on dispose; leaving a stale
 * source registered would make the renderer sample a destroyed texture.
 */
export function publishCabinOverlaySource(next: CabinOverlaySource | null): void {
    source = next;
}

export function getCabinOverlaySource(): CabinOverlaySource | null {
    return source;
}

/** Test-only: drop whatever a previous test published. */
export function resetCabinOverlaySourceForTests(): void {
    source = null;
}
