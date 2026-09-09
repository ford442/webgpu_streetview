import * as THREE from 'three';
import type { PMREMGenerator as WebGPUPMREMGenerator } from 'three/webgpu';
import {
    getWebGPUPMREMGeneratorClass,
    isWebGPUCabinRenderer,
    type CabinRenderer,
} from './createCabinRenderer';

/**
 * Backend-agnostic PMREM for the cabin's image-based lighting.
 *
 * `THREE.PMREMGenerator` only drives a `WebGLRenderer`. `three/webgpu` ships a
 * *separate* `PMREMGenerator` class for `WebGPURenderer` with the same call
 * shape, captured from the same lazy chunk as the renderer itself
 * (`createCabinRenderer.ts`), so the default WebGL path pays nothing for this.
 *
 * Callers use `fromSceneAsync` rather than `fromScene`: the WebGPU generator
 * warns and silently defers to its own async path when called before
 * `renderer.init()` has resolved, which is exactly when the cabin's lighting
 * rig is built. `fromEquirectangular` stays synchronous because it only runs on
 * pano hops, long after init.
 */

/** All either call site needs from a PMREM target, on either backend. */
export interface CabinEnvTarget {
    readonly texture: THREE.Texture;
    dispose(): void;
}

export interface CabinPmrem {
    /** Studio-cube / room IBL. Safe to call before the backend is initialized. */
    fromSceneAsync(scene: THREE.Scene, sigma?: number, near?: number, far?: number): Promise<CabinEnvTarget>;
    /** Pano IBL. Call only once the renderer is drawing frames. */
    fromEquirectangular(equirectangular: THREE.Texture): CabinEnvTarget;
    dispose(): void;
}

/**
 * `@types/three` 0.180 declares only `fromScene` / `fromSceneAsync` / `dispose`
 * on the WebGPU generator, but `fromEquirectangular` and `fromCubemap` are both
 * present at runtime (`three/src/renderers/common/extras/PMREMGenerator.js`).
 * Local augmentation rather than a bare cast, so the shape we rely on is
 * written down and checked at the one place it is asserted.
 */
type WebGPUPMREMGeneratorWithEquirect = WebGPUPMREMGenerator & {
    fromEquirectangular(equirectangular: THREE.Texture, renderTarget?: unknown): CabinEnvTarget;
};

/**
 * Returns null only if the cabin is a WebGPU renderer whose `three/webgpu`
 * module has somehow not resolved — the renderer itself comes from that same
 * module, so in practice this cannot happen. Callers skip IBL rather than
 * crash if it ever does.
 */
export function createCabinPmrem(renderer: CabinRenderer): CabinPmrem | null {
    if (isWebGPUCabinRenderer(renderer)) {
        const Ctor = getWebGPUPMREMGeneratorClass();
        if (!Ctor) return null;
        const generator = new Ctor(renderer) as WebGPUPMREMGeneratorWithEquirect;
        return {
            fromSceneAsync: (scene, sigma, near, far) =>
                generator.fromSceneAsync(scene, sigma, near, far),
            fromEquirectangular: (equirectangular) => generator.fromEquirectangular(equirectangular),
            dispose: () => generator.dispose(),
        };
    }

    const generator = new THREE.PMREMGenerator(renderer as THREE.WebGLRenderer);
    return {
        // Synchronous on WebGL; the promise only exists to give both backends
        // one signature.
        fromSceneAsync: (scene, sigma, near, far) =>
            Promise.resolve(generator.fromScene(scene, sigma, near, far)),
        fromEquirectangular: (equirectangular) => generator.fromEquirectangular(equirectangular),
        dispose: () => generator.dispose(),
    };
}
