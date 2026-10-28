/**
 * The frame-budget loop (#329): one pure step per frame, `(state, timings) →
 * state`, whose `scale` is the render scale to request next
 * (`renderScale.ts#setRequestedRenderScale`). `WebGPUCanvas` drives it.
 *
 * Two signals, never mixed within a session:
 *
 * - **GPU** (`timestamp-query`): the road passes' time (pass 1 + weather + blit
 *   + upscale, `gpuPassTimingStore.ts`) against a share of the frame. Pixel
 *   cost scales with `scale²`, so stepping up is predicted before it is taken —
 *   under a steady load the loop settles and never comes back up into a level
 *   it just left, and when the load drops it climbs straight back. A level the
 *   prediction got wrong (stepped up into, then over budget) is blocked like
 *   a frame-time probe.
 * - **Frame time** (the frame driver's last rAF interval), when there are no
 *   timestamps. rAF is vsync-capped, so an unloaded frame reads as the budget
 *   and headroom is invisible: the loop probes one step up after holding at
 *   budget for a while, and a level that then overloads is blocked for a
 *   cooldown that doubles every time it fails again.
 *
 * Every move is one `step` (5 %), at most once per `windowFrames` frames,
 * decided on the median of that window. A frozen frame (hold-pause, reduced
 * motion) resets the window: the scale never moves during a hold, and the
 * first decision after one waits for a full window of fresh frames.
 */

export interface FrameBudgetConfig {
    /** The frame budget, ms (60 Hz). */
    targetFrameMs: number;
    /** Share of the frame the road's GPU passes may use (the cabin and the compositor need the rest). */
    gpuShare: number;
    min: number;
    max: number;
    step: number;
    /** Frames per decision — and the minimum distance between two moves. */
    windowFrames: number;
    /** GPU samples a window needs before it decides (timings arrive 1–3 frames late). */
    minGpuSamples: number;
    /** Over budget × (1 + this) for a window steps down. */
    overloadMargin: number;
    /** GPU: step up only when the next level is predicted under budget × this. */
    upHeadroom: number;
    /** Frame time: hold at budget this long before probing a step up. */
    probeAfterMs: number;
    /** A level that overloaded stays blocked this long; doubles on each repeat. */
    blockMs: number;
    maxBlockMs: number;
    /**
     * Frame time: the slowest display refresh the loop will learn as its
     * budget (a 50 Hz panel's 20 ms is the budget there, not an overload).
     * Anything slower is the GPU not keeping up, not the display.
     */
    slowestRefreshMs: number;
}

export const DEFAULT_FRAME_BUDGET: Omit<FrameBudgetConfig, 'min' | 'max'> = {
    targetFrameMs: 1000 / 60,
    gpuShare: 0.75,
    step: 0.05,
    windowFrames: 10,
    minGpuSamples: 3,
    overloadMargin: 0.05,
    upHeadroom: 0.85,
    probeAfterMs: 3000,
    blockMs: 8000,
    maxBlockMs: 64000,
    slowestRefreshMs: 1000 / 48,
};

export interface FrameBudgetInput {
    nowMs: number;
    /**
     * Road GPU time of one frame rendered at the current scale, or null when
     * this frame brought no fresh sample. The caller drops samples tagged with
     * another scale.
     */
    gpuMs: number | null;
    /** Whether this device stamps timestamps at all — selects the GPU signal. */
    gpuAvailable: boolean;
    /** The last rAF interval, ms — raw: the window's median is the smoothing. */
    frameMs: number | null;
    /** Hold-pause or reduced motion: do not move, start a fresh window afterwards. */
    frozen: boolean;
}

export interface FrameBudgetBlock {
    /** The level that overloaded; this and everything above it stay off-limits. */
    level: number;
    untilMs: number;
    durationMs: number;
}

export interface FrameBudgetState {
    scale: number;
    framesSinceChange: number;
    /** The current window's samples, oldest first: GPU cost / budget ratios, or frame ms. */
    window: number[];
    /** Frame-time signal: since when the window has been at or under budget. */
    atBudgetSinceMs: number | null;
    block: FrameBudgetBlock | null;
    /** Frame time: the fastest window median seen, ms — the display's refresh, once it is under `slowestRefreshMs`. */
    fastestFrameMs: number | null;
    /** How the loop reached `scale`: a level it stepped up into and then overloaded on gets blocked. */
    enteredBy: 'up' | 'down' | null;
}

export function createFrameBudgetState(scale: number): FrameBudgetState {
    return { scale, framesSinceChange: 0, window: [], atBudgetSinceMs: null, block: null, fastestFrameMs: null, enteredBy: null };
}

const EPS = 1e-6;

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round to the step grid so repeated ± steps never drift off it. */
function snap(scale: number, step: number): number {
    const steps = Math.round(1 / step);
    return Math.round(scale * steps) / steps;
}

function isBlocked(block: FrameBudgetBlock | null, level: number, nowMs: number): boolean {
    return !!block && nowMs < block.untilMs && level >= block.level - EPS;
}

function moved(
    state: FrameBudgetState,
    scale: number,
    block: FrameBudgetBlock | null,
    enteredBy: 'up' | 'down',
): FrameBudgetState {
    return { ...state, scale, framesSinceChange: 0, window: [], atBudgetSinceMs: null, block, enteredBy };
}

/** One frame of the budget loop. Pure: the same state and input give the same state. */
export function stepFrameBudget(
    state: FrameBudgetState,
    input: FrameBudgetInput,
    config: FrameBudgetConfig,
): FrameBudgetState {
    const scale = Math.min(config.max, Math.max(config.min, state.scale));
    if (input.frozen) {
        return { ...state, scale, framesSinceChange: 0, window: [], atBudgetSinceMs: null };
    }

    const useGpu = input.gpuAvailable;
    const sample = useGpu
        ? (input.gpuMs != null ? input.gpuMs / (config.targetFrameMs * config.gpuShare) : null)
        : input.frameMs;

    const window = sample == null || !Number.isFinite(sample)
        ? state.window
        : [...state.window, sample].slice(-config.windowFrames);
    const framesSinceChange = state.framesSinceChange + 1;
    const next: FrameBudgetState = { ...state, scale, framesSinceChange, window };

    const enoughSamples = useGpu ? window.length >= config.minGpuSamples : window.length >= config.windowFrames;
    if (framesSinceChange < config.windowFrames || !enoughSamples) return next;

    let ratio = median(window);
    if (!useGpu) {
        const fastest = Math.min(state.fastestFrameMs ?? Infinity, ratio);
        next.fastestFrameMs = fastest;
        const refresh = fastest <= config.slowestRefreshMs ? fastest : 0;
        ratio /= Math.max(config.targetFrameMs, refresh);
    }

    if (ratio > 1 + config.overloadMargin) {
        if (scale <= config.min + EPS) return { ...next, atBudgetSinceMs: null };
        const down = snap(scale - config.step, config.step);
        // GPU: the prediction keeps the loop out of a level that will not fit,
        // so only a level it predicted wrong (stepped up into) is blocked —
        // after a load spike the loop climbs straight back. Frame time cannot
        // predict: every level that overloads is blocked.
        if (useGpu && state.enteredBy !== 'up') return moved(next, down, state.block, 'down');
        const repeat = state.block && Math.abs(state.block.level - scale) < EPS;
        const durationMs = repeat
            ? Math.min(config.maxBlockMs, state.block!.durationMs * 2)
            : config.blockMs;
        return moved(next, down, { level: scale, untilMs: input.nowMs + durationMs, durationMs }, 'down');
    }

    const up = snap(scale + config.step, config.step);
    if (up > config.max + EPS || isBlocked(state.block, up, input.nowMs)) {
        return { ...next, atBudgetSinceMs: null };
    }

    if (useGpu) {
        const predicted = ratio * (up / scale) ** 2;
        return predicted < config.upHeadroom ? moved(next, up, state.block, 'up') : next;
    }

    // Frame time: at budget is all a vsync-capped signal can say. Probe after a while.
    const since = state.atBudgetSinceMs ?? input.nowMs;
    if (input.nowMs - since >= config.probeAfterMs) return moved(next, up, state.block, 'up');
    return { ...next, atBudgetSinceMs: since };
}
