import { describe, expect, it } from 'vitest';
import {
    DEPTH_MIN_INTERVAL_MS,
    DEPTH_RELEASE_REFRESH_MS,
    DEPTH_RETRY_MS,
    DEPTH_SETTLE_MS,
    DepthScheduler,
    sameView,
    wrapPanDelta,
    type DepthSchedulerFrame,
} from './depthScheduler';

const POV = { panX: 0.25, panY: 0.5, zoom: 1 };

function frame(nowMs: number, patch: Partial<DepthSchedulerFrame> = {}): DepthSchedulerFrame {
    return {
        nowMs,
        pov: POV,
        epoch: 0,
        holdActive: false,
        transitioning: false,
        estimatorIdle: true,
        ...patch,
    };
}

/** Step 16 ms frames from `from` to `to`; returns the times an inference started. */
function run(s: DepthScheduler, from: number, to: number, patch: (t: number) => Partial<DepthSchedulerFrame> = () => ({})) {
    const starts: number[] = [];
    for (let t = from; t <= to; t += 16) {
        const f = frame(t, patch(t));
        if (s.shouldStart(f)) {
            s.started(f);
            starts.push(t);
        }
    }
    return starts;
}

describe('pan wrap', () => {
    it('measures across the 0/1 seam the short way', () => {
        expect(wrapPanDelta(0.02, 0.98)).toBeCloseTo(0.04, 10);
        expect(wrapPanDelta(0.98, 0.02)).toBeCloseTo(-0.04, 10);
        expect(sameView({ panX: 0, panY: 0.5, zoom: 1 }, { panX: 1, panY: 0.5, zoom: 1 })).toBe(true);
    });
});

describe('the depth cadence', () => {
    it('infers once the view has settled, then not again while nothing changes (bar one release refresh)', () => {
        const s = new DepthScheduler();
        const starts = run(s, 0, 5000);
        expect(starts[0]).toBeGreaterThanOrEqual(DEPTH_SETTLE_MS);
        expect(starts[0]).toBeLessThan(DEPTH_SETTLE_MS + 32);
        // The initial view counts as a release: one refresh once the tiles have had time.
        expect(starts).toHaveLength(2);
        expect(starts[1]).toBeGreaterThanOrEqual(DEPTH_RELEASE_REFRESH_MS);
    });

    it('waits for look input to settle, and never exceeds 5 Hz', () => {
        const s = new DepthScheduler();
        // Panning continuously for 2 s: nothing.
        const moving = run(s, 0, 2000, (t) => ({ pov: { ...POV, panX: 0.25 + t * 1e-4 } }));
        expect(moving).toEqual([]);
        // Then a burst of small moves every 160 ms (just past the settle time).
        const bursty = run(s, 2016, 6000, (t) => ({ pov: { ...POV, panX: 0.5 + Math.floor(t / 400) * 0.01 } }));
        for (let i = 1; i < bursty.length; i++) {
            expect(bursty[i]! - bursty[i - 1]!).toBeGreaterThanOrEqual(DEPTH_MIN_INTERVAL_MS);
        }
        expect(bursty.length).toBeGreaterThan(0);
    });

    it('never runs during a hold or a transition, and re-runs for the new pano after', () => {
        const s = new DepthScheduler();
        expect(run(s, 0, 400)).toHaveLength(1);
        expect(run(s, 416, 3000, () => ({ holdActive: true }))).toEqual([]);
        expect(run(s, 3016, 3300, () => ({ epoch: 1, transitioning: true }))).toEqual([]);
        const after = run(s, 3316, 3700, () => ({ epoch: 1 }));
        expect(after).toHaveLength(1);
        expect(after[0]).toBeLessThan(3316 + 32);
    });

    it('one inference in flight at a time', () => {
        const s = new DepthScheduler();
        expect(run(s, 0, 3000, () => ({ estimatorIdle: false }))).toEqual([]);
    });

    it('backs off after a failure instead of hammering the worker', () => {
        const s = new DepthScheduler();
        const first = run(s, 0, 300);
        expect(first).toHaveLength(1);
        s.failed(first[0]!);
        const retry = run(s, first[0]! + 16, first[0]! + DEPTH_RETRY_MS + 100);
        expect(retry).toHaveLength(1);
        expect(retry[0]! - first[0]!).toBeGreaterThanOrEqual(DEPTH_RETRY_MS);
    });

    it('a zoom change is a new view', () => {
        const s = new DepthScheduler();
        run(s, 0, 1500);
        expect(run(s, 1516, 2000, () => ({ pov: { ...POV, zoom: 1.5 } }))).toHaveLength(1);
    });
});
