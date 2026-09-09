import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { optimizeTextures, applyPerformanceProfile, type GPUPerformanceProfile } from './performance';

/**
 * #258: these run on both cabin backends. The WebGL path must stay byte-for-byte
 * identical in effect — `THREE.Texture.DEFAULT_ANISOTROPY` is the only thing
 * either function actually changes, so it is what gets pinned.
 *
 * Backend is passed explicitly rather than sniffed: `WebGLRenderer` also has a
 * deprecated top-level `getMaxAnisotropy()`, and the WebGPU `Renderer` has its
 * own `getContext(): void`, so neither discriminates.
 */

const originalAnisotropy = THREE.Texture.DEFAULT_ANISOTROPY;

function fakeWebGLRenderer(maxAnisotropy: number, extensions: string[] = []) {
    return {
        isWebGLRenderer: true,
        capabilities: {
            getMaxAnisotropy: vi.fn(() => maxAnisotropy),
            maxTextures: 16,
        },
        getContext: vi.fn(() => ({
            getExtension: vi.fn((name: string) => (extensions.includes(name) ? {} : null)),
        })),
        setPixelRatio: vi.fn(),
        // Deliberately present: the deprecated forwarder that makes duck-typing
        // on `getMaxAnisotropy` the wrong discriminator.
        getMaxAnisotropy: vi.fn(() => 999),
    };
}

function fakeWebGPURenderer(maxAnisotropy = 16) {
    return {
        isWebGPURenderer: true,
        getMaxAnisotropy: vi.fn(() => maxAnisotropy),
        // Present but unrelated — returns void, not a GL context.
        getContext: vi.fn(() => undefined),
        setPixelRatio: vi.fn(),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRenderer = (r: unknown) => r as any;

describe('optimizeTextures across cabin backends', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        THREE.Texture.DEFAULT_ANISOTROPY = originalAnisotropy;
        vi.restoreAllMocks();
    });

    it('reads anisotropy from capabilities on WebGL, not the deprecated forwarder', () => {
        const renderer = fakeWebGLRenderer(8);
        const result = optimizeTextures(asRenderer(renderer), 'webgl', { anisotropy: 4 });

        expect(renderer.capabilities.getMaxAnisotropy).toHaveBeenCalled();
        expect(renderer.getMaxAnisotropy).not.toHaveBeenCalled();
        expect(result.anisotropy).toBe(4);
        expect(THREE.Texture.DEFAULT_ANISOTROPY).toBe(4);
    });

    it('clamps the requested anisotropy to what the WebGL device allows', () => {
        const renderer = fakeWebGLRenderer(2);
        const result = optimizeTextures(asRenderer(renderer), 'webgl', { anisotropy: 4 });

        expect(result.anisotropy).toBe(2);
        expect(THREE.Texture.DEFAULT_ANISOTROPY).toBe(2);
    });

    it('still probes compressed-texture extensions on WebGL', () => {
        const renderer = fakeWebGLRenderer(4, ['WEBGL_compressed_texture_s3tc']);
        optimizeTextures(asRenderer(renderer), 'webgl', { anisotropy: 4 });

        expect(renderer.getContext).toHaveBeenCalled();
    });

    it('reaches the same DEFAULT_ANISOTROPY on WebGPU as on a 16x WebGL device', () => {
        const webgl = fakeWebGLRenderer(16);
        optimizeTextures(asRenderer(webgl), 'webgl', { anisotropy: 4 });
        const webglAnisotropy = THREE.Texture.DEFAULT_ANISOTROPY;

        THREE.Texture.DEFAULT_ANISOTROPY = originalAnisotropy;

        const webgpu = fakeWebGPURenderer();
        const result = optimizeTextures(asRenderer(webgpu), 'webgpu', { anisotropy: 4 });

        expect(webgpu.getMaxAnisotropy).toHaveBeenCalled();
        expect(THREE.Texture.DEFAULT_ANISOTROPY).toBe(webglAnisotropy);
        expect(result.anisotropy).toBe(4);
    });

    it('never touches the raw context on WebGPU', () => {
        const renderer = fakeWebGPURenderer();
        optimizeTextures(asRenderer(renderer), 'webgpu', { anisotropy: 4 });

        expect(renderer.getContext).not.toHaveBeenCalled();
    });

    it('applies the pixel ratio on either backend', () => {
        const profile = { name: 'high', pixelRatio: 2 } as GPUPerformanceProfile;

        const webgl = fakeWebGLRenderer(16);
        applyPerformanceProfile(asRenderer(webgl), profile);
        expect(webgl.setPixelRatio).toHaveBeenCalledWith(2);

        const webgpu = fakeWebGPURenderer();
        applyPerformanceProfile(asRenderer(webgpu), profile);
        expect(webgpu.setPixelRatio).toHaveBeenCalledWith(2);
    });
});
