/**
 * When to run the depth network. Depth is a slowly-varying scene input, so it
 * runs on demand — never per frame:
 *
 * - only when the map is stale: a new pano (the epoch moved on hold release),
 *   or the view (pan / zoom) differs from the one the map was inferred at;
 * - only once look input has settled for `DEPTH_SETTLE_MS`;
 * - at most every `DEPTH_MIN_INTERVAL_MS` (5 Hz), one inference in flight;
 * - never while a hold is active or a transition is running (the intermediate
 *   then holds a frozen or blended frame, not the scene the map would label);
 * - plus one refresh `DEPTH_RELEASE_REFRESH_MS` after a release, because Street
 *   View keeps sharpening tiles after the stability check lets go.
 */

export const DEPTH_SETTLE_MS = 150;
export const DEPTH_MIN_INTERVAL_MS = 200;
export const DEPTH_RELEASE_REFRESH_MS = 1200;
/** After a failed inference, wait this long before trying again. */
export const DEPTH_RETRY_MS = 2000;
/** Pan / zoom changes below this are the same view (sub-pixel at any FOV). */
const POV_EPSILON = 1e-4;

/** A view, in the renderer's normalized pan space (`panX` 0–1 wraps, `panY` 0–1) and digital zoom. */
export interface DepthPov {
    panX: number;
    panY: number;
    zoom: number;
}

export interface DepthSchedulerFrame {
    nowMs: number;
    pov: DepthPov;
    /** Bumped every time a new pano becomes visible (hold release). */
    epoch: number;
    holdActive: boolean;
    transitioning: boolean;
    /** The estimator can take a request right now (loaded, nothing in flight). */
    estimatorIdle: boolean;
}

/** Shortest signed distance between two wrapped pan values. */
export function wrapPanDelta(a: number, b: number): number {
    let d = a - b;
    d -= Math.round(d);
    return d;
}

export function sameView(a: DepthPov, b: DepthPov): boolean {
    return Math.abs(wrapPanDelta(a.panX, b.panX)) < POV_EPSILON
        && Math.abs(a.panY - b.panY) < POV_EPSILON
        && Math.abs(a.zoom - b.zoom) < POV_EPSILON;
}

export class DepthScheduler {
    private lastPov: DepthPov | null = null;
    private lastPovChangeMs = -Infinity;
    private lastStartMs = -Infinity;
    private notBeforeMs = -Infinity;
    private inferredPov: DepthPov | null = null;
    private inferredEpoch = -1;
    private epochSeen = -1;
    private epochStartMs = -Infinity;
    private refreshPending = false;

    /** Call every frame; true when an inference should start now (then call `started`). */
    public shouldStart(frame: DepthSchedulerFrame): boolean {
        this.observe(frame);
        if (!frame.estimatorIdle || frame.holdActive || frame.transitioning) return false;
        if (frame.nowMs < this.notBeforeMs) return false;
        if (frame.nowMs - this.lastStartMs < DEPTH_MIN_INTERVAL_MS) return false;
        if (frame.nowMs - this.lastPovChangeMs < DEPTH_SETTLE_MS) return false;
        if (this.isStale(frame)) return true;
        return this.refreshPending
            && this.inferredEpoch === frame.epoch
            && frame.nowMs - this.epochStartMs >= DEPTH_RELEASE_REFRESH_MS;
    }

    /** An inference for this frame's view and epoch was sent. */
    public started(frame: DepthSchedulerFrame): void {
        this.lastStartMs = frame.nowMs;
        if (this.inferredEpoch === frame.epoch && this.inferredPov && sameView(this.inferredPov, frame.pov)) {
            this.refreshPending = false;
        }
        this.inferredPov = { ...frame.pov };
        this.inferredEpoch = frame.epoch;
    }

    /** The inference failed or was dropped: forget it, and back off before the next try. */
    public failed(nowMs: number): void {
        this.inferredPov = null;
        this.inferredEpoch = -1;
        this.notBeforeMs = nowMs + DEPTH_RETRY_MS;
    }

    /** The result was thrown away (the pano changed under it): forget it, no back-off. */
    public dropped(): void {
        this.inferredPov = null;
        this.inferredEpoch = -1;
    }

    /** Forget everything (depth turned off, or the device was re-created). */
    public reset(): void {
        this.lastPov = null;
        this.lastPovChangeMs = -Infinity;
        this.lastStartMs = -Infinity;
        this.notBeforeMs = -Infinity;
        this.inferredPov = null;
        this.inferredEpoch = -1;
        this.epochSeen = -1;
        this.refreshPending = false;
    }

    private observe(frame: DepthSchedulerFrame): void {
        if (!this.lastPov || !sameView(this.lastPov, frame.pov)) {
            this.lastPov = { ...frame.pov };
            this.lastPovChangeMs = frame.nowMs;
        }
        if (frame.epoch !== this.epochSeen) {
            // The first epoch is the initial load: it gets a refresh too.
            this.epochSeen = frame.epoch;
            this.epochStartMs = frame.nowMs;
            this.refreshPending = true;
        }
    }

    private isStale(frame: DepthSchedulerFrame): boolean {
        return this.inferredEpoch !== frame.epoch
            || !this.inferredPov
            || !sameView(this.inferredPov, frame.pov);
    }
}
