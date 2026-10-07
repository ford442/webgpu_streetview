import type { CabinRendererBackend } from '../../utils/performance';
import { currentSearch, readFlag } from '../../config/flags';

/**
 * Whether the cabin can build the windshield **portal** — the layer that samples
 * the road's HDR intermediate through wet glass — or has to stay on today's hole
 * + decal overlay.
 *
 * Decided once, where the cabin renderer is constructed
 * (`createCabinRenderer`), and read when the interior builds its
 * `WindowWeatherOverlay`. Same shape as `cabinMaterialBackend`: a module-level
 * value, defaulting to "off" so unit tests and the `?cabin=webgl` hatch need no
 * wiring.
 *
 * The gate is deliberately strict — portal only when **all** hold:
 *
 * - the cabin is on the shared-device WebGPU backend (the road's texture is a
 *   `GPUTexture` on that device; the WebGL cabin cannot bind it),
 * - the device was created with `clip-distances` (see `windshieldAperture.ts`
 *   for why the portal's trim is hardware clipping and never `discard`),
 * - `?portal=off` is not set (the manual fallback toggle).
 *
 * Anything else is a clean fallback, never an error: the glass stays the
 * `transmission: 0` hole that shows the road frame, with the decal on top.
 */
export interface WindshieldPortalSupport {
    enabled: boolean;
    /** Why the portal is not in use. Undefined when `enabled`. */
    reason?: string;
    /** The shared device has `clip-distances`. */
    clipDistances: boolean;
    /**
     * The shared device the cabin renderer adopted, so the portal can refuse a
     * road frame that lives on a different one. Absent when unknown (tests).
     */
    device?: object;
}

export interface ResolvePortalSupportInput {
    backend: CabinRendererBackend;
    /** The shared `GPUDevice` the cabin adopted. Absent on the WebGL cabin. */
    device?: Pick<GPUDevice, 'features'> | null;
    /** Defaults to `window.location.search`. */
    search?: string;
}

export const PORTAL_FLAG = 'portal';

/** `?portal=off` (also `0` / `false`) forces the hole + decal fallback. */
export function isPortalDisabledByFlag(search: string): boolean {
    return readFlag(PORTAL_FLAG, search) === false;
}

function deviceHasClipDistances(device: ResolvePortalSupportInput['device']): boolean {
    try {
        return device?.features?.has?.('clip-distances' as GPUFeatureName) === true;
    } catch {
        return false;
    }
}

export function resolveWindshieldPortalSupport(
    input: ResolvePortalSupportInput,
): WindshieldPortalSupport {
    const search = input.search ?? currentSearch();
    const clipDistances = deviceHasClipDistances(input.device);

    if (input.backend !== 'webgpu') {
        return {
            enabled: false,
            clipDistances,
            reason: 'WebGL cabin overlay — the portal needs the shared WebGPU device; keeping the decal overlay.',
        };
    }
    if (isPortalDisabledByFlag(search)) {
        return {
            enabled: false,
            clipDistances,
            reason: 'Disabled by ?portal=off — hole + decal overlay.',
        };
    }
    if (!input.device) {
        return {
            enabled: false,
            clipDistances,
            reason: 'No shared GPUDevice — hole + decal overlay.',
        };
    }
    if (!clipDistances) {
        return {
            enabled: false,
            clipDistances,
            reason: 'The shared device has no clip-distances feature — hole + decal overlay.',
        };
    }
    return { enabled: true, clipDistances, device: input.device as object };
}

const DISABLED_DEFAULT: WindshieldPortalSupport = {
    enabled: false,
    clipDistances: false,
    reason: 'Portal support has not been resolved for this cabin renderer.',
};

let support: WindshieldPortalSupport = DISABLED_DEFAULT;

export function setWindshieldPortalSupport(next: WindshieldPortalSupport): void {
    support = next;
}

export function getWindshieldPortalSupport(): WindshieldPortalSupport {
    return support;
}

/** Test-only: restore the default (portal off) between suites. */
export function resetWindshieldPortalSupportForTests(): void {
    support = DISABLED_DEFAULT;
}
