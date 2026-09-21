/**
 * The cabin's half of the one-frame compositor.
 *
 * The thing worth pinning here is the *fallback*, not the happy path: every way
 * three can refuse to hand over a `GPUTexture` — the WebGL hatch, a build with
 * no `setOutputRenderTarget`, a backend whose internal data map moved — has to
 * put the cabin back on its own canvas rather than leave a blank interior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CabinFrameTarget, readRenderTargetGpuTexture } from './cabinFrameTarget';
import type { CabinRenderer } from './createCabinRenderer';

interface FakeRendererOptions {
    /** Omit to model a three build without the output-target API. */
    withOutputTargetApi?: boolean;
    /** Omit to model a backend that never exposes the GPU texture. */
    exposeTexture?: boolean;
    isWebGPURenderer?: boolean;
    width?: number;
    height?: number;
    /** three derives this from `antialias`; omit to model a renderer without it. */
    samples?: number;
}

function fakeCabinRenderer(options: FakeRendererOptions = {}) {
    const {
        withOutputTargetApi = true,
        exposeTexture = true,
        isWebGPURenderer = true,
        width = 800,
        height = 600,
        samples,
    } = options;

    const outputTargets: Array<THREE.RenderTarget | null> = [];
    const gpuTextures = new Map<unknown, { texture: unknown }>();
    let nextTextureId = 1;

    const renderer = {
        isWebGPURenderer,
        ...(samples === undefined ? {} : { samples }),
        getDrawingBufferSize: (target: THREE.Vector2) => target.set(width, height),
        backend: {
            get: (object: unknown) => {
                if (!exposeTexture) return {};
                let entry = gpuTextures.get(object);
                if (!entry) {
                    entry = { texture: { id: nextTextureId++, createView: () => ({}) } };
                    gpuTextures.set(object, entry);
                }
                return entry;
            },
        },
    } as Record<string, unknown>;

    if (withOutputTargetApi) {
        renderer.setOutputRenderTarget = vi.fn((target: THREE.RenderTarget | null) => {
            outputTargets.push(target);
        });
    }

    return {
        renderer: renderer as unknown as CabinRenderer,
        outputTargets,
        /** Drop every cached GPU texture, as a resize reallocation would. */
        reallocate: () => gpuTextures.clear(),
    };
}

function canvasStub(): HTMLCanvasElement {
    return document.createElement('canvas');
}

describe('CabinFrameTarget.create', () => {
    it('refuses the WebGL cabin with a reason', () => {
        const { renderer } = fakeCabinRenderer({ isWebGPURenderer: false });
        const result = CabinFrameTarget.create(renderer);
        expect(result.target).toBeNull();
        expect(result.reason).toContain('WebGL overlay');
    });

    it('refuses a three build without setOutputRenderTarget', () => {
        const { renderer } = fakeCabinRenderer({ withOutputTargetApi: false });
        const result = CabinFrameTarget.create(renderer);
        expect(result.target).toBeNull();
        expect(result.reason).toContain('setOutputRenderTarget');
    });

    it('adopts the shared-device WebGPU cabin', () => {
        const { renderer } = fakeCabinRenderer();
        const result = CabinFrameTarget.create(renderer);
        expect(result.target).not.toBeNull();
        expect(result.reason).toBeUndefined();
    });
});

describe('CabinFrameTarget frame cycle', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it('redirects the cabin to an offscreen target and hides its canvas', () => {
        const { renderer, outputTargets } = fakeCabinRenderer();
        const canvas = canvasStub();
        const target = CabinFrameTarget.create(renderer, { canvas }).target!;

        target.beginFrame();

        expect(outputTargets).toHaveLength(1);
        expect(outputTargets[0]).toBeInstanceOf(THREE.RenderTarget);
        expect(canvas.style.visibility).toBe('hidden');
    });

    it('sizes the target from the renderer drawing buffer, not the CSS canvas', () => {
        const { renderer, outputTargets } = fakeCabinRenderer({ width: 1280, height: 720 });
        const target = CabinFrameTarget.create(renderer).target!;

        target.beginFrame();

        const rt = outputTargets[0] as THREE.RenderTarget;
        expect(rt.width).toBe(1280);
        expect(rt.height).toBe(720);
    });

    it('keeps sRGB on the target texture so the composited pixel matches the old canvas', () => {
        const { renderer, outputTargets } = fakeCabinRenderer();
        const target = CabinFrameTarget.create(renderer).target!;
        target.beginFrame();
        const rt = outputTargets[0] as THREE.RenderTarget;
        expect(rt.texture.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(rt.texture.format).toBe(THREE.RGBAFormat);
        expect(rt.depthBuffer).toBe(true);
    });

    it('inherits the renderer antialiasing the performance profile chose', () => {
        const { renderer, outputTargets } = fakeCabinRenderer({ samples: 4 });
        CabinFrameTarget.create(renderer).target!.beginFrame();
        expect((outputTargets[0] as THREE.RenderTarget).samples).toBe(4);
    });

    it('stays single-sampled when the renderer reports no antialiasing', () => {
        const noAa = fakeCabinRenderer({ samples: 0 });
        CabinFrameTarget.create(noAa.renderer).target!.beginFrame();
        expect((noAa.outputTargets[0] as THREE.RenderTarget).samples).toBe(0);

        const unknown = fakeCabinRenderer();
        CabinFrameTarget.create(unknown.renderer).target!.beginFrame();
        expect((unknown.outputTargets[0] as THREE.RenderTarget).samples).toBe(0);
    });

    it('lets the caller override the sample count', () => {
        const { renderer, outputTargets } = fakeCabinRenderer({ samples: 4 });
        CabinFrameTarget.create(renderer, { samples: 0 }).target!.beginFrame();
        expect((outputTargets[0] as THREE.RenderTarget).samples).toBe(0);
    });

    it('reuses one target across frames and resizes it in place', () => {
        const fake = fakeCabinRenderer({ width: 800, height: 600 });
        const target = CabinFrameTarget.create(fake.renderer).target!;

        target.beginFrame();
        const first = fake.outputTargets[0] as THREE.RenderTarget;

        target.beginFrame();
        expect(fake.outputTargets[1]).toBe(first);

        (fake.renderer as unknown as {
            getDrawingBufferSize: (v: THREE.Vector2) => THREE.Vector2;
        }).getDrawingBufferSize = (v) => v.set(1024, 768);
        target.beginFrame();
        expect(fake.outputTargets[2]).toBe(first);
        expect(first.width).toBe(1024);
        expect(first.height).toBe(768);
    });

    it('hands over the GPU texture once the cabin has drawn', () => {
        const { renderer } = fakeCabinRenderer();
        const target = CabinFrameTarget.create(renderer).target!;
        expect(target.getTexture()).toBeNull();

        target.beginFrame();
        target.endFrame();

        expect(target.getTexture()).not.toBeNull();
        expect(target.isActive()).toBe(true);
        expect(target.getFailureReason()).toBeUndefined();
    });

    it('reports the reallocated texture after a resize rather than a stale one', () => {
        const fake = fakeCabinRenderer();
        const target = CabinFrameTarget.create(fake.renderer).target!;
        target.beginFrame();
        const before = target.getTexture();

        fake.reallocate();
        const after = target.getTexture();

        expect(after).not.toBeNull();
        expect(after).not.toBe(before);
    });

    it('falls back to the CSS overlay when the backend never exposes a texture', () => {
        const { renderer, outputTargets } = fakeCabinRenderer({ exposeTexture: false });
        const canvas = canvasStub();
        const onUnavailable = vi.fn();
        const target = CabinFrameTarget.create(renderer, { canvas, onUnavailable }).target!;

        target.beginFrame();
        expect(canvas.style.visibility).toBe('hidden');
        target.endFrame();

        expect(target.isActive()).toBe(false);
        expect(target.getTexture()).toBeNull();
        expect(target.getFailureReason()).toContain('GPUTexture');
        expect(onUnavailable).toHaveBeenCalledTimes(1);
        // Cabin handed back to its own canvas, which is visible again.
        expect(outputTargets.at(-1)).toBeNull();
        expect(canvas.style.visibility).toBe('visible');
    });

    it('does not re-attach or re-report after the fallback latched', () => {
        const { renderer, outputTargets } = fakeCabinRenderer({ exposeTexture: false });
        const onUnavailable = vi.fn();
        const target = CabinFrameTarget.create(renderer, { onUnavailable }).target!;

        target.beginFrame();
        target.endFrame();
        const attachCount = outputTargets.length;

        target.beginFrame();
        target.endFrame();

        expect(outputTargets).toHaveLength(attachCount);
        expect(onUnavailable).toHaveBeenCalledTimes(1);
    });

    it('releases the target and restores the canvas on dispose', () => {
        const { renderer, outputTargets } = fakeCabinRenderer();
        const canvas = canvasStub();
        const target = CabinFrameTarget.create(renderer, { canvas }).target!;
        target.beginFrame();
        const rt = outputTargets[0] as THREE.RenderTarget;
        const disposeSpy = vi.spyOn(rt, 'dispose');

        target.dispose();

        expect(disposeSpy).toHaveBeenCalled();
        expect(outputTargets.at(-1)).toBeNull();
        expect(canvas.style.visibility).toBe('visible');
        expect(target.getTexture()).toBeNull();
        expect(target.isActive()).toBe(false);
    });

    it('survives a renderer that throws while being detached', () => {
        const { renderer } = fakeCabinRenderer();
        (renderer as unknown as { setOutputRenderTarget: () => void }).setOutputRenderTarget = () => {
            throw new Error('renderer already disposed');
        };
        const target = CabinFrameTarget.create(renderer).target!;
        expect(() => target.dispose()).not.toThrow();
    });
});

describe('readRenderTargetGpuTexture', () => {
    const target = new THREE.RenderTarget(4, 4);

    it('returns null for a renderer with no backend data map', () => {
        expect(readRenderTargetGpuTexture({} as CabinRenderer, target)).toBeNull();
        expect(
            readRenderTargetGpuTexture({ backend: {} } as unknown as CabinRenderer, target),
        ).toBeNull();
    });

    it('returns null when the backend throws or holds no texture', () => {
        const throwing = {
            backend: {
                get: () => {
                    throw new Error('moved internal');
                },
            },
        } as unknown as CabinRenderer;
        expect(readRenderTargetGpuTexture(throwing, target)).toBeNull();

        const empty = { backend: { get: () => ({}) } } as unknown as CabinRenderer;
        expect(readRenderTargetGpuTexture(empty, target)).toBeNull();
    });

    it('rejects a value that is not texture-shaped', () => {
        const bogus = {
            backend: { get: () => ({ texture: 'not-a-texture' }) },
        } as unknown as CabinRenderer;
        expect(readRenderTargetGpuTexture(bogus, target)).toBeNull();
    });
});
