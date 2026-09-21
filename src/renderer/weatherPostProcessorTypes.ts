/**
 * Common surface shared by WeatherPostProcessor and ComputeWeatherPostProcessor.
 * Renderer.ts selects either implementation at init based on weatherPostProcessMode.
 */
import type { GpuPassTimer } from './gpuPassTimer';
import type { CanvasToneMapping } from './shaderFeatureVariants';

export interface WeatherPassTimingContext {
    timer: GpuPassTimer;
    weatherStartIndex: number;
    weatherEndIndex: number;
    blitStartIndex?: number;
    blitEndIndex?: number;
}

/**
 * The weather span as pass-descriptor `timestampWrites`. Undefined when there
 * is no timer or the device took the legacy in-pass fallback; both render and
 * compute descriptors accept the same shape.
 */
export function weatherPassTimestampWrites(
    timing?: WeatherPassTimingContext,
): GPURenderPassTimestampWrites | undefined {
    return timing?.timer.renderPassTimestampWrites(timing.weatherStartIndex, timing.weatherEndIndex);
}

/** The compute-path blit span. Undefined on the fragment path, which has no blit. */
export function blitPassTimestampWrites(
    timing?: WeatherPassTimingContext,
): GPURenderPassTimestampWrites | undefined {
    if (!timing || timing.blitStartIndex === undefined || timing.blitEndIndex === undefined) {
        return undefined;
    }
    return timing.timer.renderPassTimestampWrites(timing.blitStartIndex, timing.blitEndIndex);
}

export interface WeatherPostInitOptions {
    /**
     * Tone mapping `configureCanvasContext` actually **applied** to the swap
     * chain — never the requested `?hdr` flag. `'extended'` assembles the
     * output-referred grade (`assembleExtendedToneMappingShader`) so highlights
     * survive into display headroom; `'standard'` (the default, and every
     * default boot) keeps the historical SDR ACES pixels.
     */
    canvasToneMapping?: CanvasToneMapping;
}

export interface WeatherPostProcessorLike {
    init(presentationFormat: GPUTextureFormat, options?: WeatherPostInitOptions): Promise<void>;
    updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void;
    updateNoiseBuffer(tile: Float32Array): void;
    /**
     * Upload WASM `fill_particle_seeds` output into compute-path storage
     * textures A/B. No-op on the fragment weather path.
     */
    updateParticleSeeds(seeds: Float32Array, width: number, height: number): void;
    /** Bind a 3D look LUT, or null for the identity (ACES-only) path. */
    setLookLut(volume: import('./lut').LutVolume | null): void;
    /** Compute-only 1-frame color history. No-op on fragment. */
    setTemporalHistoryEnabled(enabled: boolean): void;
    setShaderEffects(enabled: boolean): void;
    getCameraParams(): { heading: number; pitch: number };
    getShaderEffectsEnabled(): boolean;
    updateWeatherParams(params: Float32Array): void;
    updateCameraParams(heading: number, pitch: number): void;
    updateColorParams(params: Float32Array): void;
    updateWeatherAnimation(): void;
    /**
     * Weather-only frame (no fresh panorama upload). Owns its own encoder and
     * submit, so `afterWeather` is the only place another pass can join the
     * frame — `Renderer` uses it for the cabin composite, which has to land on
     * the same swap-chain texture before it is presented.
     */
    renderWeatherOnly(
        intermediateTextureView: GPUTextureView,
        afterWeather?: (commandEncoder: GPUCommandEncoder) => void,
    ): void;
    renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void;
    dispose(): void;
}

/** Method names required on both weather post-processor implementations. */
export const WEATHER_POST_PROCESSOR_METHODS: readonly (keyof WeatherPostProcessorLike)[] = [
    'init',
    'updateWeatherBindGroup',
    'updateNoiseBuffer',
    'updateParticleSeeds',
    'setLookLut',
    'setTemporalHistoryEnabled',
    'setShaderEffects',
    'getCameraParams',
    'getShaderEffectsEnabled',
    'updateWeatherParams',
    'updateCameraParams',
    'updateColorParams',
    'updateWeatherAnimation',
    'renderWeatherOnly',
    'renderPass',
    'dispose',
] as const;
