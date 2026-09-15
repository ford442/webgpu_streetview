import * as THREE from 'three';
import type { PMREMGenerator as WebGPUPMREMGenerator, WebGPURenderer } from 'three/webgpu';
import type {
    CabinCapableRenderer,
    CabinRendererBackend,
    GPUPerformanceProfile,
} from '../../utils/performance';
import { isWebGpuProbeOk } from '../../renderer/webgpuBootProbe';
import { setCabinMaterialBackend } from './cabinMaterialBackend';
import { getCabinTslApi, setCabinTslApi } from './cabinTslRegistry';
import { publishCabinRendererProbe } from './cabinRendererProbe';
import type { CabinTslApi } from './cabinTslMaterials';

export type { CabinRendererBackend };

/** Either backend, once constructed — the two share the common Three.js `Renderer` surface (render/dispose/setSize/setPixelRatio/setClearColor/toneMapping/outputColorSpace/domElement/info). */
export type CabinRenderer = CabinCapableRenderer;

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
    /**
     * Resolves when the backend can draw. WebGL is already ready.
     * WebGPU rejects if `init()` fails — `createCabinRendererAsync` turns
     * that into a WebGL overlay fallback.
     */
    whenReady: Promise<void>;
}

export interface CreateCabinRendererOptions {
    gpuProfile: GPUPerformanceProfile;
    /**
     * Street View's shared `GPUDevice` (`Renderer.ts#getSharedGpuDevice` —
     * the only `requestDevice` call site in the app). Required for the
     * WebGPU cabin path; `createCabinRenderer` never requests its own
     * adapter/device.
     */
    sharedDevice?: GPUDevice;
    /** Defaults to `window.location.search`; override in tests. */
    search?: string;
    /** Override `webgpuProbe.ok` (tests). Default reads the live probe. */
    probeOk?: boolean;
}

const CABIN_WEBGL_FLAG_VALUE = 'webgl';
const CABIN_WEBGPU_FLAG_VALUE = 'webgpu';

/**
 * Pure — parses `?cabin=`.
 * - `?cabin=webgl` is the escape hatch back to a second WebGL context.
 * - `?cabin=webgpu` forces the shared-device path when the module + device exist.
 * - Absent: WebGPU on capable adapters (`webgpuProbe.ok`), otherwise WebGL.
 */
export function resolveCabinRendererPreference(
    search: string,
    probeOk: boolean = isWebGpuProbeOk(),
): CabinRendererBackend {
    const params = new URLSearchParams(search);
    const flag = params.get('cabin');
    if (flag === CABIN_WEBGL_FLAG_VALUE) return 'webgl';
    if (flag === CABIN_WEBGPU_FLAG_VALUE) return 'webgpu';
    return probeOk ? 'webgpu' : 'webgl';
}

export function isWebGPUCabinRenderer(renderer: CabinRenderer): renderer is WebGPURenderer {
    return (renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
}

// `three/webgpu` (the node-material/TSL renderer) is a large module. A static
// import here would bundle it into car mode's lazy chunk for every car-mode
// user, including `?cabin=webgl`. `preloadWebGPUCabinRenderer()` fetches it
// as its own further-lazy chunk ahead of `initCarMode()`.
let WebGPURendererClass: typeof WebGPURenderer | undefined;
let WebGPUPMREMGeneratorClass: typeof WebGPUPMREMGenerator | undefined;
let cabinTslApi: CabinTslApi | undefined;

export async function preloadWebGPUCabinRenderer(): Promise<void> {
    if (WebGPURendererClass && cabinTslApi) return;
    const [mod, tsl] = await Promise.all([
        import('three/webgpu'),
        import('./cabinTslMaterials'),
    ]);
    WebGPURendererClass = mod.WebGPURenderer;
    // `three/webgpu` ships its own PMREMGenerator — a different class from
    // `THREE.PMREMGenerator`, which only drives a WebGLRenderer. Captured from
    // the same chunk so the IBL path costs the WebGL hatch nothing; consumed
    // by `cabinPmrem.ts`.
    WebGPUPMREMGeneratorClass = mod.PMREMGenerator;
    cabinTslApi = tsl.cabinTslApi;
    setCabinTslApi(cabinTslApi);
}

/**
 * The WebGPU `PMREMGenerator` class, once `preloadWebGPUCabinRenderer()` has
 * resolved. Undefined on the WebGL hatch, where `THREE.PMREMGenerator`
 * is the right one.
 */
export function getWebGPUPMREMGeneratorClass(): typeof WebGPUPMREMGenerator | undefined {
    return WebGPUPMREMGeneratorClass;
}

/** Test-only: drop the cached `three/webgpu` constructors so preference tests can re-run the preload gate. */
export function resetWebGPUCabinRendererForTests(): void {
    WebGPURendererClass = undefined;
    WebGPUPMREMGeneratorClass = undefined;
    cabinTslApi = undefined;
    setCabinTslApi(undefined);
}

function parseP3Flag(search: string): boolean {
    const params = new URLSearchParams(search);
    const raw = params.get('p3')?.toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    if (raw === 'auto' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
            return window.matchMedia('(color-gamut: p3)').matches === true;
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * Cabin overlay color space follows the Street View canvas `?p3` flag.
 * HDR (`?hdr`) stays on `configureCanvasContext` — this overlay is still an
 * 8-bit canvas composited in 2D, so it stays output-referred sRGB/P3 rather
 * than linear HDR. Weather-post ACES owns the road; the WebGPU cabin does
 * not apply a second ACES pass.
 */
export function resolveCabinOutputColorSpace(search: string): THREE.ColorSpace {
    if (parseP3Flag(search)) {
        return 'display-p3' as THREE.ColorSpace;
    }
    return THREE.SRGBColorSpace;
}

function applyCommonCabinRendererDefaults(
    renderer: CabinRenderer,
    backend: CabinRendererBackend,
    search: string,
): void {
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    if (backend === 'webgpu') {
        // Weather-post ACES already tonemaps the road. A second ACES on the
        // shared device is a look bug; keep the cabin output-referred.
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
    } else {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
    }
    renderer.outputColorSpace = resolveCabinOutputColorSpace(search);
}

function noteHandle(handle: CabinRendererHandle, preference: CabinRendererBackend, extra?: Partial<{
    initFailed: boolean;
    fallbackReason: string;
}>): CabinRendererHandle {
    setCabinMaterialBackend(handle.backend);
    publishCabinRendererProbe({
        backend: handle.backend,
        preference,
        ready: handle.isReady(),
        initFailed: extra?.initFailed,
        fallbackReason: extra?.fallbackReason,
        updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
    return handle;
}

/**
 * Single construction point for the car interior's Three.js renderer.
 *
 * Default on a capable adapter (`webgpuProbe.ok` + shared `GPUDevice` +
 * preloaded `three/webgpu`): `THREE.WebGPURenderer({ device })` adopting the
 * Street View device — never a second `requestDevice`, never `configure()` on
 * the panorama canvas.
 *
 * `?cabin=webgl` (or a missing device / failed preload / failed `init()`)
 * stays on today's `THREE.WebGLRenderer` overlay. Street View weather is
 * unaffected.
 */
export function createCabinRenderer(options: CreateCabinRendererOptions): CabinRendererHandle {
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const probeOk = options.probeOk ?? isWebGpuProbeOk();
    const preference = resolveCabinRendererPreference(search, probeOk);

    if (preference === 'webgpu') {
        const tslReady = Boolean(getCabinTslApi());
        if (options.sharedDevice && WebGPURendererClass && tslReady) {
            return noteHandle(
                createWebGPUCabinRenderer(WebGPURendererClass, options.sharedDevice, options.gpuProfile, search),
                preference,
            );
        }
        const reason = !options.sharedDevice
            ? 'WebGPU cabin requested but no shared GPUDevice is available — staying on the WebGL cabin overlay.'
            : !WebGPURendererClass || !tslReady
                ? 'WebGPU cabin module has not finished loading — staying on the WebGL cabin overlay.'
                : 'WebGPU cabin unavailable — staying on the WebGL cabin overlay.';
        console.warn(`[createCabinRenderer] ${reason}`);
        return noteHandle(createWebGLCabinRenderer(options.gpuProfile, search), preference, {
            fallbackReason: reason,
        });
    }

    return noteHandle(createWebGLCabinRenderer(options.gpuProfile, search), preference);
}

/**
 * Await WebGPU `init()` and fall back to a WebGL overlay if it rejects.
 * Production car-mode init uses this so a failed cabin `init()` never leaves
 * a blank interior while Street View weather stays up.
 */
export async function createCabinRendererAsync(
    options: CreateCabinRendererOptions,
): Promise<CabinRendererHandle> {
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const probeOk = options.probeOk ?? isWebGpuProbeOk();
    const preference = resolveCabinRendererPreference(search, probeOk);
    const handle = createCabinRenderer(options);
    if (handle.backend !== 'webgpu') return handle;
    try {
        await handle.whenReady;
        publishCabinRendererProbe({
            backend: 'webgpu',
            preference,
            ready: true,
            updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        });
        return handle;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
            '[createCabinRenderer] WebGPU cabin renderer failed to initialize — falling back to WebGL overlay. Street View weather is unchanged.',
            err,
        );
        try {
            handle.renderer.dispose();
        } catch {
            // Dispose of a half-inited WebGPURenderer is best-effort.
        }
        const fallback = createWebGLCabinRenderer(options.gpuProfile, search);
        return noteHandle(fallback, preference, {
            initFailed: true,
            fallbackReason: message,
        });
    }
}

function createWebGLCabinRenderer(
    gpuProfile: GPUPerformanceProfile,
    search: string,
): CabinRendererHandle {
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: gpuProfile.antialias });
    } catch (err) {
        throw new Error(
            `Car mode requires WebGL, which is not available in this environment. ` +
            `(${err instanceof Error ? err.message : String(err)})`
        );
    }
    applyCommonCabinRendererDefaults(renderer, 'webgl', search);

    return {
        renderer,
        canvas: renderer.domElement,
        backend: 'webgl',
        isReady: () => true,
        whenReady: Promise.resolve(),
    };
}

function createWebGPUCabinRenderer(
    RendererCtor: typeof WebGPURenderer,
    device: GPUDevice,
    gpuProfile: GPUPerformanceProfile,
    search: string,
): CabinRendererHandle {
    const renderer = new RendererCtor({
        device,
        alpha: true,
        antialias: gpuProfile.antialias,
        forceWebGL: false,
    });
    applyCommonCabinRendererDefaults(renderer, 'webgpu', search);

    let ready = false;
    let settleReady: (value: void | PromiseLike<void>) => void;
    let settleReject: (reason: unknown) => void;
    const whenReady = new Promise<void>((resolve, reject) => {
        settleReady = resolve;
        settleReject = reject;
    });
    // Prevent an unhandled rejection when callers use the sync constructor
    // and `createCabinRendererAsync` is the one that observes failure.
    void whenReady.catch(() => undefined);
    renderer.init()
        .then(() => {
            ready = true;
            settleReady();
        })
        .catch((err) => {
            settleReject(err);
        });

    return {
        renderer,
        canvas: renderer.domElement,
        backend: 'webgpu',
        isReady: () => ready,
        whenReady,
    };
}
