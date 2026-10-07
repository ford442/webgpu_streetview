import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    dprCapForPixelRatio,
    observeCanvasBox,
    readResizeEntry,
    resolveBackingStoreSize,
} from './canvasBackingStore';

const base = { devicePixelRatio: 1, dprCap: 2, maxTextureDimension: 8192 };

describe('resolveBackingStoreSize', () => {
    it('is CSS size × DPR on HiDPI, not CSS size', () => {
        expect(resolveBackingStoreSize({ ...base, cssWidth: 1280, cssHeight: 720, devicePixelRatio: 2 }))
            .toEqual({ width: 2560, height: 1440, effectiveDpr: 2 });
    });

    it('prefers exact devicePixelContentBoxSize over rounding CSS × DPR', () => {
        const size = resolveBackingStoreSize({
            ...base,
            cssWidth: 1279.5,
            cssHeight: 719.25,
            devicePixelRatio: 1.25,
            devicePixelWidth: 1599,
            devicePixelHeight: 899,
        });
        expect(size).toMatchObject({ width: 1599, height: 899 });
    });

    it('ignores a device-pixel box that disagrees with CSS × DPR (emulated DPR reports the physical one)', () => {
        expect(resolveBackingStoreSize({
            ...base,
            cssWidth: 400,
            cssHeight: 300,
            devicePixelRatio: 2,
            devicePixelWidth: 400,
            devicePixelHeight: 300,
        })).toMatchObject({ width: 800, height: 600 });
    });

    it('caps the DPR at the quality tier', () => {
        expect(resolveBackingStoreSize({ ...base, cssWidth: 1000, cssHeight: 500, devicePixelRatio: 3, dprCap: 2 }))
            .toMatchObject({ width: 2000, height: 1000, effectiveDpr: 2 });
        expect(resolveBackingStoreSize({
            ...base,
            cssWidth: 1000,
            cssHeight: 500,
            devicePixelRatio: 2,
            dprCap: 1,
            devicePixelWidth: 2000,
            devicePixelHeight: 1000,
        })).toMatchObject({ width: 1000, height: 500 });
    });

    it('clamps to the device texture limit, keeping the aspect (2560×1440 @2× under a 4096 device)', () => {
        expect(resolveBackingStoreSize({
            ...base,
            cssWidth: 2560,
            cssHeight: 1440,
            devicePixelRatio: 2,
            maxTextureDimension: 4096,
        })).toEqual({ width: 4096, height: 2304, effectiveDpr: 1.6 });
    });

    it('never renders below CSS size because of a sub-1 preset pixelRatio', () => {
        expect(dprCapForPixelRatio(0.75)).toBe(1);
        expect(dprCapForPixelRatio(2)).toBe(2);
        expect(dprCapForPixelRatio(Number.NaN)).toBe(1);
    });
});

describe('readResizeEntry', () => {
    it('reads content and device-pixel boxes', () => {
        const entry = {
            contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
            devicePixelContentBoxSize: [{ inlineSize: 1600, blockSize: 1200 }],
            contentRect: { width: 0, height: 0 },
        } as unknown as ResizeObserverEntry;
        expect(readResizeEntry(entry)).toEqual({
            cssWidth: 800, cssHeight: 600, devicePixelWidth: 1600, devicePixelHeight: 1200,
        });
    });

    it('falls back to contentRect without box sizes', () => {
        const entry = { contentRect: { width: 320, height: 200 } } as unknown as ResizeObserverEntry;
        expect(readResizeEntry(entry)).toEqual({ cssWidth: 320, cssHeight: 200 });
    });
});

describe('observeCanvasBox', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks for the device-pixel box and falls back to the content box where unsupported', () => {
        const observed: Array<ResizeObserverOptions | undefined> = [];
        let callback!: ResizeObserverCallback;
        class FakeObserver {
            constructor(cb: ResizeObserverCallback) { callback = cb; }
            observe(_el: Element, opts?: ResizeObserverOptions) {
                observed.push(opts);
                if (opts?.box === 'device-pixel-content-box') throw new TypeError('unsupported');
            }
            disconnect = vi.fn();
        }
        vi.stubGlobal('ResizeObserver', FakeObserver);
        const boxes: unknown[] = [];
        const stop = observeCanvasBox(document.createElement('canvas'), (b) => boxes.push(b));
        expect(observed.map((o) => o?.box)).toEqual(['device-pixel-content-box', 'content-box']);
        callback([{ contentBoxSize: [{ inlineSize: 10, blockSize: 20 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
        expect(boxes).toEqual([{ cssWidth: 10, cssHeight: 20 }]);
        stop();
    });

    it('re-reports on a DPR change that leaves the CSS size alone', () => {
        let onChange: (() => void) | undefined;
        vi.stubGlobal('ResizeObserver', class {
            private cb: ResizeObserverCallback;
            constructor(cb: ResizeObserverCallback) { this.cb = cb; }
            observe() {
                this.cb([{
                    contentBoxSize: [{ inlineSize: 100, blockSize: 50 }],
                    devicePixelContentBoxSize: [{ inlineSize: 100, blockSize: 50 }],
                } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
            }
            disconnect() {}
        });
        const matchMedia = vi.fn(() => ({
            addEventListener: (_: string, cb: () => void) => { onChange = cb; },
            removeEventListener: vi.fn(),
        }));
        vi.stubGlobal('matchMedia', matchMedia);
        const boxes: unknown[] = [];
        const stop = observeCanvasBox(document.createElement('canvas'), (b) => boxes.push(b));
        expect(matchMedia).toHaveBeenCalledWith(expect.stringMatching(/^\(resolution: [\d.]+dppx\)$/));
        onChange!();
        // The stale device-pixel size is dropped; the CSS box drives the next resolve.
        expect(boxes.at(-1)).toEqual({ cssWidth: 100, cssHeight: 50 });
        stop();
    });
});
