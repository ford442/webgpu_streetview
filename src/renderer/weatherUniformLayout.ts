/**
 * Single source of truth for the 44-float (176-byte) weather post-process
 * uniform layout shared by:
 *  - src/renderer/WeatherPostProcessor.ts   (fragment pass, uniform buffer)
 *  - src/renderer/ComputeWeatherPostProcessor.ts (compute pass, storage buffer)
 *  - public/shaders/weather-post.wgsl        (`struct WeatherParams`)
 *  - public/shaders/weather-post-compute.wgsl (`extraBuffer` accessors)
 *  - src/renderer/webgl/weatherReference.glsl.ts (SDR GLSL reference; not a live backend)
 *
 * Changing an index here means updating the live WebGPU paths in lockstep. See
 * docs/RENDERER_FALLBACK.md and AGENTS.md ("Shader Uniform Layouts").
 */

export const WEATHER_PARAMS_FLOAT_COUNT = 44;
export const WEATHER_PARAMS_BYTE_SIZE = WEATHER_PARAMS_FLOAT_COUNT * 4;

export const WeatherParamIndex = {
    // 0-5: color grading
    vibrance: 0,
    saturation: 1,
    contrast: 2,
    exposure: 3,
    temperature: 4,
    tint: 5,
    // 6-10: weather / animation
    time: 6,
    rainIntensity: 7,
    snowIntensity: 8,
    wind: 9,
    speed: 10,
    // 11-15: nighttime + headlights
    nightIntensity: 11,
    headlightsOn: 12,
    highBeam: 13,
    headlightHeading: 14,
    headlightPitch: 15,
    // 16-17: dome light
    domeLightOn: 16,
    domeLightIntensity: 17,
    // 18-21: astronomical sun/moon positions (SunCalc radians)
    sunAzimuth: 18,
    sunAltitude: 19,
    moonAzimuth: 20,
    moonAltitude: 21,
    // 22-31: atmospheric effects
    fogIntensity: 22,
    fogDensity: 23,
    fogHeight: 24,
    fogColorIndex: 25,
    lightShaftsIntensity: 26,
    heatShimmerIntensity: 27,
    lensFlareIntensity: 28,
    chromaticAberration: 29,
    dustIntensity: 30,
    humidityHaze: 31,
    // 32: shader toggle
    shaderEffectsEnabled: 32,
    // 33-35: camera + WASM noise toggle
    cameraHeading: 33,
    cameraPitch: 34,
    wasmNoiseEnabled: 35,
    // 36-37
    sunrise: 36,
    anamorphicStreak: 37,
    // 38-39: cinematic camera FX (gated by quality >= high + reduced motion,
    // see src/renderer/cinematicCameraFx.ts).
    dofStrength: 38,
    motionBlurStrength: 39,
    // 40-43: image-derived horizon (src/renderer/gpuChores/horizonEstimate.ts).
    // `viewHorizonY` blends the pitch prediction toward horizonEstimateY by
    // horizonBlend; blend 0 is bit-exact with the pitch-only horizon. 42-43 pad
    // the block to a multiple of 4 floats (44 floats / 176 bytes).
    horizonEstimateY: 40,
    horizonBlend: 41,
    horizonPad0: 42,
    horizonPad1: 43,
} as const;

export type WeatherParamName = keyof typeof WeatherParamIndex;
