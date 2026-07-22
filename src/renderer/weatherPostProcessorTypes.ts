/**
 * Common surface shared by WeatherPostProcessor and ComputeWeatherPostProcessor.
 * Renderer.ts selects either implementation at init based on weatherPostProcessMode.
 */
export interface WeatherPostProcessorLike {
    init(presentationFormat: GPUTextureFormat): Promise<void>;
    updateWeatherBindGroup(intermediateTextureView: GPUTextureView, width?: number, height?: number): void;
    updateNoiseBuffer(tile: Float32Array): void;
    setShaderEffects(enabled: boolean): void;
    getCameraParams(): { heading: number; pitch: number };
    getShaderEffectsEnabled(): boolean;
    updateWeatherParams(params: Float32Array): void;
    updateCameraParams(heading: number, pitch: number): void;
    updateColorParams(params: Float32Array): void;
    updateWeatherAnimation(): void;
    renderWeatherOnly(intermediateTextureView: GPUTextureView): void;
    renderPass(commandEncoder: GPUCommandEncoder): void;
    dispose(): void;
}

/** Method names required on both weather post-processor implementations. */
export const WEATHER_POST_PROCESSOR_METHODS: readonly (keyof WeatherPostProcessorLike)[] = [
    'init',
    'updateWeatherBindGroup',
    'updateNoiseBuffer',
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
