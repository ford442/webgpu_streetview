/**
 * The frame-budget loop on timing traces: a simulated frame loop whose road
 * GPU cost scales with `scale²` (the pixel count), delivered the way the app
 * delivers it — timestamps 2 frames late and tagged with the scale they ran
 * at (`WebGPUCanvas` drops a sample from another scale), or the raw
 * vsync-quantised rAF interval.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FRAME_BUDGET,
    createFrameBudgetState,
    stepFrameBudget,
    type FrameBudgetConfig,
    type FrameBudgetState,
} from './frameBudget';

const VSYNC_MS = 1000 / 60;
const GPU_BUDGET_MS = DEFAULT_FRAME_BUDGET.targetFrameMs * DEFAULT_FRAME_BUDGET.gpuShare; // 12.5
const GPU_LATENCY_FRAMES = 2;

interface TracePoint {
    nowMs: number;
    scale: number;
}

interface TraceOptions {
    /** Road GPU ms of one frame at `scale`. */
    cost: (scale: number, nowMs: number) => number;
    start: number;
    min?: number;
    max?: number;
    durationMs: number;
    signal: 'gpu' | 'frame-time';
    /** ± fraction of per-frame jitter. */
    jitter?: number;
    frozen?: (nowMs: number) => boolean;
    /** Display refresh interval, ms (60 Hz). */
    vsyncMs?: number;
}

/** Pixel-bound: `fullMs` at scale 1, ∝ scale². */
const pixels = (fullMs: number | ((nowMs: number) => number)) => (scale: number, nowMs: number) =>
    (typeof fullMs === 'number' ? fullMs : fullMs(nowMs)) * scale * scale;

/** Deterministic jitter (mulberry32). */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function run(opts: TraceOptions): TracePoint[] {
    const config: FrameBudgetConfig = { ...DEFAULT_FRAME_BUDGET, min: opts.min ?? 0.5, max: opts.max ?? 1 };
    const random = rng(329);
    const jitter = opts.jitter ?? 0.05;
    const vsync = opts.vsyncMs ?? VSYNC_MS;
    let state: FrameBudgetState = createFrameBudgetState(opts.start);
    let nowMs = 0;
    const inFlight: Array<{ readyAt: number; gpuMs: number; scale: number }> = [];
    const trace: TracePoint[] = [];
    for (let frameIndex = 0; nowMs < opts.durationMs; frameIndex++) {
        const scale = state.scale;
        const gpuMs = opts.cost(scale, nowMs) * (1 + jitter * (2 * random() - 1));
        // The road is gpuShare of the GPU frame; a frame never beats vsync.
        const frameMs = Math.max(1, Math.ceil(gpuMs / DEFAULT_FRAME_BUDGET.gpuShare / vsync - 1e-9)) * vsync;
        nowMs += opts.signal === 'gpu' ? Math.max(vsync, gpuMs / DEFAULT_FRAME_BUDGET.gpuShare) : frameMs;

        inFlight.push({ readyAt: frameIndex + GPU_LATENCY_FRAMES, gpuMs, scale });
        let sample: number | null = null;
        while (inFlight.length && inFlight[0]!.readyAt <= frameIndex) {
            const read = inFlight.shift()!;
            sample = read.scale === scale ? read.gpuMs : null;
        }

        state = stepFrameBudget(state, {
            nowMs,
            gpuMs: opts.signal === 'gpu' ? sample : null,
            gpuAvailable: opts.signal === 'gpu',
            frameMs,
            frozen: opts.frozen?.(nowMs) ?? false,
        }, config);
        trace.push({ nowMs, scale: state.scale });
    }
    return trace;
}

/** The time of the last change before `untilMs` — when the trace settled. */
function settledAt(trace: TracePoint[], fromMs = 0, untilMs = Infinity): number {
    let at = fromMs;
    for (let i = 1; i < trace.length; i++) {
        const p = trace[i]!;
        if (p.nowMs <= fromMs || p.nowMs > untilMs) continue;
        if (p.scale !== trace[i - 1]!.scale) at = p.nowMs;
    }
    return at;
}

const scaleAt = (trace: TracePoint[], ms: number) => trace.find((p) => p.nowMs >= ms)!.scale;
const levels = (trace: TracePoint[], fromMs: number, untilMs = Infinity) =>
    [...new Set(trace.filter((p) => p.nowMs >= fromMs && p.nowMs <= untilMs).map((p) => p.scale))].sort();

/** When the trace stepped up, after `fromMs`. */
function upSteps(trace: TracePoint[], fromMs: number): number[] {
    const at: number[] = [];
    for (let i = 1; i < trace.length; i++) {
        if (trace[i]!.nowMs > fromMs && trace[i]!.scale > trace[i - 1]!.scale) at.push(trace[i]!.nowMs);
    }
    return at;
}

function expectGrowingGaps(times: number[]) {
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]! - 100);
}

/** Never more than one step per window of frames. */
function expectStepLimit(trace: TracePoint[]) {
    let last = -Infinity;
    for (let i = 1; i < trace.length; i++) {
        const delta = Math.abs(trace[i]!.scale - trace[i - 1]!.scale);
        if (delta === 0) continue;
        expect(delta).toBeCloseTo(DEFAULT_FRAME_BUDGET.step, 9);
        expect(i - last).toBeGreaterThanOrEqual(DEFAULT_FRAME_BUDGET.windowFrames);
        last = i;
    }
}

describe('frame budget — GPU timestamps', () => {
    it('an overloaded GPU settles on the largest scale that fits, within 2 s, and stays', () => {
        const trace = run({ signal: 'gpu', start: 1, durationMs: 20_000, cost: pixels(19) });
        expect(settledAt(trace)).toBeLessThan(2000);
        const settled = scaleAt(trace, 2000);
        expect(19 * settled * settled).toBeLessThanOrEqual(GPU_BUDGET_MS);
        const up = settled + 0.05;
        expect(19 * up * up).toBeGreaterThan(GPU_BUDGET_MS * DEFAULT_FRAME_BUDGET.upHeadroom);
        expect(levels(trace, 2000)).toEqual([settled]);
        expectStepLimit(trace);
    });

    it('an unloaded GPU climbs from the floor to full resolution within 2 s', () => {
        const trace = run({ signal: 'gpu', start: 0.5, durationMs: 6000, cost: pixels(6) });
        expect(scaleAt(trace, 2000)).toBe(1);
        expect(levels(trace, 2000)).toEqual([1]);
        expectStepLimit(trace);
    });

    it('a load spike (?burn=): steps down, then climbs straight back when it ends', () => {
        const burn = (ms: number) => ms >= 3000 && ms < 13_000;
        const trace = run({ signal: 'gpu', start: 1, durationMs: 20_000, cost: pixels((ms) => (burn(ms) ? 24 : 8)) });
        expect(levels(trace, 0, 3000)).toEqual([1]);
        expect(settledAt(trace, 3000, 13_000) - 3000).toBeLessThan(2000);
        const loaded = levels(trace, 5000, 13_000);
        expect(loaded).toHaveLength(1);
        expect(loaded[0]).toBeLessThan(0.8);
        expect(settledAt(trace, 13_000) - 13_000).toBeLessThan(2000);
        expect(levels(trace, 15_000)).toEqual([1]);
        expectStepLimit(trace);
    });

    it('a load right at a level boundary does not oscillate by more than one step', () => {
        // 0.8 → 12.8 ms (2 % over budget, under the margin); 0.85 → 14.5 ms.
        const trace = run({ signal: 'gpu', start: 1, durationMs: 30_000, cost: pixels(20), jitter: 0.15 });
        const late = levels(trace, 2000);
        expect(late.length).toBeLessThanOrEqual(2);
        if (late.length === 2) expect(late[1]! - late[0]!).toBeCloseTo(0.05, 9);
    });

    it('a level the prediction got wrong is blocked, and re-probed ever less often', () => {
        // A cliff: 0.9 and up cost 20 ms (say, a cache that stops fitting), below it pixel-bound.
        const cliff = (scale: number) => (scale >= 0.9 - 1e-9 ? 20 : 8 * scale * scale);
        const trace = run({ signal: 'gpu', start: 1, durationMs: 120_000, cost: cliff, jitter: 0.02 });
        expect(settledAt(trace, 0, 2000)).toBeLessThan(2000);
        expect(levels(trace, 2000)).toEqual([0.85, 0.9]);
        const probes = upSteps(trace, 2000);
        expect(probes.length).toBeGreaterThanOrEqual(3);
        expect(probes.length).toBeLessThan(8);
        expectGrowingGaps(probes);
        expectStepLimit(trace);
    });

    it('respects the preset floor and ceiling', () => {
        const heavy = run({ signal: 'gpu', start: 1, min: 0.7, durationMs: 8000, cost: pixels(80) });
        expect(Math.min(...heavy.map((p) => p.scale))).toBe(0.7);
        const light = run({ signal: 'gpu', start: 0.6, max: 0.75, durationMs: 8000, cost: pixels(1) });
        expect(Math.max(...light.map((p) => p.scale))).toBe(0.75);
    });
});

describe('frame budget — rAF interval (no timestamps)', () => {
    it('steps down to a level that holds vsync, within 2 s', () => {
        // Total GPU 24 ms at 1 → 30 fps; ≤ 16.7 ms from 0.8 down.
        const trace = run({ signal: 'frame-time', start: 1, durationMs: 2500, cost: pixels(18) });
        expect(settledAt(trace)).toBeLessThan(2000);
        const settled = scaleAt(trace, 2000);
        expect(24 * settled * settled).toBeLessThanOrEqual(VSYNC_MS);
    });

    it('probes up at most one step, and backs off each failed probe (8 s, 16 s, …)', () => {
        const trace = run({ signal: 'frame-time', start: 1, durationMs: 120_000, cost: pixels(18) });
        const late = levels(trace, 2000);
        expect(late.length).toBeLessThanOrEqual(2);
        if (late.length === 2) expect(late[1]! - late[0]!).toBeCloseTo(0.05, 9);
        // Probes (steps up) get rarer: gaps between them grow.
        const probes = upSteps(trace, 2000);
        expect(probes.length).toBeLessThan(8);
        expectGrowingGaps(probes);
        expectStepLimit(trace);
    });

    it('a 50 Hz display is its own budget, not an overload', () => {
        const idle = run({ signal: 'frame-time', start: 1, durationMs: 20_000, cost: pixels(6), vsyncMs: 20 });
        expect(levels(idle, 0)).toEqual([1]);
        // 30 ms total at 1 → 25 fps; fits 20 ms from 0.8 down (and 16.7 ms only from 0.7).
        const loaded = run({ signal: 'frame-time', start: 1, durationMs: 2500, cost: pixels(22.5), vsyncMs: 20 });
        expect(settledAt(loaded)).toBeLessThan(2000);
        expect(scaleAt(loaded, 2000)).toBe(0.8);
    });

    it('starting overloaded on a 30 fps cadence is read as overload, not as a 30 Hz display', () => {
        const trace = run({ signal: 'frame-time', start: 1, durationMs: 3000, cost: pixels(18) });
        expect(scaleAt(trace, 2500)).toBeLessThan(1);
    });

    it('with headroom it climbs back to full resolution', () => {
        const trace = run({ signal: 'frame-time', start: 0.75, durationMs: 30_000, cost: pixels(6) });
        expect(trace.at(-1)!.scale).toBe(1);
    });
});

describe('frame budget — frozen', () => {
    it('a hold or reduced motion never moves the scale, and the first decision after waits a full window', () => {
        const hold = (ms: number) => ms >= 0 && ms < 5000;
        const trace = run({ signal: 'gpu', start: 1, durationMs: 8000, cost: pixels(40), frozen: hold });
        expect(levels(trace, 0, 4999)).toEqual([1]);
        const firstMove = trace.findIndex((p) => p.scale !== 1);
        const releasedAt = trace.findIndex((p) => p.nowMs >= 5000);
        expect(firstMove - releasedAt).toBeGreaterThanOrEqual(DEFAULT_FRAME_BUDGET.windowFrames - 1);
    });

    it('is pure: the same state and input give the same state', () => {
        const config = { ...DEFAULT_FRAME_BUDGET, min: 0.5, max: 1 };
        const s = createFrameBudgetState(0.8);
        const input = { nowMs: 100, gpuMs: 30, gpuAvailable: true, frameMs: 33, frozen: false };
        expect(stepFrameBudget(s, input, config)).toEqual(stepFrameBudget(s, input, config));
        expect(s).toEqual(createFrameBudgetState(0.8));
    });
});
