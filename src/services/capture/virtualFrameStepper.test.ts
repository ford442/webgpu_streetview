import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInputsState } from '../../types/frameInputs';
import { frameNow, isVirtualDriven, requestFrame, resetFrameClockForTests } from '../../xr/frameClock';
import {
    FRAME_READINESS_DEFAULTS,
    FrameReadinessError,
    VirtualFrameStepper,
    awaitFrameInputs,
    type FrameReadinessSource,
} from './virtualFrameStepper';

/** A fake real clock: `sleep` advances it, nothing else does. */
function fakeClock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
        now: () => t,
        sleep: (ms: number) => {
            sleeps.push(ms);
            t += ms;
            return Promise.resolve();
        },
        sleeps,
    };
}

const IDLE: FrameInputsState = { holdActive: false, depth: 'off', semantic: 'off' };

/** A source whose inputs follow a script indexed by the fake clock's time. */
function scriptedSource(script: (t: number) => Partial<FrameInputsState>, clock: { now(): number }): FrameReadinessSource & {
    gpuIdle: ReturnType<typeof vi.fn>;
} {
    return {
        inputs: () => ({ ...IDLE, ...script(clock.now()) }),
        gpuIdle: vi.fn(() => Promise.resolve()),
    };
}

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
    resetFrameClockForTests();
    vi.unstubAllGlobals();
});

describe('awaitFrameInputs', () => {
    it('goes straight through when nothing is pending', async () => {
        const clock = fakeClock();
        const report = await awaitFrameInputs(scriptedSource(() => ({}), clock), clock);
        expect(report).toEqual({ waitedMs: 0, polls: 2, depth: 'off', semantic: 'off', tiles: 'unchecked' });
        expect(clock.sleeps).toEqual([]);
    });

    it('waits out the hold — never runs a frame while it is up', async () => {
        const clock = fakeClock();
        const source = scriptedSource((t) => ({ holdActive: t < 300 }), clock);
        const report = await awaitFrameInputs(source, { ...clock, pollMs: 100 });
        expect(report.waitedMs).toBe(300);
        expect(clock.sleeps).toEqual([100, 100, 100]);
    });

    it('fails on a hold that never releases', async () => {
        const clock = fakeClock();
        const source = scriptedSource(() => ({ holdActive: true }), clock);
        await expect(awaitFrameInputs(source, { ...clock, pollMs: 250, holdTimeoutMs: 1000 }))
            .rejects.toBeInstanceOf(FrameReadinessError);
    });

    it('waits for depth and semantic work in flight, then reports them ready', async () => {
        const clock = fakeClock();
        const source = scriptedSource((t) => ({
            depth: t < 200 ? 'busy' : 'idle',
            semantic: t < 400 ? 'busy' : 'idle',
        }), clock);
        const report = await awaitFrameInputs(source, { ...clock, pollMs: 100 });
        expect(report).toMatchObject({ waitedMs: 400, depth: 'ready', semantic: 'ready' });
    });

    it('skips a map that is still busy at the timeout, and says so', async () => {
        const clock = fakeClock();
        const source = scriptedSource(() => ({ depth: 'busy', semantic: 'idle' }), clock);
        const report = await awaitFrameInputs(source, { ...clock, pollMs: 100, mapsTimeoutMs: 500 });
        expect(report).toMatchObject({ waitedMs: 500, depth: 'skipped', semantic: 'ready' });
    });

    it('needs two agreeing fresh fingerprints before the tiles count as settled', async () => {
        const clock = fakeClock();
        const prints = ['', 'a', 'b', 'b'];
        const source: FrameReadinessSource = {
            ...scriptedSource(() => ({}), clock),
            tilesFingerprint: () => Promise.resolve(prints.shift() ?? 'b'),
        };
        const report = await awaitFrameInputs(source, { ...clock, tileIntervalMs: 50 });
        expect(report).toMatchObject({ tiles: 'settled', waitedMs: 150 });
        expect(prints).toEqual([]);
    });

    it('a blank canvas never settles: the frame goes ahead at the timeout', async () => {
        const clock = fakeClock();
        const source: FrameReadinessSource = {
            ...scriptedSource(() => ({}), clock),
            tilesFingerprint: () => Promise.resolve(''),
        };
        const report = await awaitFrameInputs(source, { ...clock, tileIntervalMs: 50, tilesTimeoutMs: 200 });
        expect(report.tiles).toBe('timeout');
    });

    it('a hold that goes up while the tiles settle sends it back to waiting', async () => {
        const clock = fakeClock();
        let fingerprintCalls = 0;
        const source: FrameReadinessSource = {
            ...scriptedSource((t) => ({ holdActive: t >= 50 && t < 300 }), clock),
            tilesFingerprint: () => {
                fingerprintCalls += 1;
                return Promise.resolve('same');
            },
        };
        const report = await awaitFrameInputs(source, { ...clock, pollMs: 50, tileIntervalMs: 50 });
        expect(report.tiles).toBe('settled');
        expect(report.waitedMs).toBeGreaterThanOrEqual(300);
        // One sample before the hold, discarded with it (the canvas behind a
        // hold is a new pano), then two fresh ones after it that agree.
        expect(fingerprintCalls).toBe(3);
    });

    it('has defaults for every timing', () => {
        expect(FRAME_READINESS_DEFAULTS.holdTimeoutMs).toBeGreaterThan(FRAME_READINESS_DEFAULTS.mapsTimeoutMs);
    });
});

describe('VirtualFrameStepper', () => {
    it('runs each frame at start + n / fps, computed rather than accumulated', async () => {
        const clock = fakeClock();
        const source = scriptedSource(() => ({}), clock);
        const times: number[] = [];
        const loop = (t: number) => {
            times.push(t);
            requestFrame(loop);
        };
        requestFrame(loop);
        const stepper = VirtualFrameStepper.begin(source, { fps: 60, startMs: 0, ...clock });
        try {
            for (let i = 0; i < 600; i += 1) await stepper.step();
        } finally {
            stepper.end();
        }
        expect(times).toHaveLength(600);
        expect(times[0]).toBe(1000 / 60);
        expect(times[599]).toBe(600 * (1000 / 60));
        expect(times[599]).toBe(10_000);
        expect(stepper.frames).toBe(600);
        expect(source.gpuIdle).toHaveBeenCalledTimes(600);
    });

    it('waits for the inputs before the frame and for the GPU after it', async () => {
        const clock = fakeClock();
        const order: string[] = [];
        const source: FrameReadinessSource = {
            inputs: () => {
                order.push('inputs');
                return { ...IDLE, depth: clock.now() < 100 ? 'busy' : 'idle' };
            },
            gpuIdle: () => {
                order.push('gpu');
                return Promise.resolve();
            },
        };
        requestFrame(() => order.push('frame'));
        const stepper = VirtualFrameStepper.begin(source, { fps: 30, startMs: 0, ...clock, pollMs: 100 });
        const report = await stepper.step();
        stepper.end();
        expect(order).toEqual(['inputs', 'inputs', 'inputs', 'frame', 'gpu']);
        expect(report).toMatchObject({ frame: 1, timeMs: 1000 / 30, callbacks: 1, depth: 'ready', waitedMs: 100 });
    });

    it('owns the clock until end(), which is idempotent and stops further steps', async () => {
        const clock = fakeClock();
        const stepper = VirtualFrameStepper.begin(scriptedSource(() => ({}), clock), { fps: 24, startMs: 5000, ...clock });
        expect(isVirtualDriven()).toBe(true);
        expect(frameNow()).toBe(5000);
        await stepper.step();
        stepper.end();
        stepper.end();
        expect(isVirtualDriven()).toBe(false);
        await expect(stepper.step()).rejects.toThrow(/after end/);
    });

    it('refuses overlapping steps and a bad fps', async () => {
        const clock = fakeClock();
        expect(() => VirtualFrameStepper.begin(scriptedSource(() => ({}), clock), { fps: 0 })).toThrow(RangeError);
        expect(isVirtualDriven()).toBe(false);
        const stepper = VirtualFrameStepper.begin(scriptedSource(() => ({}), clock), { fps: 60, ...clock });
        const first = stepper.step();
        await expect(stepper.step()).rejects.toThrow(/already running/);
        await first;
        stepper.end();
    });
});
