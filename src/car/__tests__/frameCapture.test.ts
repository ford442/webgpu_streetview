import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getCabinCanvas,
    onCabinFrameRendered,
    notifyCabinFrameRendered,
} from '../runtime/frameCapture';
import { setState } from '../runtime/state';
import type { CarModeState } from '../runtime/state';

/**
 * The tap exists so cinema can read the cabin's drawing buffer in the one
 * frame it is valid (see runtime/frameCapture.ts). Everything here is about
 * that contract, not about geometry.
 */

function fakeState(overrides: Partial<CarModeState> = {}): CarModeState {
    const canvas = document.createElement('canvas');
    return {
        interior: { canvas } as CarModeState['interior'],
        isActive: true,
        ...overrides,
    } as CarModeState;
}

describe('cabin frame capture tap', () => {
    beforeEach(() => {
        setState(null);
        onCabinFrameRendered(() => {})();
    });

    afterEach(() => {
        setState(null);
        vi.restoreAllMocks();
    });

    it('has no cabin canvas when car mode is not running', () => {
        expect(getCabinCanvas()).toBeNull();
    });

    it('has no cabin canvas while car mode is loaded but inactive', () => {
        setState(fakeState({ isActive: false }));
        expect(getCabinCanvas()).toBeNull();
    });

    it('exposes the cabin canvas while car mode is active', () => {
        const state = fakeState();
        setState(state);
        expect(getCabinCanvas()).toBe(state.interior.canvas);
    });

    it('notifies the current listener and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = onCabinFrameRendered(listener);

        notifyCabinFrameRendered();
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        notifyCabinFrameRendered();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps only the newest listener, and an old unsubscribe cannot drop it', () => {
        const first = vi.fn();
        const second = vi.fn();
        const dropFirst = onCabinFrameRendered(first);
        onCabinFrameRendered(second);

        dropFirst();
        notifyCabinFrameRendered();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('drops a throwing listener instead of breaking the car render loop', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const listener = vi.fn(() => {
            throw new Error('boom');
        });
        onCabinFrameRendered(listener);

        expect(() => notifyCabinFrameRendered()).not.toThrow();
        notifyCabinFrameRendered();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
