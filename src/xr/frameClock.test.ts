import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    beginVirtualFrames,
    beginXrFrames,
    cancelFrame,
    endVirtualFrames,
    endXrFrames,
    frameNow,
    isVirtualDriven,
    requestFrame,
    resetFrameClockForTests,
    runXrFrame,
    stepFrame,
    stepFrameTo,
} from './frameClock';

let windowQueue: Map<number, (t: number) => void>;
let windowId = 0;

function tickWindow(time: number) {
    const due = Array.from(windowQueue.entries());
    windowQueue.clear();
    for (const [, cb] of due) cb(time);
}

beforeEach(() => {
    windowQueue = new Map();
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
        windowQueue.set(++windowId, cb);
        return windowId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => windowQueue.delete(id));
});
afterEach(() => {
    resetFrameClockForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A self-rescheduling loop, like the road and car loops. */
function loop(name: string, log: string[]) {
    const frame = (t: number) => {
        log.push(`${name}@${t}`);
        requestFrame(frame);
    };
    return requestFrame(frame);
}

describe('frame clock', () => {
    it('is the window clock outside a session', () => {
        const log: string[] = [];
        loop('road', log);
        loop('car', log);
        tickWindow(16);
        expect(log).toEqual(['road@16', 'car@16']);
    });

    it('moves running loops to the session and back, keeping their order', () => {
        const log: string[] = [];
        loop('road', log);
        loop('car', log);
        beginXrFrames();
        tickWindow(16);
        expect(log).toEqual([]); // nothing left on the window clock
        runXrFrame(100);
        runXrFrame(111);
        expect(log).toEqual(['road@100', 'car@100', 'road@111', 'car@111']);
        endXrFrames();
        runXrFrame(122);
        tickWindow(133);
        expect(log.slice(4)).toEqual(['road@133', 'car@133']);
    });

    it('cancels on either clock, including across the switch', () => {
        const ran = vi.fn();
        const a = requestFrame(ran);
        beginXrFrames();
        cancelFrame(a);
        runXrFrame(1);
        const b = requestFrame(ran);
        endXrFrames();
        cancelFrame(b);
        tickWindow(2);
        expect(ran).not.toHaveBeenCalled();
    });

    it('a failing callback does not starve the ones after it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const after = vi.fn();
        beginXrFrames();
        requestFrame(() => { throw new Error('boom'); });
        requestFrame(after);
        runXrFrame(5);
        expect(after).toHaveBeenCalledWith(5);
        warn.mockRestore();
    });
});

describe('virtual frame clock (#374)', () => {
    it('runs nothing until a step, then one frame at exactly the stepped time', () => {
        const log: string[] = [];
        loop('road', log);
        loop('car', log);
        beginVirtualFrames(1000);
        expect(isVirtualDriven()).toBe(true);
        tickWindow(16);
        expect(log).toEqual([]); // nothing left on the window clock
        expect(stepFrame(1000 / 60)).toBe(2);
        expect(frameNow()).toBe(1000 + 1000 / 60);
        expect(stepFrameTo(1050)).toBe(2);
        expect(log).toEqual([`road@${1000 + 1000 / 60}`, `car@${1000 + 1000 / 60}`, 'road@1050', 'car@1050']);
    });

    it('app time is the virtual time between steps, for code outside the loops', () => {
        beginVirtualFrames(500);
        expect(frameNow()).toBe(500);
        stepFrame(40);
        expect(frameNow()).toBe(540);
    });

    it('only moves forward', () => {
        beginVirtualFrames(100);
        expect(() => stepFrame(0)).toThrow(RangeError);
        expect(() => stepFrameTo(99)).toThrow(RangeError);
        expect(() => stepFrame(Number.NaN)).toThrow(RangeError);
        expect(frameNow()).toBe(100);
    });

    it('needs beginVirtualFrames, once, and not while XR presents', () => {
        expect(() => stepFrame(16)).toThrow(/beginVirtualFrames/);
        beginXrFrames();
        expect(() => beginVirtualFrames(0)).toThrow(/XR/);
        endXrFrames();
        beginVirtualFrames(0);
        expect(() => beginVirtualFrames(0)).toThrow(/already/);
    });

    it('hands loops back to the window with app time continuous across the run', () => {
        const times: number[] = [];
        const frame = (t: number) => {
            times.push(t);
            requestFrame(frame);
        };
        requestFrame(frame);
        vi.spyOn(performance, 'now').mockReturnValue(2000);
        beginVirtualFrames(); // continues from app time
        stepFrame(100);
        stepFrame(100);
        // Real time moved 5 s while the export ran; app time picks up where the
        // last virtual frame left off and runs at real speed from there.
        vi.spyOn(performance, 'now').mockReturnValue(7000);
        endVirtualFrames();
        expect(isVirtualDriven()).toBe(false);
        expect(frameNow()).toBe(2200);
        tickWindow(7016);
        expect(times).toEqual([2100, 2200, 2216]);
    });

    it('an XR session that starts during a run waits for it, then takes the loops', () => {
        const log: string[] = [];
        loop('road', log);
        beginVirtualFrames(0);
        beginXrFrames();
        runXrFrame(5); // the virtual clock wins
        expect(log).toEqual([]);
        stepFrame(10);
        expect(log).toEqual(['road@10']);
        endVirtualFrames();
        tickWindow(20); // not back on the window: the session drives
        expect(log).toEqual(['road@10']);
        runXrFrame(30);
        expect(log).toHaveLength(2);
    });

    it('a window callback that fires after the switch anyway does not run the frame twice', () => {
        vi.stubGlobal('cancelAnimationFrame', () => undefined); // a browser that fires it regardless
        const log: string[] = [];
        loop('road', log);
        beginVirtualFrames(0);
        tickWindow(16);
        expect(log).toEqual([]);
        stepFrame(10);
        expect(log).toEqual(['road@10']);
    });

    it('cancels while virtual', () => {
        const ran = vi.fn();
        beginVirtualFrames(0);
        cancelFrame(requestFrame(ran));
        expect(stepFrame(16)).toBe(0);
        expect(ran).not.toHaveBeenCalled();
    });
});
