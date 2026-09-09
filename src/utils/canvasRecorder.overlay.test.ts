import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { blitFrameWithAttribution, CanvasClipRecorder } from './canvasRecorder';

/**
 * Cinema composite: the cabin canvas has to land in the recorded clip while
 * car mode is on, and the clip must stay road-only (never blank, never frozen)
 * when it does not. jsdom has no real 2D backend, so these drive a recording
 * stub context and assert on draw order and latch bookkeeping.
 */

interface DrawCall {
    op: string;
    args: unknown[];
}

// Captured up front: the latch tests replace `document.createElement`, and the
// replacement builds its canvases through this helper.
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
    (canvas as HTMLCanvasElement & { captureStream: () => MediaStream }).captureStream = () =>
        ({}) as MediaStream;
    return canvas;
}

/** The stub 2D context installed by `makeStubCanvas`. */
function stubCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

function drawn(log: DrawCall[], index: number): unknown {
    return log[index]?.args[0];
}

describe('blitFrameWithAttribution — cabin overlay', () => {
    it('draws the road, then the cabin over it, then the attribution footer', () => {
        const log: DrawCall[] = [];
        const source = makeStubCanvas(320, 200);
        const overlay = makeStubCanvas(320, 200);
        const composite = stubCtx(makeStubCanvas(320, 200, log));

        blitFrameWithAttribution(source, composite, true, overlay);

        const ops = log.map((c) => c.op);
        expect(ops).toEqual(['drawImage', 'drawImage', 'fillRect', 'fillText']);
        expect(drawn(log, 0)).toBe(source);
        expect(drawn(log, 1)).toBe(overlay);
    });

    it('stays road-only when no overlay is supplied', () => {
        const log: DrawCall[] = [];
        const source = makeStubCanvas(320, 200);
        const composite = stubCtx(makeStubCanvas(320, 200, log));

        blitFrameWithAttribution(source, composite, true, null);

        expect(log.filter((c) => c.op === 'drawImage')).toHaveLength(1);
    });

    it('skips a zero-sized overlay rather than throwing', () => {
        const log: DrawCall[] = [];
        const source = makeStubCanvas(320, 200);
        const composite = stubCtx(makeStubCanvas(320, 200, log));

        blitFrameWithAttribution(source, composite, false, makeStubCanvas(0, 0));

        expect(log.map((c) => c.op)).toEqual(['drawImage']);
    });
});

describe('CanvasClipRecorder — cabin latch', () => {
    const originalMediaRecorder = globalThis.MediaRecorder;
    const originalRaf = globalThis.requestAnimationFrame;

    beforeEach(() => {
        class StubMediaRecorder {
            static isTypeSupported = () => true;
            ondataavailable: unknown = null;
            onstop: unknown = null;
            onerror: unknown = null;
            start() {}
            stop() {}
        }
        globalThis.MediaRecorder = StubMediaRecorder as unknown as typeof MediaRecorder;
        // Never actually schedule: the composite tick is not under test here.
        globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
    });

    afterEach(() => {
        globalThis.MediaRecorder = originalMediaRecorder;
        globalThis.requestAnimationFrame = originalRaf;
        vi.restoreAllMocks();
    });

    it('copies the cabin into its own latch only when the cabin says it rendered', () => {
        const log: DrawCall[] = [];
        const source = makeStubCanvas(320, 200);
        const cabin = makeStubCanvas(320, 200);
        // The recorder builds both the composite and the latch from the source.
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas'
                ? makeStubCanvas(320, 200, log)
                : Object.create(HTMLElement.prototype)) as typeof document.createElement);

        let notify: (() => void) | null = null;
        const unsubscribe = vi.fn();
        const recorder = new CanvasClipRecorder(source, {
            burnAttribution: false,
            overlay: {
                getCanvas: () => cabin,
                subscribe: (onRendered) => {
                    notify = onRendered;
                    return unsubscribe;
                },
            },
        });

        recorder.start();
        expect(notify).not.toBeNull();

        log.length = 0;
        notify!();

        // clearRect first so a stale cabin frame can never linger, then the copy.
        expect(log.map((c) => c.op)).toEqual(['clearRect', 'drawImage']);
        expect(drawn(log, 1)).toBe(cabin);

        recorder.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('leaves the latch transparent when the cabin never renders', () => {
        const log: DrawCall[] = [];
        const source = makeStubCanvas(320, 200);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
            tag === 'canvas'
                ? makeStubCanvas(320, 200, log)
                : Object.create(HTMLElement.prototype)) as typeof document.createElement);

        const getCanvas = vi.fn(() => null);
        const recorder = new CanvasClipRecorder(source, {
            burnAttribution: false,
            overlay: { getCanvas, subscribe: () => () => {} },
        });
        recorder.start();

        // The priming composite blits the road and the (still transparent)
        // latch. The cabin itself is never read outside a render notification.
        expect(drawn(log, 0)).toBe(source);
        expect(log.some((c) => c.op === 'clearRect')).toBe(false);
        expect(getCanvas).not.toHaveBeenCalled();
        recorder.dispose();
    });
});
