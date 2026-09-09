import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { VEHICLES } from '../VehicleManager';
import type { CabinRenderer } from './createCabinRenderer';
import type { CabinEnvTarget } from './cabinPmrem';

/**
 * The studio-cube IBL is a fallback that `PanoEnvironment` is documented to
 * take ownership of on the first pano hop. On WebGPU the fallback install is
 * asynchronous (the generator has to wait for `renderer.init()`), so it can now
 * finish *after* the real pano environment has landed. These pin that it never
 * stomps the winner, and never leaks the target it built.
 */

let resolveScene: ((target: CabinEnvTarget) => void) | null = null;
let rejectScene: ((err: Error) => void) | null = null;
const generatorDispose = vi.fn();

vi.mock('./cabinPmrem', () => ({
    createCabinPmrem: vi.fn(() => ({
        fromSceneAsync: () =>
            new Promise<CabinEnvTarget>((resolve, reject) => {
                resolveScene = resolve;
                rejectScene = reject;
            }),
        fromEquirectangular: vi.fn(),
        dispose: generatorDispose,
    })),
}));

import { buildInteriorLighting } from './LightingBuilder';
import { createCabinPmrem } from './cabinPmrem';

const RENDERER = { isWebGLRenderer: true } as unknown as CabinRenderer;

function studioTarget(): CabinEnvTarget {
    return { texture: new THREE.Texture(), dispose: vi.fn() };
}

/** Let the awaited fallback continue past its `await`. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LightingBuilder — studio IBL ownership', () => {
    beforeEach(() => {
        resolveScene = null;
        rejectScene = null;
        generatorDispose.mockClear();
        vi.mocked(createCabinPmrem).mockClear();
    });

    it('installs the studio environment when nothing else claimed it', async () => {
        const scene = new THREE.Scene();
        buildInteriorLighting(scene, new THREE.Group(), RENDERER, VEHICLES.sedan);

        const target = studioTarget();
        resolveScene!(target);
        await flush();

        expect(scene.environment).toBe(target.texture);
        expect(target.dispose).not.toHaveBeenCalled();
        expect(generatorDispose).toHaveBeenCalledTimes(1);
    });

    it('does not stomp a pano environment that landed while it was awaiting', async () => {
        const scene = new THREE.Scene();
        buildInteriorLighting(scene, new THREE.Group(), RENDERER, VEHICLES.sedan);

        // PanoEnvironment wins the race.
        const panoEnv = new THREE.Texture();
        scene.environment = panoEnv;

        const target = studioTarget();
        resolveScene!(target);
        await flush();

        expect(scene.environment).toBe(panoEnv);
        // The studio target it built is dropped rather than leaked.
        expect(target.dispose).toHaveBeenCalledTimes(1);
        expect(generatorDispose).toHaveBeenCalledTimes(1);
    });

    it('leaves the cabin on analytic lights if the generator fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const scene = new THREE.Scene();
        const lights = buildInteriorLighting(scene, new THREE.Group(), RENDERER, VEHICLES.sedan);

        rejectScene!(new Error('no backend'));
        await flush();

        expect(scene.environment).toBeNull();
        expect(lights.hemisphereLight).toBeInstanceOf(THREE.HemisphereLight);
        // Still disposed on the failure path.
        expect(generatorDispose).toHaveBeenCalledTimes(1);
    });

    it('builds the analytic rig synchronously, before the IBL resolves', () => {
        const scene = new THREE.Scene();
        const lights = buildInteriorLighting(scene, new THREE.Group(), RENDERER, VEHICLES.sedan);

        expect(lights.sunLight).toBeInstanceOf(THREE.DirectionalLight);
        expect(lights.domeLightSource).toBeInstanceOf(THREE.PointLight);
        expect(scene.environment).toBeNull();
    });
});
