import { RenderMode } from './types';

export type RendererBackendType = 'webgpu' | 'webgl';
export type RendererBackendPreference = RendererBackendType | 'auto';
export type RendererEffectIsolation =
    'all' |
    'raw' |
    'color' |
    'weather' |
    'fog' |
    'night' |
    'lighting';

export interface RendererDebugOptions {
    effectIsolation: RendererEffectIsolation;
    wireframe: boolean;
}

export type WeatherPostProcessMode = 'fragment' | 'compute';

export interface RendererInitOptions {
    onLost?: (info: GPUDeviceLostInfo) => void;
    /** WebGPU only — WebGL2 fallback stays fragment-only. See docs/RENDERER_FALLBACK.md. */
    weatherPostProcessMode?: WeatherPostProcessMode;
    /** WebGPU only — legacy zoom/fade transition shaders are opt-in (`?legacyTransitions=1`). */
    legacyTransitions?: boolean;
    /** WebGPU only — overrides URL/battery power preference policy when provided. */
    powerPreference?: GPUPowerPreference;
}

export interface StreetViewRenderer {
    readonly canvas: HTMLCanvasElement;
    readonly backendType: RendererBackendType;
    readonly fallbackReason?: string;

    init(options?: RendererInitOptions): Promise<boolean>;
    resize(width: number, height: number): void;
    destroy(): void;
    setCarMode(active: boolean): void;
    updateEffects(effectsData: Float32Array): void;
    getCanvasDataURL(): string;
    setShaderEffects(enabled: boolean): void;
    getCameraParams(): { heading: number; pitch: number };
    getShaderEffectsEnabled(): boolean;
    updateWeatherParams(params: Float32Array): void;
    updateCameraParams(heading: number, pitch: number): void;
    updateColorParams(params: Float32Array): void;
    /**
     * Upload a WASM-computed noise tile (see src/wasm/wasmNoiseFeeder.ts) for
     * shaders to sample as CPU-driven turbulence. `tile` must have
     * `NOISE_TILE_SIZE * NOISE_TILE_SIZE` elements, row-major. No-op on
     * backends that don't support it (e.g. the WebGL fallback).
     */
    updateNoiseBuffer(tile: Float32Array): void;
    updateWeatherAnimation(): void;
    renderWeatherOnly(): void;
    beginTransition(mode?: string): void;
    capturePanorama(movementHeading: number): void;
    updateTransitionProgress(progress: number): void;
    endTransition(): void;
    isInTransition(): boolean;
    getTransitionDuration(mode?: string): number;
    captureCurrentFrame(): void;
    beginHoldTransition(heading?: number, pitch?: number, cpuSnapshot?: HTMLCanvasElement): void;
    endHoldTransition(): void;
    isHoldActive(): boolean;
    setTransitionProgress(progress: number): void;
    /** Draw the frozen outgoing panorama (GPU snapshot) without uploading any source. */
    renderHeldFrame(heading?: number, pitch?: number, zoom?: number): void;
    renderStreetView(
        mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void;
    setDebugOptions?(options: Partial<RendererDebugOptions>): void;
    /** WebGPU only — returns which weather post-process pipeline is active. */
    getWeatherPostProcessMode?(): WeatherPostProcessMode;
    /** WebGPU only — updates panorama sampler anisotropy from the active quality preset. */
    setSamplerAnisotropy?(level: import('../config/visualPresets').QualityLevel): void;
}

const VALID_BACKENDS = new Set(['auto', 'webgpu', 'webgl']);
const VALID_EFFECTS = new Set(['all', 'raw', 'color', 'weather', 'fog', 'night', 'lighting']);
const VALID_WEATHER_MODES = new Set(['fragment', 'compute']);

function readSearchParams(): URLSearchParams {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
}

export interface AdapterPowerPreferencePolicy {
    powerPreference?: GPUPowerPreference;
    source: 'override' | 'url' | 'default';
}

export function getAdapterPowerPreferencePolicy(options?: RendererInitOptions): AdapterPowerPreferencePolicy {
    if (options?.powerPreference) {
        return {
            powerPreference: options.powerPreference,
            source: 'override',
        };
    }

    const params = readSearchParams();
    const gpuParam = params.get('gpu')?.toLowerCase();
    if (gpuParam === 'low' || gpuParam === 'low-power') {
        return { powerPreference: 'low-power', source: 'url' };
    }
    if (gpuParam === 'high' || gpuParam === 'high-performance') {
        return { powerPreference: 'high-performance', source: 'url' };
    }

    return { source: 'default' };
}

export function getAdapterRequestOptions(options?: RendererInitOptions): GPURequestAdapterOptions {
    const policy = getAdapterPowerPreferencePolicy(options);
    return policy.powerPreference ? { powerPreference: policy.powerPreference } : {};
}

export function getRendererPreference(): RendererBackendPreference {
    const params = readSearchParams();
    const explicit = params.get('renderer')?.toLowerCase();
    if (explicit && VALID_BACKENDS.has(explicit)) {
        return explicit as RendererBackendPreference;
    }
    if (params.has('webgl')) return 'webgl';
    if (params.has('webgpu')) return 'webgpu';

    try {
        const stored = window.localStorage.getItem('streetview.renderer');
        if (stored && VALID_BACKENDS.has(stored)) {
            return stored as RendererBackendPreference;
        }
    } catch {
        // Storage may be unavailable in hardened browsers.
    }

    return 'auto';
}

export function getRendererDebugOptions(): RendererDebugOptions {
    const params = readSearchParams();
    const effectParam = params.get('effect')?.toLowerCase();
    let effectIsolation: RendererEffectIsolation = 'all';
    if (effectParam && VALID_EFFECTS.has(effectParam)) {
        effectIsolation = effectParam as RendererEffectIsolation;
    }

    try {
        const storedEffect = window.localStorage.getItem('streetview.effect');
        if (!effectParam && storedEffect && VALID_EFFECTS.has(storedEffect)) {
            effectIsolation = storedEffect as RendererEffectIsolation;
        }
    } catch {
        // ignore
    }

    const wireframe = params.has('wireframe') || params.get('debug') === 'wireframe';

    return { effectIsolation, wireframe };
}

/**
 * Resolve the weather post-processing pipeline: `?weather=compute` or
 * `?weather=fragment` in the URL wins, then a persisted `localStorage`
 * choice, then `fallback` (typically the current visual quality preset's
 * default — see src/config/visualPresets.ts). WebGPU-only; the WebGL2
 * fallback renderer always uses its fragment-only SDR approximation.
 */
export function getWeatherPostProcessMode(fallback: WeatherPostProcessMode = 'fragment'): WeatherPostProcessMode {
    const params = readSearchParams();
    const explicit = params.get('weather')?.toLowerCase();
    if (explicit && VALID_WEATHER_MODES.has(explicit)) {
        return explicit as WeatherPostProcessMode;
    }

    try {
        const stored = window.localStorage.getItem('streetview.weatherMode');
        if (stored && VALID_WEATHER_MODES.has(stored)) {
            return stored as WeatherPostProcessMode;
        }
    } catch {
        // Storage may be unavailable in hardened browsers.
    }

    return fallback;
}

export function getLegacyTransitionsEnabled(fallback: boolean = false): boolean {
    const params = readSearchParams();
    const explicit = params.get('legacyTransitions')?.toLowerCase();
    if (explicit === '1' || explicit === 'true') return true;
    if (explicit === '0' || explicit === 'false') return false;
    return fallback;
}

export function exposeRendererDebugGlobals(
    backendType: RendererBackendType,
    fallbackReason: string | undefined,
    debugOptions: RendererDebugOptions,
    applyDebugOptions: (options: Partial<RendererDebugOptions>) => void,
    weatherPostProcessMode?: WeatherPostProcessMode
): void {
    if (typeof window === 'undefined') return;

    window.rendererType = backendType;
    window.usingWebGPU = backendType === 'webgpu';
    window.usingWebGL = backendType === 'webgl';
    window.rendererFallbackReason = fallbackReason || '';
    window.weatherPostProcessMode = weatherPostProcessMode || 'fragment';

    window.streetViewRendererDebug = {
        getBackend: () => ({
            rendererType: window.rendererType,
            usingWebGPU: window.usingWebGPU,
            usingWebGL: window.usingWebGL,
            rendererFallbackReason: window.rendererFallbackReason,
        }),
        setBackend: (backend: RendererBackendPreference) => {
            if (!VALID_BACKENDS.has(backend)) return;
            window.localStorage.setItem('streetview.renderer', backend);
            window.location.reload();
        },
        setEffectIsolation: (effect: RendererEffectIsolation) => {
            if (!VALID_EFFECTS.has(effect)) return;
            window.localStorage.setItem('streetview.effect', effect);
            applyDebugOptions({ effectIsolation: effect });
        },
        setWireframe: (enabled: boolean) => {
            applyDebugOptions({ wireframe: enabled });
        },
        getDebugOptions: () => ({ ...debugOptions }),
        getWeatherMode: () => window.weatherPostProcessMode || 'fragment',
        setWeatherMode: (mode: WeatherPostProcessMode) => {
            if (!VALID_WEATHER_MODES.has(mode)) return;
            window.localStorage.setItem('streetview.weatherMode', mode);
            window.location.reload();
        },
    };
}
