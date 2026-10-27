/**
 * The app's frame clock (#331): `window.requestAnimationFrame` normally, the
 * immersive session's while one presents.
 *
 * A headset paces its own frames, and some runtimes (Quest) stop the window's
 * rAF while immersive. More to the point, an `XRGPUSubImage` is only valid
 * inside the session's animation-frame callback — so the road loop
 * (`WebGPUCanvas`), the car loop (`useCarDashboardBridge`) and the frame tail
 * that draws the eyes must all run inside it. Loops that schedule through
 * here keep their order: `xr/xrSession.ts` runs every queued callback, in
 * request order, from its one `XRSession.requestAnimationFrame` callback.
 *
 * Switching is seamless both ways: callbacks pending on one clock move to
 * the other, and ids stay valid across the move.
 */

type Callback = (time: number) => void;

interface Pending {
    callback: Callback;
    /** The window rAF id while queued there; null while queued for XR. */
    windowId: number | null;
}

let nextId = 1;
const pending = new Map<number, Pending>();
let xrDriven = false;

function schedule(id: number, entry: Pending): void {
    if (xrDriven || typeof requestAnimationFrame !== 'function') {
        entry.windowId = null;
        return;
    }
    entry.windowId = requestAnimationFrame((time) => {
        if (pending.get(id) !== entry) return;
        pending.delete(id);
        entry.callback(time);
    });
}

/** Like `requestAnimationFrame`, on whichever clock is presenting. */
export function requestFrame(callback: Callback): number {
    const id = nextId++;
    const entry: Pending = { callback, windowId: null };
    pending.set(id, entry);
    schedule(id, entry);
    return id;
}

export function cancelFrame(id: number): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.windowId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(entry.windowId);
}

/** The session drives frames from now on: move everything off the window clock. */
export function beginXrFrames(): void {
    if (xrDriven) return;
    xrDriven = true;
    for (const entry of pending.values()) {
        if (entry.windowId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(entry.windowId);
        entry.windowId = null;
    }
}

/**
 * Run every callback queued before this call, in request order, with the XR
 * frame's time. Callbacks they queue wait for the next frame.
 */
export function runXrFrame(time: number): void {
    if (!xrDriven) return;
    const due = Array.from(pending.entries());
    for (const [id, entry] of due) {
        if (pending.get(id) !== entry) continue; // cancelled by an earlier callback
        pending.delete(id);
        try {
            entry.callback(time);
        } catch (error) {
            console.warn('[frameClock] frame callback failed', error);
        }
    }
}

/** The session ended: hand everything queued back to the window. */
export function endXrFrames(): void {
    if (!xrDriven) return;
    xrDriven = false;
    for (const [id, entry] of pending) schedule(id, entry);
}

export function isXrDriven(): boolean {
    return xrDriven;
}

export function resetFrameClockForTests(): void {
    for (const id of Array.from(pending.keys())) cancelFrame(id);
    xrDriven = false;
}
