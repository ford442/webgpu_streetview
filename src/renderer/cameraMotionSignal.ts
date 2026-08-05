/**
 * cameraMotionSignal.ts — one-way speed channel from the car/cruise loops to
 * the WebGPU render loop.
 *
 * WebGPUCanvas needs the current travel speed every frame to drive motion
 * blur, but car telemetry lives in CarModeView's animation loop behind refs
 * that never reach React state at frame rate. Threading it through context
 * would re-render the canvas 60x/s, so publishers push a plain number here and
 * the render loop polls it.
 *
 * The value decays on its own: if nothing publishes for ~400 ms (car mode
 * exited, cruise stopped) it falls back to zero so blur can't get stuck on.
 */

/** Speed treated as "full throttle" for normalization purposes (km/h). */
export const MOTION_SIGNAL_MAX_KMH = 90;

/** After this long with no publisher the signal decays to zero. */
export const MOTION_SIGNAL_STALE_MS = 400;

let speedKmh = 0;
let lastPublishedAt = 0;

/** Publish the current travel speed in km/h. Called from animation loops. */
export function publishCameraSpeed(kmh: number, now: number = Date.now()): void {
    speedKmh = Number.isFinite(kmh) ? Math.max(0, kmh) : 0;
    lastPublishedAt = now;
}

/** Normalized 0–1 travel speed, or 0 when the signal has gone stale. */
export function getCameraSpeedNormalized(now: number = Date.now()): number {
    if (lastPublishedAt === 0 || now - lastPublishedAt > MOTION_SIGNAL_STALE_MS) return 0;
    return Math.min(1, speedKmh / MOTION_SIGNAL_MAX_KMH);
}

/** Clear the signal immediately (car mode exit, teardown, tests). */
export function resetCameraSpeed(): void {
    speedKmh = 0;
    lastPublishedAt = 0;
}
