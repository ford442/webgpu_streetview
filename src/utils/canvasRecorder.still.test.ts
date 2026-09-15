import { describe, expect, it, vi } from 'vitest';
import { captureCompositedStill, type ClipOverlaySource } from './canvasRecorder';

function fillCanvas(width: number, height: number, color: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas;
}

describe('captureCompositedStill', () => {
    it('times out to road-only when the cabin overlay never renders', async () => {
        const road = fillCanvas(8, 8, '#ff0000');
        const overlay: ClipOverlaySource = {
            getCanvas: () => null,
            subscribe: () => () => {},
        };
        const still = await captureCompositedStill(road, overlay, { timeoutMs: 20 });
        expect(still.includedCabin).toBe(false);
        expect(still.dataUrl.startsWith('data:image/png')).toBe(true);
    });

    it('latches the cabin on the first post-render tap', async () => {
        const road = fillCanvas(8, 8, '#0000ff');
        const cabin = fillCanvas(8, 8, '#00ff00');
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
    });

    it('skips the overlay wait when no overlay is supplied', async () => {
        const spy = vi.fn();
        const road = fillCanvas(4, 4, '#ffffff');
        const still = await captureCompositedStill(road, null, { timeoutMs: 5 });
        expect(still.includedCabin).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });
});
