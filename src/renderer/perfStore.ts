/**
 * Frame-rate stats for the performance overlay, measured by the frame driver
 * (`frameDriver.ts`) from the frames it actually renders and published at UI
 * rate (`PERF_PUBLISH_INTERVAL_MS`), never per frame. GPU pass timings stay in
 * `gpuPassTimingStore.ts`.
 */
import { createStore, useStore } from '../state/createStore';

export interface FrameRateStats {
    /** Frames rendered per second over the last window. */
    readonly fps: number;
    /** Slowest / fastest instantaneous rate in the window. */
    readonly fpsMin: number;
    readonly fpsMax: number;
    /** Mean frame interval over the window, ms. */
    readonly frameTimeMs: number;
    /** Frames since start that took over 1.5× the 60 Hz interval. */
    readonly slowFrames: number;
    /** Frames rendered since start. */
    readonly frames: number;
    /** False until the driver has published a window. */
    readonly measured: boolean;
}

export const PERF_PUBLISH_INTERVAL_MS = 500;
export const SLOW_FRAME_MS = (1000 / 60) * 1.5;

export const FRAME_RATE_IDLE: FrameRateStats = {
    fps: 0,
    fpsMin: 0,
    fpsMax: 0,
    frameTimeMs: 0,
    slowFrames: 0,
    frames: 0,
    measured: false,
};

export const perfStore = createStore<FrameRateStats>(FRAME_RATE_IDLE);

export function useFrameRateStats<S>(selector: (s: FrameRateStats) => S): S {
    return useStore(perfStore, selector);
}

/**
 * Accumulates frame intervals and publishes a window to `perfStore` every
 * `PERF_PUBLISH_INTERVAL_MS`. Allocation-free per frame.
 */
export class FrameRateMeter {
    private last: number | null = null;
    private windowStart = 0;
    private windowFrames = 0;
    private windowSumMs = 0;
    private minMs = Infinity;
    private maxMs = 0;
    private slow = 0;
    private total = 0;
    /** The last raw frame interval, ms (null before the second frame). */
    public lastIntervalMs: number | null = null;

    constructor(private readonly store = perfStore) {}

    public frame(time: number): void {
        this.total += 1;
        const last = this.last;
        this.last = time;
        if (last === null) {
            this.windowStart = time;
            return;
        }
        const dt = time - last;
        this.lastIntervalMs = dt;
        if (!(dt > 0)) return;
        this.windowFrames += 1;
        this.windowSumMs += dt;
        if (dt < this.minMs) this.minMs = dt;
        if (dt > this.maxMs) this.maxMs = dt;
        if (dt > SLOW_FRAME_MS) this.slow += 1;
        if (time - this.windowStart >= PERF_PUBLISH_INTERVAL_MS) this.publish(time);
    }

    /** A gap (driver stopped, tab hidden): the next frame starts a new window. */
    public pause(): void {
        this.last = null;
        this.lastIntervalMs = null;
        this.resetWindow(0);
    }

    private publish(time: number): void {
        const meanMs = this.windowSumMs / this.windowFrames;
        this.store.set({
            fps: Math.round(1000 / meanMs),
            fpsMin: Math.round(1000 / this.maxMs),
            fpsMax: Math.round(1000 / this.minMs),
            frameTimeMs: Math.round(meanMs * 100) / 100,
            slowFrames: this.slow,
            frames: this.total,
            measured: true,
        });
        this.resetWindow(time);
    }

    private resetWindow(time: number): void {
        this.windowStart = time;
        this.windowFrames = 0;
        this.windowSumMs = 0;
        this.minMs = Infinity;
        this.maxMs = 0;
    }
}
