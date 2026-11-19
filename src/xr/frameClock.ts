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
 *
 * A third source, the **virtual** clock (#374), drives frames for an offline
 * export: nothing runs until `stepFrame(dtMs)` / `stepFrameTo(timeMs)`, which
 * advances app time by exactly that amount and runs every queued callback
 * once. It wins over the window and over XR (an XR session that starts during
 * an export queues behind it). App time is `frameNow()` — the virtual time
 * while virtual, `performance.now()` otherwise — and every per-frame consumer
 * (weather time, wipers, particles, the vehicle sim's dt, crossfades) reads it
 * instead of `performance.now()` / `Date.now()`, so a stepped frame sees the
 * stepped time (`frameClock.scan.test.ts`). Wall-clock measurements (GPU
 * timings, network throttles, readback ages) keep the real clock.
 */

type Callback = (time: number) => void;

interface Pending {
    callback: Callback;
    /** The window rAF id while queued there; null while queued for XR or the virtual clock. */
    windowId: number | null;
}

let nextId = 1;
const pending = new Map<number, Pending>();
let xrDriven = false;
/** The virtual clock's time (ms) while it drives frames; null otherwise. */
let virtualTime: number | null = null;
/**
 * Added to real frame times once a virtual run has ended, so app time is
 * continuous across it (a loop's `now - last` never jumps or goes negative).
 * Zero until the first export.
 */
let realOffset = 0;

const realNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function schedule(id: number, entry: Pending): void {
    if (virtualTime !== null || xrDriven || typeof requestAnimationFrame !== 'function') {
        entry.windowId = null;
        return;
    }
    const windowId = requestAnimationFrame((time) => {
        // Cancelled, or moved to another clock (XR, virtual) since it was queued.
        if (pending.get(id) !== entry || entry.windowId !== windowId) return;
        pending.delete(id);
        entry.callback(time + realOffset);
    });
    entry.windowId = windowId;
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

/**
 * App time in ms: the virtual clock's while it drives frames, else
 * `performance.now()` (plus the offset a finished virtual run left, so app
 * time never jumps). Per-frame consumers read this, never the raw clocks.
 */
export function frameNow(): number {
    return virtualTime ?? realNow() + realOffset;
}

function takeOffWindow(): void {
    for (const entry of pending.values()) {
        if (entry.windowId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(entry.windowId);
        entry.windowId = null;
    }
}

/** Run every callback queued before this call, in request order. Callbacks they queue wait. */
function runDue(time: number): number {
    const due = Array.from(pending.entries());
    let ran = 0;
    for (const [id, entry] of due) {
        if (pending.get(id) !== entry) continue; // cancelled by an earlier callback
        pending.delete(id);
        ran += 1;
        try {
            entry.callback(time);
        } catch (error) {
            console.warn('[frameClock] frame callback failed', error);
        }
    }
    return ran;
}

/** The session drives frames from now on: move everything off the window clock. */
export function beginXrFrames(): void {
    if (xrDriven) return;
    xrDriven = true;
    takeOffWindow();
}

/**
 * Run every callback queued before this call, in request order, with the XR
 * frame's time. Callbacks they queue wait for the next frame. A no-op while
 * the virtual clock drives frames.
 */
export function runXrFrame(time: number): void {
    if (!xrDriven || virtualTime !== null) return;
    runDue(time + realOffset);
}

/** The session ended: hand everything queued back to the window (or leave it with the virtual clock). */
export function endXrFrames(): void {
    if (!xrDriven) return;
    xrDriven = false;
    for (const [id, entry] of pending) schedule(id, entry);
}

export function isXrDriven(): boolean {
    return xrDriven;
}

/**
 * The virtual clock drives frames from now on (#374): nothing runs until a
 * step. App time continues from `startMs` (default: now, so loops that
 * remember their last frame time see no jump). Refused while an immersive
 * session presents — the headset paces its own frames.
 */
export function beginVirtualFrames(startMs: number = frameNow()): void {
    if (virtualTime !== null) throw new Error('[frameClock] the virtual clock already drives frames');
    if (xrDriven) throw new Error('[frameClock] cannot drive virtual frames while an XR session presents');
    if (!Number.isFinite(startMs)) throw new RangeError(`[frameClock] virtual start must be finite (got ${startMs})`);
    virtualTime = startMs;
    takeOffWindow();
}

/**
 * Advance app time to exactly `timeMs` and run one frame: every callback
 * queued before the call, in request order, with `timeMs` as its frame time.
 * Returns how many ran. Time only moves forward.
 */
export function stepFrameTo(timeMs: number): number {
    if (virtualTime === null) throw new Error('[frameClock] stepFrameTo needs beginVirtualFrames()');
    if (!Number.isFinite(timeMs) || timeMs <= virtualTime) {
        throw new RangeError(`[frameClock] virtual time must move forward (${virtualTime} → ${timeMs})`);
    }
    virtualTime = timeMs;
    return runDue(timeMs);
}

/** `stepFrameTo(frameNow() + dtMs)`: advance app time by exactly `dtMs` and run one frame. */
export function stepFrame(dtMs: number): number {
    if (virtualTime === null) throw new Error('[frameClock] stepFrame needs beginVirtualFrames()');
    return stepFrameTo(virtualTime + dtMs);
}

/**
 * Hand frames back to the window (or to the XR session, if one started
 * meanwhile). App time carries on from the last virtual frame at real speed.
 */
export function endVirtualFrames(): void {
    if (virtualTime === null) return;
    realOffset = virtualTime - realNow();
    virtualTime = null;
    for (const [id, entry] of pending) schedule(id, entry);
}

export function isVirtualDriven(): boolean {
    return virtualTime !== null;
}

export function resetFrameClockForTests(): void {
    for (const id of Array.from(pending.keys())) cancelFrame(id);
    xrDriven = false;
    virtualTime = null;
    realOffset = 0;
}
