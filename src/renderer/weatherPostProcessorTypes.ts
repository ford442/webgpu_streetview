/**
 * Common surface shared by WeatherPostProcessor and ComputeWeatherPostProcessor.
 * Renderer.ts selects either implementation at init based on weatherPostProcessMode.
 */
import type { GpuPassTimer } from './gpuPassTimer';

export interface WeatherPassTimingContext {
    timer: GpuPassTimer;
    weatherStartIndex: number;
    weatherEndIndex: number;
    blitStartIndex?: number;
    blitEndIndex?: number;
}

export interface WeatherPostProcessorLike {
    init(presentationFormat: GPUTextureFormat): Promise<void>;
    updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void;
    updateNoiseBuffer(tile: Float32Array): void;
    /**
     * Upload WASM `fill_particle_seeds` output into compute-path storage
     * textures A/B. No-op on the fragment weather path and WebGL fallback.
     */
    updateParticleSeeds(seeds: Float32Array, width: number, height: number): void;
    setShaderEffects(enabled: boolean): void;
    getCameraParams(): { heading: number; pitch: number };
    getShaderEffectsEnabled(): boolean;
    updateWeatherParams(params: Float32Array): void;
    updateCameraParams(heading: number, pitch: number): void;
    updateColorParams(params: Float32Array): void;
    updateWeatherAnimation(): void;
    renderWeatherOnly(intermediateTextureView: GPUTextureView): void;
    renderPass(commandEncoder: GPUCommandEncoder, timing?: WeatherPassTimingContext): void;
    dispose(): void;
}

/** Method names required on both weather post-processor implementations. */
export const WEATHER_POST_PROCESSOR_METHODS: readonly (keyof WeatherPostProcessorLike)[] = [
    'init',
    'updateWeatherBindGroup',
    'updateNoiseBuffer',
    'updateParticleSeeds',
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
