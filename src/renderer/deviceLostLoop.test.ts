import { describe, expect, it } from 'vitest';
import { DeviceLossRecovery, DEVICE_LOSS_DEFAULTS } from './deviceLossRecovery';

function clock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('DeviceLossRecovery', () => {
    it('re-inits at most 3 times per incident, with exponential backoff, then gives up', () => {
        const c = clock();
        const r = new DeviceLossRecovery({ now: c.now });
        r.onBootSucceeded();

        expect(r.onDeviceLost()).toEqual({ action: 'reinit', attempt: 1, delayMs: 500 });
        expect(r.isRecovering()).toBe(true);
        expect(r.onReinitFailed()).toEqual({ action: 'reinit', attempt: 2, delayMs: 1000 });
        expect(r.onReinitFailed()).toEqual({ action: 'reinit', attempt: 3, delayMs: 2000 });
        expect(r.onReinitFailed()).toEqual({ action: 'give-up', attempts: 3 });
        expect(r.hasGivenUp()).toBe(true);
        expect(r.isRecovering()).toBe(false);
        // Terminal: nothing restarts it.
        expect(r.onDeviceLost()).toEqual({ action: 'give-up', attempts: 3 });
    });

    it('a device that dies right after every successful re-init still runs out of attempts', () => {
        const c = clock();
        const r = new DeviceLossRecovery({ now: c.now });
        r.onBootSucceeded();
        const decisions = [];
        for (let i = 0; i < 5; i++) {
            c.advance(100);
            decisions.push(r.onDeviceLost().action);
            c.advance(100);
            r.onBootSucceeded();
        }
        expect(decisions).toEqual(['reinit', 'reinit', 'reinit', 'give-up', 'give-up']);
    });

    it('a loss after a long healthy run is a fresh incident with the full budget', () => {
        const c = clock();
        const r = new DeviceLossRecovery({ now: c.now });
        r.onBootSucceeded();
        r.onDeviceLost();
        r.onReinitFailed();
        r.onBootSucceeded();
        c.advance(DEVICE_LOSS_DEFAULTS.stableAfterMs);
        expect(r.onDeviceLost()).toEqual({ action: 'reinit', attempt: 1, delayMs: 500 });
    });

    it('caps the delay', () => {
        const r = new DeviceLossRecovery({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 3000, now: () => 0 });
        const delays = [r.onDeviceLost(), r.onReinitFailed(), r.onReinitFailed(), r.onReinitFailed()]
            .map((d) => (d.action === 'reinit' ? d.delayMs : -1));
        expect(delays).toEqual([1000, 2000, 3000, 3000]);
    });
});
