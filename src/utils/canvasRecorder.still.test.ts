import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCompositedStill, type ClipOverlaySource } from './canvasRecorder';

/**
 * jsdom has no 2D backend. Drive stub contexts the same way
 * `canvasRecorder.overlay.test.ts` does and assert latch bookkeeping.
 */

interface DrawCall {
    op: string;
    args: unknown[];
}

const createRealElement = document.createElement.bind(document);

function makeStubCanvas(width: number, height: number, log?: DrawCall[]): HTMLCanvasElement {
    const canvas = createRealElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = {
        canvas,
        drawImage: (...args: unknown[]) => log?.push({ op: 'drawImage', args }),
        clearRect: (...args: unknown[]) => log?.push({ op: 'clearRect', args }),
        fillRect: (...args: unknown[]) => log?.push({ op: 'fillRect', args }),
        fillText: (...args: unknown[]) => log?.push({ op: 'fillText', args }),
        fillStyle: '',
        font: '',
        textBaseline: '',
    };
    vi.spyOn(canvas, 'getContext' as never).mockReturnValue(ctx as never);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    return canvas;
}

describe('captureCompositedStill', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('times out to road-only when the cabin overlay never renders', async () => {
        const log: DrawCall[] = [];
        const road = makeStubCanvas(8, 8);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas'
                ? makeStubCanvas(8, 8, log)
                : Object.create(HTMLElement.prototype)) as typeof document.createElement);

        const overlay: ClipOverlaySource = {
            getCanvas: () => null,
            subscribe: () => () => {},
        };
        const still = await captureCompositedStill(road, overlay, { timeoutMs: 20 });
        expect(still.includedCabin).toBe(false);
        expect(still.dataUrl.startsWith('data:image/png')).toBe(true);
        expect(log.some((c) => c.op === 'drawImage' && c.args[0] === road)).toBe(true);
    });

    it('latches the cabin on the first post-render tap', async () => {
        const log: DrawCall[] = [];
        const road = makeStubCanvas(8, 8);
        const cabin = makeStubCanvas(8, 8);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas'
                ? makeStubCanvas(8, 8, log)
                : Object.create(HTMLElement.prototype)) as typeof document.createElement);

        const held: { tap?: () => void } = {};
        const overlay: ClipOverlaySource = {
            getCanvas: () => cabin,
            subscribe: (fn: () => void) => {
                held.tap = fn;
                return () => {
                    held.tap = undefined;
                };
            },
        };

        const pending = captureCompositedStill(road, overlay, { timeoutMs: 200 });
        if (!held.tap) throw new Error('overlay did not subscribe');
        held.tap();
        const still = await pending;
        expect(still.includedCabin).toBe(true);
        expect(still.canvas.width).toBe(8);
        expect(still.canvas.height).toBe(8);
        expect(log.some((c) => c.op === 'drawImage' && c.args[0] === cabin)).toBe(true);
    });

    it('skips the overlay wait when no overlay is supplied', async () => {
        const log: DrawCall[] = [];
        const road = makeStubCanvas(4, 4);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas'
                ? makeStubCanvas(4, 4, log)
                : Object.create(HTMLElement.prototype)) as typeof document.createElement);

        const still = await captureCompositedStill(road, null, { timeoutMs: 5 });
        expect(still.includedCabin).toBe(false);
        expect(log.filter((c) => c.op === 'drawImage')).toHaveLength(1);
        expect(log[0]?.args[0]).toBe(road);
    });
});
