/**
 * Tiny registry for the lazy `three/webgpu` TSL cabin materials.
 *
 * VanityMirror / RearviewMirror must not import `createCabinRenderer.ts`
 * (that graph leaks `three` into the eager main bundle). This module has no
 * `three/webgpu` import of its own — `preloadWebGPUCabinRenderer()` fills it
 * from the same further-lazy chunk as `WebGPURenderer`.
 */
import type { CabinTslApi } from './cabinTslMaterials';

let api: CabinTslApi | undefined;

export function setCabinTslApi(next: CabinTslApi | undefined): void {
    api = next;
}

export function getCabinTslApi(): CabinTslApi | undefined {
    return api;
}
