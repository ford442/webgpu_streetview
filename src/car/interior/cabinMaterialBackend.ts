import type { CabinRendererBackend } from '../../utils/performance';

/**
 * Process-wide cabin material backend. Set by `createCabinRenderer` before
 * the interior is built so glow / windshield / cup-liquid factories that do
 * not receive a renderer can still pick GLSL vs TSL.
 *
 * Default `webgl` keeps unit tests (and the `?cabin=webgl` hatch) on
 * ShaderMaterial without extra wiring.
 */
let backend: CabinRendererBackend = 'webgl';

export function setCabinMaterialBackend(next: CabinRendererBackend): void {
    backend = next;
}

export function getCabinMaterialBackend(): CabinRendererBackend {
    return backend;
}

/** Test-only: restore the module default between suites. */
export function resetCabinMaterialBackendForTests(): void {
    backend = 'webgl';
}
