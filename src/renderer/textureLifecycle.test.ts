/**
 * The live upload path must not read the Maps canvas back every frame.
 *
 * `getCanvasFingerprint` is a `drawImage` + `getImageData` of the Maps WebGL
 * canvas — a GPU→CPU sync point costlier than the `copyExternalImageToTexture`
 * it guards. It runs only while the source is unproven, after a source or size
 * change, and on a 1 Hz cadence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fingerprint = vi.hoisted(() => ({ value: 'ok' as string, calls: 0 }));
vi.mock('../utils/panoramaStability', () => ({
    getCanvasFingerprint: () => {
        fingerprint.calls += 1;
        return fingerprint.value;
    },
}));

import { FINGERPRINT_INTERVAL_MS, TextureLifecycle } from './textureLifecycle';
import { installGpuGlobals } from './computeWeather/__tests__/fakeGpu';

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
        fingerprint.value = 'ok';
        fingerprint.calls = 0;
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fingerprints once, then uploads every frame without reading back', () => {
        const { lifecycle, copies } = setup();
        const source = canvas(1024, 512);
        for (let frame = 0; frame < 60; frame++) {
            now += 16;
            expect(lifecycle.uploadLiveSource(source)).toBe(true);
        }
        expect(copies).toHaveLength(60);
        // 60 frames ≈ 960 ms: one readback, not sixty.
        expect(fingerprint.calls).toBe(1);
    });

    it('re-checks on the 1 Hz cadence, on a new canvas, and on a resize', () => {
        const { lifecycle } = setup();
        const a = canvas(1024, 512);
        lifecycle.uploadLiveSource(a);
        now += FINGERPRINT_INTERVAL_MS;
        lifecycle.uploadLiveSource(a);
        expect(fingerprint.calls).toBe(2);

        const b = canvas(1024, 512);
        lifecycle.uploadLiveSource(b);
        expect(fingerprint.calls).toBe(3);

        b.width = 2048;
        lifecycle.uploadLiveSource(b);
        expect(fingerprint.calls).toBe(4);
    });

    it('keeps checking every frame while the source is not yet stable, and uploads nothing', () => {
        const { lifecycle, copies } = setup();
        const source = canvas(1024, 512);
        fingerprint.value = '';
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        expect(lifecycle.uploadLiveSource(source)).toBe(false);
        expect(fingerprint.calls).toBe(2);
        expect(copies).toHaveLength(0);
        fingerprint.value = 'ok';
        expect(lifecycle.uploadLiveSource(source)).toBe(true);
        expect(copies).toHaveLength(1);
    });

    it('downscales a source above maxTextureDimension2D into the largest texture that fits', () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
            (() => ({ drawImage })) as unknown as HTMLCanvasElement['getContext'],
        );
        const { lifecycle, copies, textures } = setup(4096);
        const source = canvas(5120, 2880);
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
