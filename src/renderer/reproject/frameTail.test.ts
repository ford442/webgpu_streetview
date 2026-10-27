import { describe, expect, it, vi } from 'vitest';
import { createFrameTailScheduler } from './frameTail';

describe('frame tail scheduler', () => {
    it('runs the tail at once when there is no producer (free look)', () => {
        const s = createFrameTailScheduler();
        const tail = vi.fn();
        s.submit(16, tail);
        expect(tail).toHaveBeenCalledTimes(1);
        s.submit(33, tail);
        expect(tail).toHaveBeenCalledTimes(2);
        expect(s.stats()).toEqual({ ran: 2, deferred: 0, dropped: 0 });
    });

    it('waits for the car loop of the same frame once it is running', () => {
        const s = createFrameTailScheduler();
        const order: string[] = [];
        // Frame 1: the producer has never run — the road presents at once.
        s.submit(1, () => order.push('tail1'));
        s.producerDone(1);
        // Frame 2: road first, car loop second — the tail waits for the car.
        s.submit(2, () => order.push('tail2'));
        order.push('car2');
        s.producerDone(2);
        expect(order).toEqual(['tail1', 'car2', 'tail2']);
        expect(s.stats().deferred).toBe(1);
    });

    it('runs at once when the producer already finished this frame (rAF order flipped)', () => {
        const s = createFrameTailScheduler();
        s.submit(1, () => {});
        s.producerDone(1);
        s.producerDone(2);
        const tail = vi.fn();
        s.submit(2, tail);
        expect(tail).toHaveBeenCalledTimes(1);
    });

    it('drops one frame when the producer stops, then stops waiting for it', () => {
        const s = createFrameTailScheduler();
        s.submit(1, () => {});
        s.producerDone(1);
        const lost = vi.fn();
        s.submit(2, lost); // deferred; the car loop has quit
        const next = vi.fn();
        s.submit(3, next);
        expect(lost).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(s.stats().dropped).toBe(1);
        const after = vi.fn();
        s.submit(4, after);
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('never runs a tail in a later frame than its own', () => {
        const s = createFrameTailScheduler();
        s.submit(1, () => {});
        s.producerDone(1);
        const stale = vi.fn();
        s.submit(2, stale);
        s.producerDone(3);
        expect(stale).not.toHaveBeenCalled();
        expect(s.stats().dropped).toBe(1);
    });

    it('a throwing tail is reported and does not wedge the scheduler', () => {
        const s = createFrameTailScheduler();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        s.submit(1, () => { throw new Error('boom'); });
        const tail = vi.fn();
        s.submit(2, tail);
        expect(tail).toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('reset forgets a pending tail and the producer', () => {
        const s = createFrameTailScheduler();
        s.submit(1, () => {});
        s.producerDone(1);
        const pending = vi.fn();
        s.submit(2, pending);
        s.reset();
        s.producerDone(2);
        expect(pending).not.toHaveBeenCalled();
        const fresh = vi.fn();
        s.submit(3, fresh);
        expect(fresh).toHaveBeenCalled();
    });

    it('flush runs a deferred tail before a WebXR frame ends, once', () => {
        const s = createFrameTailScheduler();
        s.submit(1, () => {});
        s.producerDone(1);
        const tail = vi.fn();
        s.submit(2, tail);
        expect(tail).not.toHaveBeenCalled();
        s.flush();
        expect(tail).toHaveBeenCalledTimes(1);
        s.producerDone(2);
        s.flush();
        expect(tail).toHaveBeenCalledTimes(1);
    });
});
