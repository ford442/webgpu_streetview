/**
 * Cabin frame capture taps.
 *
 * Cinema (`utils/canvasRecorder.ts`) records the Street View WebGPU canvas.
 * To get the cabin into that clip it has to composite the cabin canvas on top
 * — but a WebGL drawing buffer without `preserveDrawingBuffer` is only
 * readable inside the same frame that drew it, and the cabin renderer
 * deliberately does not pay for `preserveDrawingBuffer` (see
 * `interior/createCabinRenderer.ts`). Reading it from the recorder's own
 * `requestAnimationFrame` would race the car render loop and latch blank or
 * stale frames.
 *
 * So the car side publishes the moment instead: `updateCarMode()` calls
 * `notifyCabinFrameRendered()` immediately after `interior.render()`, and the
 * recorder copies the cabin into its own 2D latch right there, where the
 * buffer is guaranteed valid. The recorder then composites that latch at its
 * own pace.
 *
 * Single-slot on purpose: there is one cinema recorder at a time, and a
 * subscriber that forgets to unsubscribe should replace rather than stack.
 */
import { getState } from './state';

export type CabinFrameListener = () => void;

let listener: CabinFrameListener | null = null;

/**
 * The cabin canvas, or `null` whenever car mode is not running or not active
 * — in which case cinema correctly falls back to road-only.
 */
export function getCabinCanvas(): HTMLCanvasElement | null {
    const state = getState();
    if (!state || !state.isActive) return null;
    return state.interior.canvas ?? null;
}

/**
 * Run `fn` right after each cabin render, while its drawing buffer is still
 * readable. Returns an unsubscribe that is a no-op once superseded.
 */
export function onCabinFrameRendered(fn: CabinFrameListener): () => void {
    listener = fn;
    return () => {
        if (listener === fn) listener = null;
    };
}

/** Called by `updateCarMode()` — never from outside the car render loop. */
export function notifyCabinFrameRendered(): void {
    const fn = listener;
    if (!fn) return;
    try {
        fn();
    } catch (err) {
        // A throwing tap must not take down the car render loop; drop it.
        listener = null;
        console.warn('[frameCapture] cabin frame listener threw and was dropped', err);
    }
}
