import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CabinRenderer } from './createCabinRenderer';

/**
 * `THREE.PMREMGenerator` only drives a WebGLRenderer; `three/webgpu` ships a
 * separate class with the same call shape. These pin that the right one is
 * picked per backend, and that the WebGPU class is only ever reached through
 * the lazy chunk the renderer itself came from.
 */

const webglGenerators: Array<Record<string, unknown>> = [];
const webgpuGenerators: Array<Record<string, unknown>> = [];

function fakeTarget(label: string) {
    return { texture: { label }, dispose: vi.fn() };
}

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three')>();
    return {
        ...actual,
        PMREMGenerator: vi.fn().mockImplementation((renderer: unknown) => {
            const instance = {
                renderer,
                fromScene: vi.fn(() => fakeTarget('webgl-scene')),
                fromEquirectangular: vi.fn(() => fakeTarget('webgl-equirect')),
                dispose: vi.fn(),
            };
            webglGenerators.push(instance);
            return instance;
        }),
    };
});

vi.mock('three/webgpu', () => ({
    WebGPURenderer: vi.fn(),
    PMREMGenerator: vi.fn().mockImplementation((renderer: unknown) => {
        const instance = {
            renderer,
            fromSceneAsync: vi.fn(async () => fakeTarget('webgpu-scene')),
            fromEquirectangular: vi.fn(() => fakeTarget('webgpu-equirect')),
            dispose: vi.fn(),
        };
        webgpuGenerators.push(instance);
        return instance;
    }),
}));

import * as THREE from 'three';
import { createCabinPmrem } from './cabinPmrem';
import { preloadWebGPUCabinRenderer } from './createCabinRenderer';

const webglRenderer = { isWebGLRenderer: true } as unknown as CabinRenderer;
const webgpuRenderer = { isWebGPURenderer: true } as unknown as CabinRenderer;

describe('createCabinPmrem', () => {
    beforeEach(() => {
        webglGenerators.length = 0;
        webgpuGenerators.length = 0;
        vi.clearAllMocks();
    });

    it('uses the classic generator for a WebGL cabin', async () => {
        const pmrem = createCabinPmrem(webglRenderer);
        expect(pmrem).not.toBeNull();
        expect(THREE.PMREMGenerator).toHaveBeenCalledWith(webglRenderer);
        expect(webgpuGenerators).toHaveLength(0);

        const target = await pmrem!.fromSceneAsync(new THREE.Scene());
        expect(target.texture).toEqual({ label: 'webgl-scene' });
        expect(webglGenerators[0]?.fromScene).toHaveBeenCalled();
    });

    it('passes blur and clip-plane arguments straight through on WebGL', async () => {
        const pmrem = createCabinPmrem(webglRenderer);
        const scene = new THREE.Scene();
        await pmrem!.fromSceneAsync(scene, 0.5, 0.2, 50);
        expect(webglGenerators[0]?.fromScene).toHaveBeenCalledWith(scene, 0.5, 0.2, 50);
    });

    it('uses the three/webgpu generator for a WebGPU cabin once the chunk is loaded', async () => {
        await preloadWebGPUCabinRenderer();
        const pmrem = createCabinPmrem(webgpuRenderer);
        expect(pmrem).not.toBeNull();
        expect(webgpuGenerators).toHaveLength(1);
        expect(THREE.PMREMGenerator).not.toHaveBeenCalled();

        const target = await pmrem!.fromSceneAsync(new THREE.Scene());
        expect(target.texture).toEqual({ label: 'webgpu-scene' });
    });

    it('reaches fromEquirectangular on the WebGPU generator despite the @types gap', async () => {
        await preloadWebGPUCabinRenderer();
        const pmrem = createCabinPmrem(webgpuRenderer);
        const texture = new THREE.Texture();
        const target = pmrem!.fromEquirectangular(texture);
        expect(webgpuGenerators[0]?.fromEquirectangular).toHaveBeenCalledWith(texture);
        expect(target.texture).toEqual({ label: 'webgpu-equirect' });
    });

    it('never constructs the WebGPU generator for a WebGL cabin', () => {
        createCabinPmrem(webglRenderer);
        expect(webgpuGenerators).toHaveLength(0);
    });
});
