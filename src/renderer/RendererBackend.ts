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

export interface RendererInitOptions {
    onLost?: (info: GPUDeviceLostInfo) => void;
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
    updateWeatherAnimation(): void;
    renderWeatherOnly(): void;
    beginTransition(mode?: string): void;
    capturePanorama(movementHeading: number): void;
    updateTransitionProgress(progress: number): void;
    endTransition(): void;
    isInTransition(): boolean;
    getTransitionDuration(mode?: string): number;
    captureCurrentFrame(): void;
    beginHoldTransition(heading?: number, pitch?: number): void;
    endHoldTransition(): void;
    isHoldActive(): boolean;
    setTransitionProgress(progress: number): void;
    renderStreetView(
        mode: RenderMode,
        source: CanvasImageSource | null,
        heading?: number,
        pitch?: number,
        zoom?: number
    ): void;
    setDebugOptions?(options: Partial<RendererDebugOptions>): void;
}

const VALID_BACKENDS = new Set(['auto', 'webgpu', 'webgl']);
const VALID_EFFECTS = new Set(['all', 'raw', 'color', 'weather', 'fog', 'night', 'lighting']);

function readSearchParams(): URLSearchParams {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
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

export function exposeRendererDebugGlobals(
    backendType: RendererBackendType,
    fallbackReason: string | undefined,
    debugOptions: RendererDebugOptions,
    applyDebugOptions: (options: Partial<RendererDebugOptions>) => void
): void {
    if (typeof window === 'undefined') return;

    window.rendererType = backendType;
    window.usingWebGPU = backendType === 'webgpu';
    window.usingWebGL = backendType === 'webgl';
    window.rendererFallbackReason = fallbackReason || '';

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
    };
}
