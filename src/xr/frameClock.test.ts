import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginXrFrames, cancelFrame, endXrFrames, requestFrame, resetFrameClockForTests, runXrFrame } from './frameClock';

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
