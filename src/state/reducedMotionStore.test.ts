// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReducedMotion, resetReducedMotionForTests, setAppReducedMotion } from './reducedMotionStore';

function stubMatchMedia(matches: boolean) {
    let onChange: ((e: { matches: boolean }) => void) | null = null;
    vi.stubGlobal('matchMedia', () => ({
        matches,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
            onChange = cb;
        },
    }));
    return (next: boolean) => onChange?.({ matches: next });
}

afterEach(() => {
    vi.unstubAllGlobals();
    resetReducedMotionForTests();
});

describe('reducedMotionStore', () => {
    it('follows the OS query live, through its change listener', () => {
        const change = stubMatchMedia(false);
        expect(isReducedMotion()).toBe(false);
        change(true);
        expect(isReducedMotion()).toBe(true);
        change(false);
        expect(isReducedMotion()).toBe(false);
    });

    it('is on when the app setting is, whatever the OS says', () => {
        stubMatchMedia(false);
        setAppReducedMotion(true);
        expect(isReducedMotion()).toBe(true);
        setAppReducedMotion(false);
        expect(isReducedMotion()).toBe(false);
    });

    it('never reads the body class', () => {
        stubMatchMedia(false);
        const contains = vi.spyOn(DOMTokenList.prototype, 'contains');
        for (let i = 0; i < 10; i++) isReducedMotion();
        expect(contains).not.toHaveBeenCalled();
    });
});
