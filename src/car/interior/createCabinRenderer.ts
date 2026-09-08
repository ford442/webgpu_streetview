import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { GPUPerformanceProfile } from '../../utils/performance';

export type CabinRendererBackend = 'webgl' | 'webgpu';

/** Either backend, once constructed — the two share the common Three.js `Renderer` surface (render/dispose/setSize/setPixelRatio/setClearColor/toneMapping/outputColorSpace/domElement/info). */
export type CabinRenderer = THREE.WebGLRenderer | WebGPURenderer;

export interface CabinRendererHandle {
    renderer: CabinRenderer;
    canvas: HTMLCanvasElement;
    backend: CabinRendererBackend;
    /**
     * True once the renderer can actually draw a frame. Always true for
     * WebGL (constructed synchronously). WebGPU flips true after its async
     * `init()` resolves — callers should skip `render()` until then, since a
     * pre-init WebGPU renderer no-ops the call with a console warning rather
     * than throwing.
     */
    isReady: () => boolean;
}

export interface CreateCabinRendererOptions {
    gpuProfile: GPUPerformanceProfile;
    /**
     * Street View's shared `GPUDevice` (`Renderer.ts#getSharedGpuDevice` —
     * the only `requestDevice` call site in the app). Required for the
     * `?cabin=webgpu` path; `createCabinRenderer` never requests its own
     * adapter/device.
     */
    sharedDevice?: GPUDevice;
    /** Defaults to `window.location.search`; override in tests. */
    search?: string;
}

const CABIN_WEBGPU_FLAG_VALUE = 'webgpu';

/**
 * Pure — parses `?cabin=webgpu`. Any other value (including absent) keeps
 * the default WebGL cabin renderer, so a default boot is unchanged.
 */
export function resolveCabinRendererPreference(search: string): CabinRendererBackend {
    const params = new URLSearchParams(search);
    return params.get('cabin') === CABIN_WEBGPU_FLAG_VALUE ? 'webgpu' : 'webgl';
}

export function isWebGPUCabinRenderer(renderer: CabinRenderer): renderer is WebGPURenderer {
    return (renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
}

// `three/webgpu` (the node-material/TSL renderer) is a large module that only
// the `?cabin=webgpu` escape hatch needs. A static import here would bundle
// it into car mode's lazy chunk for every car-mode user, flag or not — see
// scripts/check-bundle-budget.sh. `preloadWebGPUCabinRenderer()` fetches it
// as its own further-lazy chunk, gated on the flag, ahead of `initCarMode()`
// (called from `useCarDashboardBridge.ts`); `createCabinRenderer` itself
// stays fully synchronous and only ever reads the already-resolved class.
let WebGPURendererClass: typeof WebGPURenderer | undefined;

export async function preloadWebGPUCabinRenderer(): Promise<void> {
    if (WebGPURendererClass) return;
    const mod = await import('three/webgpu');
    WebGPURendererClass = mod.WebGPURenderer;
}

/**
 * Single construction point for the car interior's Three.js renderer.
 *
 * Default (no flag, `?cabin=webgpu` requested without a shared device, or
 * requested without `preloadWebGPUCabinRenderer()` having resolved first):
 * today's `THREE.WebGLRenderer`, unchanged from the pre-shared-device cabin.
 *
 * `?cabin=webgpu` adopts the Street View `GPUDevice` via
 * `THREE.WebGPURenderer({ device })` instead of the cabin opening its own
 * WebGL context — one `GPUDevice`, one frame. PMREM environment maps
 * (`LightingBuilder.ts`, `PanoEnvironment.ts`) and `optimizeTextures` stay
 * WebGL-only for now and no-op on this path (guarded at their call sites);
 * closing that gap is follow-up work, not this escape hatch.
 */
export function createCabinRenderer(options: CreateCabinRendererOptions): CabinRendererHandle {
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const preference = resolveCabinRendererPreference(search);

    if (preference === 'webgpu') {
        if (options.sharedDevice && WebGPURendererClass) {
            return createWebGPUCabinRenderer(WebGPURendererClass, options.sharedDevice, options.gpuProfile);
        }
        console.warn(
            options.sharedDevice
                ? '[createCabinRenderer] ?cabin=webgpu requested but the WebGPU renderer module has not finished loading — staying on the WebGL cabin renderer.'
                : '[createCabinRenderer] ?cabin=webgpu requested but no shared GPUDevice is available — staying on the WebGL cabin renderer.'
        );
    }

    return createWebGLCabinRenderer(options.gpuProfile);
}

function applyCommonCabinRendererDefaults(renderer: CabinRenderer): void {
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function createWebGLCabinRenderer(gpuProfile: GPUPerformanceProfile): CabinRendererHandle {
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: gpuProfile.antialias });
    } catch (err) {
        throw new Error(
            `Car mode requires WebGL, which is not available in this environment. ` +
            `(${err instanceof Error ? err.message : String(err)})`
        );
    }
    applyCommonCabinRendererDefaults(renderer);

    return {
        renderer,
        canvas: renderer.domElement,
        backend: 'webgl',
        isReady: () => true,
    };
}

function createWebGPUCabinRenderer(
    RendererCtor: typeof WebGPURenderer,
    device: GPUDevice,
    gpuProfile: GPUPerformanceProfile,
): CabinRendererHandle {
    const renderer = new RendererCtor({
        device,
        alpha: true,
        antialias: gpuProfile.antialias,
        forceWebGL: false,
    });
    applyCommonCabinRendererDefaults(renderer);

    let ready = false;
    renderer.init()
        .then(() => {
            ready = true;
        })
        .catch((err) => {
            console.error(
                '[createCabinRenderer] WebGPU cabin renderer failed to initialize; the cabin will stay blank until reload.',
                err
            );
        });

    return {
        renderer,
        canvas: renderer.domElement,
        backend: 'webgpu',
        isReady: () => ready,
    };
}
