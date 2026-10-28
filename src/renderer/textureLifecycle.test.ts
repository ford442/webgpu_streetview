// @vitest-environment jsdom
/**
 * The live upload path must not read the Maps canvas back on the frame path.
 *
 * The upload guard asks the shared Maps canvas source (`frameSource/
 * mapsCanvasSource.ts`), which answers from its last sample and only starts a
 * background readback for an unknown, resized or stale canvas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fingerprint = vi.hoisted(() => ({ value: 'ok' as string, calls: 0 }));
vi.mock('./frameSource/canvasFingerprint', () => ({
    readCanvasFingerprint: (c: HTMLCanvasElement) => {
        fingerprint.calls += 1;
        return Promise.resolve(fingerprint.value ? `${c.width}x${c.height}-${fingerprint.value}` : '');
    },
}));

import { TextureLifecycle } from './textureLifecycle';
import { mapsCanvasSource, UPLOAD_VERDICT_MAX_AGE_MS } from './frameSource/mapsCanvasSource';
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(maxTextureDimension2D = 8192) {
    const copies: Array<{ source: unknown; size: number[] }> = [];
    const textures: Array<{ size: number[] }> = [];
    const device = {
        limits: { maxTextureDimension2D },
        createTexture: (d: GPUTextureDescriptor) => {
            const t = { size: d.size as number[], destroy: vi.fn(), createView: () => ({}) };
            textures.push(t);
            return t;
        },
        createBindGroup: () => ({}),
        queue: {
            copyExternalImageToTexture: (src: { source: unknown }, _dst: unknown, size: number[]) => {
                copies.push({ source: src.source, size });
            },
        },
    } as unknown as GPUDevice;
    const lifecycle = new TextureLifecycle({
        getDevice: () => device,
        getPipeline: () => undefined,
        getSampler: () => undefined,
        getUniformBuffer: () => undefined,
        getTransitionPreviousFrame: () => undefined,
        isHoldActive: () => false,
        getWeatherPostProcessor: () => undefined,
    });
    return { lifecycle, copies, textures };
}

function canvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

describe('TextureLifecycle live uploads', () => {
    let now = 0;
    beforeEach(() => {
        installGpuGlobals();
        mapsCanvasSource.reset();
        fingerprint.value = 'ok';
        fingerprint.calls = 0;
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('waits for one background sample, then uploads every frame without reading back', async () => {
        const { lifecycle, copies } = setup();
        const source = canvas(1024, 512);
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        await flush();
        for (let frame = 0; frame < 60; frame++) {
            now += 16;
            expect(lifecycle.uploadLiveSource(source)).toBe(true);
        }
        expect(copies).toHaveLength(60);
        // 60 frames ≈ 960 ms: one readback, not sixty.
        expect(fingerprint.calls).toBe(1);
    });

    it('re-samples a stale verdict, a new canvas, and a resize — in the background', async () => {
        const { lifecycle } = setup();
        const a = canvas(1024, 512);
        lifecycle.uploadLiveSource(a);
        await flush();
        now += UPLOAD_VERDICT_MAX_AGE_MS + 1;
        // The stale verdict still answers this frame; a refresh starts behind it.
        expect(lifecycle.uploadLiveSource(a)).toBe(true);
        expect(fingerprint.calls).toBe(2);
        await flush();

        const b = canvas(1024, 512);
        lifecycle.uploadLiveSource(b);
        expect(fingerprint.calls).toBe(3);
        await flush();

        b.width = 2048;
        lifecycle.uploadLiveSource(b);
        expect(fingerprint.calls).toBe(4);
    });

    it('shares a sample another watcher (scan, hold gate) already took', async () => {
        const { lifecycle } = setup();
        const source = canvas(1024, 512);
        await mapsCanvasSource.fingerprint(source);
        expect(lifecycle.uploadLiveSource(source)).toBe(true);
        expect(fingerprint.calls).toBe(1);
    });

    it('uploads nothing while the source shows no imagery, and one readback is in flight at a time', async () => {
        const { lifecycle, copies } = setup();
        const source = canvas(1024, 512);
        fingerprint.value = '';
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        expect(fingerprint.calls).toBe(1);
        await flush();
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        expect(copies).toHaveLength(0);
        fingerprint.value = 'ok';
        now += UPLOAD_VERDICT_MAX_AGE_MS + 1;
        lifecycle.uploadLiveSource(source);
        await flush();
        expect(lifecycle.uploadLiveSource(source)).toBe(true);
        expect(copies).toHaveLength(1);
    });

    it('downscales a source above maxTextureDimension2D into the largest texture that fits', async () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
            (() => ({ drawImage })) as unknown as HTMLCanvasElement['getContext'],
        );
        const { lifecycle, copies, textures } = setup(4096);
        const source = canvas(5120, 2880);
        await mapsCanvasSource.fingerprint(source);
        expect(lifecycle.uploadLiveSource(source)).toBe(true);
        expect(textures.at(-1)!.size).toEqual([4096, 2304]);
        expect(copies[0]!.size).toEqual([4096, 2304]);
        expect(copies[0]!.source).not.toBe(source);
        expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 4096, 2304);
    });

    it('clamps the HDR intermediate to the device limit', () => {
        const { lifecycle, textures } = setup(4096);
        lifecycle.ensureIntermediateTexture(5120, 2880);
        expect(textures.at(-1)!.size).toEqual([4096, 2304]);
        expect([lifecycle.intermediateWidth, lifecycle.intermediateHeight]).toEqual([4096, 2304]);
        // Same request: no reallocation.
        lifecycle.ensureIntermediateTexture(5120, 2880);
        expect(textures).toHaveLength(1);
    });
});
